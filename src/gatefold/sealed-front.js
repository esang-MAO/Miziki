/* ================= GF8: sealed front (docs/29_GATEFOLD.md) =================
   A sealed record can't open the real gatefold yet -- it opens here
   instead: its own cover, still under shrink wrap with the NEW sticker,
   peeled from the top-right corner. Past the threshold the wrap comes
   away, the seal breaks (breakSeal(), library/sealed.js), and the
   gatefold swings open normally, exactly as if the album had never been
   sealed. "Turn it over first" shows the GF5 default back (or a stored
   photo) through the same wrap sheen, without breaking anything -- a
   look, not a commitment.

   GF15: the corner drag (or, under Reduced Motion, a tap on that same
   hotspot) was the only way to break the seal -- a user who didn't find
   or couldn't complete the gesture had no way to unseal short of closing
   back to the crate and trying its own tear-strip affordance there
   instead. "Break the seal" (#sealedFrontUnsealBtn) runs the exact same
   commitPeel() the drag commits into, as a plain tap, right on this
   screen.

   Retires src/gatefold/sealed-sheet.js (GF8 point 4, "one in, one out"):
   that plain tracklist sheet, and its own "tap a track to play" handler,
   are gone -- this screen has no tracklist of its own at all. Playing
   without peeling is still the crate's own quiet-play affordance
   (library/sealed.js's sealedQuietPlay(), moved there from the old sheet
   since it survives this module's own retirement). */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { REDUCED } from '../util/motion.js';
import { thumbURL } from '../library/thumbs.js';
import { getCrateArtURL } from '../crate/tiers.js';
import { fmt } from '../util/text.js';
import { breakSeal } from '../library/sealed.js';
import { buildBackCoverEl, buildBackCoverImageEl, getAlbumBackCoverBlob } from './back-cover.js';
import { formatRecordName, formatSpeedText } from '../record-art/format.js';
import { openGatefold, gatefoldTrackIndices, gatefoldItemFormat } from './view.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';

// past this much diagonal drag (as a fraction of the wrap's own size) the
// peel commits -- same class of threshold as library/sealed.js's own
// wireTearDrag() (50%) and start-sequence.js's shrink-wrap drag (60%).
const PEEL_COMMIT = 0.55;

let FRONT = null;   // {item, turnedOver}, null when closed
let peelGesture = null;   // the live drag/tap listeners, torn down on close

export function isSealedFrontOpen(){ return !!FRONT; }

function formatLine(item){
  const idx = item.idx;
  if(!idx.length) return '';
  const format = gatefoldItemFormat(item);
  const total = idx.reduce((s,i) => s + (S.tracks[i].duration || 0), 0);
  return [formatRecordName(format) + ' · ' + formatSpeedText(format.speed) + ' RPM',
    idx.length + (idx.length === 1 ? ' track' : ' tracks'), fmt(total)].join(' · ');
}

async function paintCover(item, turnedOver){
  const host = $('#sealedFrontCover');
  if(!FRONT || FRONT.item !== item) return;
  host.innerHTML = '';
  if(!turnedOver){
    const img = document.createElement('img');
    img.alt = '';
    img.src = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art) || '';
    host.appendChild(img);
    getCrateArtURL(item.albumId, 'L').then(url => {
      if(url && FRONT && FRONT.item === item && !FRONT.turnedOver) img.src = url;
    });
    return;
  }
  const blob = await getAlbumBackCoverBlob(item.albumId).catch(() => null);
  if(!FRONT || FRONT.item !== item || !FRONT.turnedOver) return;
  const trackIdx = gatefoldTrackIndices(item);
  host.appendChild(blob ? buildBackCoverImageEl(blob, item) : buildBackCoverEl(item, trackIdx, gatefoldItemFormat(item)));
}

// the one terminal animation every trigger (a completed drag, a tap under
// Reduced Motion) ends at -- detach and fall, then the real breakSeal()
// and hand-off into the gatefold, same "the choreography is purely
// visual, breakSeal() takes over for real" split library/sealed.js's own
// runBreakChoreography() uses.
export async function commitPeel(){
  if(!FRONT) return;
  const item = FRONT.item;
  if(peelGesture){ peelGesture.cancel(); peelGesture = null; }
  const wrap = $('#sealedFrontWrap');
  if(REDUCED){
    wrap.classList.add('sealed-front-wrap-fading');
    await sleep(150);
  } else {
    wrap.classList.add('sealed-front-wrap-detached');
    await sleep(400);
  }
  if(!FRONT || FRONT.item !== item) return;
  breakSeal(item.albumId);
  closeLayer('sealed-front');
  openGatefold(item, {});
}

// drives the wrap's own clip-path live from a drag starting anywhere on
// the corner hotspot -- diagonal, not library/sealed.js's horizontal tear
// strip or start-sequence.js's horizontal shrink-wrap drag, since this
// wrap peels from a corner (docs/design/gatefold/Unseal.dc.html), not an
// edge. Released short of PEEL_COMMIT just snaps back to 0.
function wirePeelDrag(hotspot, wrap, fold){
  let dragging = false, cancelled = false, startX = 0, startY = 0, span = 1;
  function setProgress(p){
    const c = Math.max(0, Math.min(1, p));
    const topCut = 100 - c * 42, rightCut = c * 42;
    wrap.style.clipPath = 'polygon(0 0, ' + topCut + '% 0, 100% ' + rightCut + '%, 100% 100%, 0 100%)';
    fold.style.opacity = String(c);
    return c;
  }
  function onDown(e){
    if(cancelled || (e.button != null && e.button !== 0)) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    span = Math.max(1, wrap.getBoundingClientRect().width);
    try{ hotspot.setPointerCapture(e.pointerId); }catch(_err){}
  }
  function onMove(e){
    if(!dragging || cancelled) return;
    e.preventDefault();
    // dragging down-and-left off the top-right corner is forward progress
    const dx = Math.max(0, startX - e.clientX), dy = Math.max(0, e.clientY - startY);
    const progress = setProgress((dx + dy) / span);
    if(progress >= PEEL_COMMIT){ dragging = false; commitPeel(); }
  }
  function onUp(){
    if(!dragging) return;
    dragging = false;
    setProgress(0);
  }
  hotspot.style.touchAction = 'none';
  hotspot.addEventListener('pointerdown', onDown);
  hotspot.addEventListener('pointermove', onMove);
  hotspot.addEventListener('pointerup', onUp);
  hotspot.addEventListener('pointercancel', onUp);
  // GF8 point 5: "REDUCED: tap the corner to peel, with a crossfade" --
  // the same hotspot, a plain tap instead of a drag.
  if(REDUCED) hotspot.addEventListener('click', commitPeel);
  return { cancel(){
    cancelled = true; dragging = false;
    hotspot.removeEventListener('pointerdown', onDown);
    hotspot.removeEventListener('pointermove', onMove);
    hotspot.removeEventListener('pointerup', onUp);
    hotspot.removeEventListener('pointercancel', onUp);
    hotspot.removeEventListener('click', commitPeel);
  } };
}

export function openSealedFront(item){
  if(FRONT) return;
  FRONT = { item, turnedOver: false, returnFocus: document.activeElement };
  const sheet = $('#sealedFront');
  sheet.setAttribute('aria-label', item.album);
  const wrap = $('#sealedFrontWrap');
  wrap.classList.remove('sealed-front-wrap-detached','sealed-front-wrap-fading');
  wrap.style.clipPath = '';
  $('#sealedFrontFold').style.opacity = '0';
  $('#sealedFrontCoverTitle').textContent = item.album;
  $('#sealedFrontArtist').textContent = item.artist + (item.year ? (' · ' + item.year) : '');
  $('#sealedFrontFormat').textContent = formatLine(item);
  $('#sealedFrontTurnBtn').textContent = 'Flip cover';
  paintCover(item, false).catch(() => {});

  const hotspot = $('#sealedFrontHotspot');
  peelGesture = wirePeelDrag(hotspot, wrap, $('#sealedFrontFold'));

  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden','false');
  requestAnimationFrame(() => { sheet.classList.add('show'); $('#sealedFrontCloseBtn').focus(); });
  openLayer('sealed-front', closeSealedFront, { container: sheet });
}

export function toggleSealedFrontTurnedOver(){
  if(!FRONT) return;
  FRONT.turnedOver = !FRONT.turnedOver;
  $('#sealedFrontTurnBtn').textContent = 'Flip cover';
  paintCover(FRONT.item, FRONT.turnedOver).catch(() => {});
}

export async function closeSealedFront(){
  if(!FRONT) return;
  const f = FRONT; FRONT = null;
  if(peelGesture){ peelGesture.cancel(); peelGesture = null; }
  const sheet = $('#sealedFront');
  sheet.classList.remove('show');
  await sleep(REDUCED ? 150 : 250);
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden','true');
  if(f.returnFocus && document.contains(f.returnFocus) && typeof f.returnFocus.focus === 'function') f.returnFocus.focus();
  else { const stage = $('.crate-stage'); if(stage) stage.focus(); }
}

