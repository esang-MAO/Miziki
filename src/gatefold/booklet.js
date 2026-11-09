/* ================= GF10: the booklet viewer (docs/29_GATEFOLD.md) =========
   A full-screen layer registered with shell/nav-stack.js, opened from the
   gatefold's inside-left panel ("Booklet · N pages", src/gatefold/view.js)
   once an album has any pages (src/library/booklet.js owns where the page
   bytes themselves live and how they got there at import). Page-turn on a
   horizontal swipe (the same ~8px direction lock/60px commit distance as
   the gatefold's own panel swipe, gatefoldWireGestures() in view.js),
   pinch to zoom the current page, a thumbnail strip, "N / M", Done.

   "Add booklet pages…" (view.js's buildBookletRow) opens a plain file
   picker here too -- the one other entry point into addBookletPages()
   besides import's own sidecar detection (library/import.js). */
import { $, el } from '../util/dom.js';
import { REDUCED } from '../util/motion.js';
import { bookletPages, addBookletPages } from '../library/booklet.js';
import { openLayer } from '../shell/nav-stack.js';
// Circular with view.js (which imports openBookletViewer/
// openAddBookletPagesPicker from here) -- safe the same way library/
// sealed.js <-> shell/start-sequence.js already is (GF8): refreshLinerPanel
// is only ever called from inside a later event handler, never at either
// module's own top level.
import { refreshLinerPanel } from './view.js';

const ZOOM_MAX = 3;

let BOOK = null;   // { item, pages: [{index,blob,url}], page, returnFocus }
let swipeGesture = null, pinchGesture = null;

export function isBookletViewerOpen(){ return !!BOOK; }

function paintPage(){
  if(!BOOK) return;
  const page = BOOK.pages[BOOK.page];
  const img = $('#bookletPageImg');
  img.src = page.url;
  img.style.transform = '';
  $('#bookletPageCount').textContent = (BOOK.page + 1) + ' / ' + BOOK.pages.length;
  document.querySelectorAll('.booklet-thumb').forEach((btn, i) => btn.classList.toggle('current', i === BOOK.page));
}

function buildThumbnailStrip(){
  const strip = $('#bookletThumbStrip');
  strip.innerHTML = '';
  BOOK.pages.forEach((p, i) => {
    const btn = el('button', 'booklet-thumb');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Page ' + (i + 1));
    btn.style.backgroundImage = 'url(' + p.url + ')';
    btn.addEventListener('click', () => goToPage(i));
    strip.appendChild(btn);
  });
}

function goToPage(i){
  if(!BOOK) return;
  BOOK.page = Math.max(0, Math.min(BOOK.pages.length - 1, i));
  paintPage();
}

// Horizontal swipe, direction-locked the same ~8px way gatefoldWireGestures()
// (view.js) locks its own panel swipe, committing a page turn past 60px --
// identical shape, a fresh instance since this layer's own stage differs.
function wireSwipe(stage){
  let start = null;
  const onDown = e => {
    if(pinchGesture) return;   // a second finger is already driving the pinch below
    start = { x: e.clientX, y: e.clientY, locked: null };
  };
  const onMove = e => {
    if(!start || pinchGesture) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if(!start.locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) start.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    if(start.locked === 'h'){
      e.preventDefault();
      const page = $('#bookletPageImg');
      page.style.transition = 'none';
      page.style.transform = 'translateX(' + dx + 'px)';
    }
  };
  const onUp = e => {
    if(!start) return;
    const dx = e.clientX - start.x;
    const page = $('#bookletPageImg');
    page.style.transition = REDUCED ? 'none' : 'transform 200ms ease';
    page.style.transform = '';
    if(start.locked === 'h' && Math.abs(dx) > 60) goToPage(BOOK.page + (dx < 0 ? 1 : -1));
    start = null;
  };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  return () => {
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
  };
}

// Two-pointer pinch, scoped to the current page image only -- tracks the
// live distance ratio between the two touches and applies it as a CSS
// scale, clamped to [1, ZOOM_MAX]; lifting either finger resets to 1x
// (this is "read up close," not a persistent zoom level across pages).
function wirePinch(stage){
  const active = new Map();
  let startDist = null, startScale = 1;
  function dist(){
    const pts = [...active.values()];
    if(pts.length < 2) return null;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
  function onDown(e){
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(active.size === 2){ startDist = dist(); startScale = 1; pinchGesture = true; }
  }
  function onMove(e){
    if(!active.has(e.pointerId)) return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(active.size === 2 && startDist){
      e.preventDefault();
      const scale = Math.max(1, Math.min(ZOOM_MAX, startScale * (dist() / startDist)));
      $('#bookletPageImg').style.transform = 'scale(' + scale + ')';
    }
  }
  function onUp(e){
    active.delete(e.pointerId);
    if(active.size < 2 && pinchGesture){
      pinchGesture = false; startDist = null;
      const img = $('#bookletPageImg');
      img.style.transition = REDUCED ? 'none' : 'transform 200ms ease';
      img.style.transform = '';
    }
  }
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  return () => {
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
  };
}

export async function openBookletViewer(item){
  if(BOOK) return;
  const rows = await bookletPages(item.albumId);
  if(!rows.length) return;
  BOOK = {
    item, page: 0, returnFocus: document.activeElement,
    pages: rows.map(r => ({ index: r.index, blob: r.blob, url: URL.createObjectURL(r.blob) })),
  };
  $('#bookletViewerAlbum').textContent = item.album;
  buildThumbnailStrip();
  paintPage();
  const stage = $('#bookletPageStage');
  swipeGesture = wireSwipe(stage);
  BOOK.teardownPinch = wirePinch(stage);
  pinchGesture = false;
  const sheet = $('#bookletViewer');
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden','false');
  requestAnimationFrame(() => sheet.classList.add('show'));
  openLayer('booklet-viewer', closeBookletViewer, { container: sheet });
}

export async function closeBookletViewer(){
  if(!BOOK) return;
  const b = BOOK; BOOK = null;
  if(swipeGesture){ swipeGesture(); swipeGesture = null; }
  if(b.teardownPinch) b.teardownPinch();
  pinchGesture = false;
  const sheet = $('#bookletViewer');
  sheet.classList.remove('show');
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden','true');
  revokePageUrlsFor(b);
  if(b.returnFocus && document.contains(b.returnFocus) && typeof b.returnFocus.focus === 'function') b.returnFocus.focus();
}
function revokePageUrlsFor(b){ b.pages.forEach(p => { if(p.url) try{ URL.revokeObjectURL(p.url); }catch(_e){} }); } // already revoked -- expected, not logged

// GF10 point 1's other entry point: "Add booklet pages…" from the panel.
// `pendingAddItem` bridges the click (which must open #bookletAddFile
// synchronously, iOS Safari) to the input's own later 'change' event,
// wired once in src/wiring/gatefold.js.
let pendingAddItem = null;
export function openAddBookletPagesPicker(item){
  pendingAddItem = item;
  $('#bookletAddFile').click();
}
export async function handleBookletAddFileChange(files){
  const item = pendingAddItem;
  pendingAddItem = null;
  if(!item || !files || !files.length) return;
  const sorted = Array.from(files).sort((a,b) => a.name.localeCompare(b.name));
  await addBookletPages(item.albumId, sorted);
  refreshLinerPanel(item);
}
