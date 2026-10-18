/* ================= library =================
   Moved out of main.js (step 7d): the "library" section's row/group
   renderers and selection/deletion UI helpers, plus renderTracks() itself
   — the function that actually draws the Songs/Artists/Playlists/crate
   tabs, search results, and the breadcrumb/drill-down between them.
   renderTracks() used to sit ~900 lines further down in main.js, inside
   the misleadingly-named "S3: gatefold album view" header (which also
   covers the gatefold and the sealed-record sheet, neither of which moved
   here — that's step 7e's territory, see src/crate/view.js's own step 7c
   note) — purely a physical-position accident, not because it has
   anything to do with the gatefold. */
import { S, touchBackupField } from '../state.js';
import { $, el } from '../util/dom.js';
import { fmt } from '../player/clock.js';
import { setQueue } from '../player/queue.js';
import { trackHasCreditsContent, albumLinerNotes, albumCreditRoll, creditRow, renderPersonView } from './credits.js';
import { isFavorite } from './favorites.js';
import { queueSave } from '../storage/meta.js';
import { byName, groupBy, allIdx, albumTracks, idOf, idxOf } from './model.js';
import { overlays, artwork } from '../storage/repo.js';
import { applyEdit, showUndoBanner } from './edit.js';
import { countForAlbum, countForArtist, deleteAlbum, deleteArtist } from './delete.js';
import { isAlbumSealed } from './sealed.js';
import { albumKey } from '../record-art/tiers.js';
import { renderSidebarPlaylists } from '../shell/sidebar.js';
import {
  librarySortBar, librarySortComparator, sortAlbumGroups, renderSearchResults, filterSearchInPlace,
} from './search.js';
import { centerEmptyState, renderCrate } from '../crate/view.js';
import { setPathNote } from '../ui/path-note.js';
import { updateLibTabsForLayout, updateHeaderActionsAvailability, refreshLibraryTools } from '../shell/header.js';

// NV6 (docs/11_SMOOTH_NAVIGATION.md): for a library with more rows than fit
// on a single screen (~400+), the first screenful renders synchronously —
// so the tab paints immediately — and the rest trickle in a chunk at a
// time during idle time, so a huge library never costs one giant
// synchronous append that could block a tap or audio. iOS Safari has no
// requestIdleCallback at all, so setTimeout is the universal fallback;
// either way each chunk is small enough to never show up as a long task.
// viewRenderGen is a generation token, the same "stale work gives up
// gracefully" shape as S.gen for audio sources (CLAUDE.md rule 9) — it lets
// a still-running chunk job notice the view moved on (another render, a
// tab switch, a new search) and quietly stop instead of appending into a
// list nobody's looking at any more.
const CHUNK_THRESHOLD = 400;
const CHUNK_FIRST = 60;
const CHUNK_SIZE = 120;
let viewRenderGen = 0;

function scheduleIdle(fn){
  if(typeof requestIdleCallback === 'function') requestIdleCallback(fn, {timeout: 200});
  else setTimeout(fn, 0);
}

// Appends one row per item into `host` via makeRow(item, pos). At or under
// CHUNK_THRESHOLD items this is exactly a plain forEach (the previous,
// fully-synchronous behavior, unchanged for every library this size or
// smaller). Past it, the first CHUNK_FIRST rows still render synchronously
// — so the screen the user is actually looking at is complete the instant
// renderTracks() returns — and the rest render CHUNK_SIZE at a time on
// later idle turns.
function appendRowsChunked(host, items, makeRow){
  if(items.length <= CHUNK_THRESHOLD){
    items.forEach((item, pos) => host.appendChild(makeRow(item, pos)));
    return;
  }
  const gen = viewRenderGen;
  let at = 0;
  const firstEnd = Math.min(CHUNK_FIRST, items.length);
  for(; at < firstEnd; at++) host.appendChild(makeRow(items[at], at));
  function next(){
    if(gen !== viewRenderGen) return; // the view moved on — stop appending
    const end = Math.min(at + CHUNK_SIZE, items.length);
    for(; at < end; at++) host.appendChild(makeRow(items[at], at));
    if(at < items.length) scheduleIdle(next);
  }
  if(at < items.length) scheduleIdle(next);
}

function artFor(indices){
  const withArt = indices.find(i => S.tracks[i].art);
  return withArt === undefined ? null : S.tracks[withArt].art;
}

export function songRow(i, queue, pos, extra){
  const t = S.tracks[i];
  const li = el('li');
  li.dataset.id = t.id;
  if(i === S.index) li.setAttribute('aria-current','true');
  if(S.view.editSelecting && S.editSelection.has(t.id)) li.classList.add('picked');
  const idx = el('span','t-idx', String(pos + 1).padStart(2,'0'));
  li.appendChild(idx);
  if(t.art){
    const im = el('img','t-art'); im.src = t.art; im.alt='';
    // NV6 (docs/11_SMOOTH_NAVIGATION.md): a large library can have
    // thousands of these — lazy/async decoding keeps an off-screen row's
    // art from costing anything until it's actually scrolled near, and the
    // fixed width/height (matching .t-art's own CSS, 02-stage-platter.css)
    // means the browser never has to reflow once the image actually loads.
    im.loading = 'lazy'; im.decoding = 'async';
    im.width = 34; im.height = 34;
    li.appendChild(im);
  }
  else li.appendChild(el('span','t-art'));
  const name = el('span','t-name');
  name.appendChild(el('b', null, t.tags.title));
  name.appendChild(el('em', null, t.tags.artist + ' · ' + t.meta.codec
    + (t.meta.lossless ? '' : ' · lossy')));
  li.appendChild(name);
  li.appendChild(el('span','t-dur', fmt(t.duration)));
  if(!S.view.editSelecting){
    const editBtn = el('button','t-edit','⋯');
    editBtn.setAttribute('aria-label','Track options');
    editBtn.addEventListener('click', e => { e.stopPropagation(); openRowMenu(t); });
    li.appendChild(editBtn);
  }
  li.addEventListener('click', ()=>{
    if(S.view.editSelecting){ toggleEditSelect(t.id, li); return; }
    if(S.view.picking){ togglePick(i, li); return; }
    // NV6: looked up live (rather than the `pos` this row was built with)
    // so a row kept across library/search.js's own in-place search-result
    // filtering — which narrows `queue` in place rather than rebuilding it,
    // see that module's own filterSongsSection() — always plays from its
    // current position in whatever `queue` now holds, never a stale one.
    // Every other caller still gets the exact same value `pos` always was,
    // since nothing else ever mutates a `queue` array after building it.
    setQueue(queue, queue.indexOf(i), true);
  });
  if(extra) extra(li, i);
  return li;
}

// NV3 (docs/11_SMOOTH_NAVIGATION.md): a targeted patch for one row, instead
// of renderTracks()'s whole-list rebuild — for the handful of changes that
// only ever affect a single track's own row: the now-playing marker moving
// (player/transport.js's load()) and a single-track edit's title/artist/art
// (library/edit.js's recomputeTrack()). Patches the row's DOM in place
// rather than rebuilding it, so scroll position and focus are untouched.
// Returns false (doing nothing else) when the row isn't currently on
// screen — grouped/drilled-into views, an active search, or the crate —
// so the caller can fall back to a full renderTracks() exactly as before.
// Escapes a track id for use inside a `[data-id="..."]` attribute selector.
// Backslashes must be escaped *before* quotes, or a value ending in a
// backslash followed by a quote could close the selector's string early
// (CodeQL: incomplete string escaping) -- order matters here.
function idSelector(id){
  return 'li[data-id="' + String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
}

export function updateTrackRow(id){
  const host = $('#libBody');
  if(!host) return false;
  const li = host.querySelector(idSelector(id));
  if(!li) return false;
  const i = idxOf(id);
  if(i < 0) return false;
  const t = S.tracks[i];

  if(i === S.index) li.setAttribute('aria-current', 'true');
  else li.removeAttribute('aria-current');
  li.classList.toggle('picked', S.view.editSelecting && S.editSelection.has(t.id));

  const artEl = li.querySelector('.t-art');
  if(artEl){
    if(t.art){
      let img = artEl.tagName === 'IMG' ? artEl : null;
      if(!img){ img = el('img', 't-art'); img.alt = ''; artEl.replaceWith(img); }
      img.src = t.art;
    } else if(artEl.tagName === 'IMG'){
      artEl.replaceWith(el('span', 't-art'));
    }
  }
  const nameEl = li.querySelector('.t-name');
  if(nameEl){
    nameEl.innerHTML = '';
    nameEl.appendChild(el('b', null, t.tags.title));
    nameEl.appendChild(el('em', null, t.tags.artist + ' · ' + t.meta.codec
      + (t.meta.lossless ? '' : ' · lossy')));
  }
  const durEl = li.querySelector('.t-dur');
  if(durEl) durEl.textContent = fmt(t.duration);

  return true;
}

function toggleEditSelect(id, node){
  if(S.editSelection.has(id)) S.editSelection.delete(id); else S.editSelection.add(id);
  node.classList.toggle('picked', S.editSelection.has(id));
  updateSelectBar();
}

export function enterSelectMode(){
  S.view.editSelecting = true;
  S.editSelection.clear();
  renderTracks();
  updateSelectBar();
}
export function exitSelectMode(){
  S.view.editSelecting = false;
  S.editSelection.clear();
  renderTracks();
}
function updateSelectBar(){
  $('#selectCount').textContent = S.editSelection.size + ' selected';
  $('#selectEdit').disabled = S.editSelection.size === 0;
  $('#selectNumber').disabled = S.editSelection.size === 0;
  $('#selectDelete').disabled = S.editSelection.size === 0;
}

/* ---- deletion UI: row overflow menu + shared confirm dialog ----
   No undo window (see LIBRARY spec §4) — the confirm dialog is the
   safeguard, and its copy must be unambiguous that files stay on disk. */
export let rowMenuTrackId = null;
function openRowMenu(t){
  rowMenuTrackId = t.id;
  $('#rowMenuTitle').textContent = t.tags.title;
  $('#rowMenuCredits').style.display = trackHasCreditsContent(t) ? '' : 'none';
  $('#rowMenuFav').textContent = isFavorite(t.id) ? 'Remove from Favorites' : 'Add to Favorites';
  $('#rowMenuOverlay').classList.add('open');
  $('#rowMenuOverlay').setAttribute('aria-hidden','false');
}
export function closeRowMenu(){
  rowMenuTrackId = null;
  $('#rowMenuOverlay').classList.remove('open');
  $('#rowMenuOverlay').setAttribute('aria-hidden','true');
}

/* Liner notes & credits (CREDITS spec §1) and credits that link: person
   view (CREDITS spec §2) moved to src/library/credits.js (step 5e). */

export let confirmDeleteAction = null;
export function openConfirmDelete(kind, count, name, action){
  $('#confirmTitle').textContent = kind === 'song' ? 'Remove song' :
    kind === 'album' ? 'Remove album' : kind === 'artist' ? 'Remove artist' : 'Remove songs';
  const noun = count === 1 ? 'track' : 'tracks';
  const nameBit = name ? '“' + name + '” — ' : '';
  $('#confirmBody').textContent = nameBit + count + ' ' + noun + ' will be removed from Miziki’s library. '
    + 'This removes ' + (count === 1 ? 'it' : 'them') + ' from the library only, not from disk — your files stay where they are.';
  confirmDeleteAction = action;
  $('#confirmOverlay').classList.add('open');
  $('#confirmOverlay').setAttribute('aria-hidden','false');
}
export function closeConfirmDelete(){
  confirmDeleteAction = null;
  $('#confirmOverlay').classList.remove('open');
  $('#confirmOverlay').setAttribute('aria-hidden','true');
}

// numbers the current selection 1..N in whatever order it's currently
// displayed in — session tracking needs a real order, which an untagged
// hand-assembled folder otherwise has no reliable way to express
export async function applyTrackNumbersInOrder(){
  const ids = [];
  document.querySelectorAll('#libBody .tracklist li').forEach(li => {
    if(S.editSelection.has(li.dataset.id)) ids.push(li.dataset.id);
  });
  if(!ids.length) return;
  const prevOverlays = {}, prevArt = {};
  for(const id of ids){ prevOverlays[id] = await overlays.get(id); prevArt[id] = await artwork.get(id); }
  for(let k = 0; k < ids.length; k++){ await applyEdit([ids[k]], {track: k + 1}, null); }
  S.lastUndo = {trackIds: ids.slice(), prevOverlays, prevArt};
  showUndoBanner(ids.length);
  exitSelectMode();
}

export function groupRow(label, sub, indices, onTap){
  const b = el('button','grouprow');
  const art = artFor(indices);
  if(art){
    const im = el('img','g-art'); im.src = art; im.alt='';
    im.loading = 'lazy'; im.decoding = 'async';
    im.width = 44; im.height = 44;
    b.appendChild(im);
  }
  else b.appendChild(el('span','g-art','◍'));
  const box = el('span','g-text');
  box.appendChild(el('b', null, label));
  box.appendChild(el('em', null, sub));
  b.appendChild(box);
  b.appendChild(el('span','g-chev','›'));
  b.addEventListener('click', onTap);
  return b;
}

function togglePick(i, node){
  const pl = S.playlists[S.view.playlist];
  if(!pl) return;
  // playlist items are track ids, not positions (F3 spec) — see
  // src/library/model.js's own note on S.albumOrder for why
  const id = idOf(i);
  const at = pl.items.indexOf(id);
  if(at >= 0) pl.items.splice(at,1); else pl.items.push(id);
  queueSave();
  touchBackupField('playlists');
  node.classList.toggle('picked', at < 0);
}

/* Favorites (a real playlist, not a separate flag) moved to
   src/library/favorites.js (step 5e). */

function moveIn(arr, pos, dir){
  const n = pos + dir;
  if(n < 0 || n >= arr.length) return false;
  const tmp = arr[pos]; arr[pos] = arr[n]; arr[n] = tmp;
  return true;
}

/* if the reordered list is the queue you are hearing, follow the change */
function syncQueueOrder(order){
  if(S.baseQueue.length !== order.length) return;
  if(!S.baseQueue.every(i => order.indexOf(i) >= 0)) return;
  S.baseQueue = order.slice();
  if(!S.shuffle){ S.queue = order.slice(); S.qpos = Math.max(0, S.queue.indexOf(S.index)); }
}

function moverCtl(list, pos, after){
  const box = el('span','movers');
  [['▲',-1],['▼',1]].forEach(([glyph,dir]) => {
    const b = el('button','mv',glyph);
    b.setAttribute('aria-label', dir < 0 ? 'Move up' : 'Move down');
    b.addEventListener('click', e => {
      e.stopPropagation();
      if(moveIn(list, pos, dir)){ if(after) after(list); queueSave(); renderTracks(); }
    });
    box.appendChild(b);
  });
  return box;
}

function sortBar(album){
  const bar = el('div','sortbar');
  bar.appendChild(el('span', null, 'Order'));
  const seg = el('div','seg');
  const mode = S.albumSort[album] || 'auto';
  [['auto','Track no.'],['title','Title'],['manual','Manual']].forEach(([k,label]) => {
    const b = el('button', null, label);
    b.setAttribute('aria-pressed', String(mode === k));
    b.addEventListener('click', ()=>{
      if(k === 'manual' && !S.albumOrder[album]){ S.albumOrder[album] = albumTracks(album); touchBackupField('albumOrder'); }
      S.albumSort[album] = k;
      touchBackupField('albumSort');
      syncQueueOrder(albumTracks(album));
      queueSave();
      renderTracks();
    });
    seg.appendChild(b);
  });
  bar.appendChild(seg);
  return bar;
}

// Shared by the Albums tab's own drill-down and an artist's per-album
// drill-down (see LIBRARY spec — artist view should pick an album first,
// not flatten every song from every album into one list).
function renderAlbumDetail(host, ul, album){
  const mode = S.albumSort[album] || 'auto';
  const liner = albumLinerNotes(album);
  const roll = albumCreditRoll(album);
  if(liner || roll.size){
    const section = el('div','credit-section');
    section.appendChild(el('h3', null, 'Liner notes'));
    if(liner) section.appendChild(el('p','credit-note', liner));
    roll.forEach((names, label) => section.appendChild(creditRow(label, names)));
    host.appendChild(section);
  }
  host.appendChild(sortBar(album));
  const q = albumTracks(album);
  q.forEach((i,pos) => {
    const row = songRow(i, q, pos);
    if(mode === 'manual'){
      // position within the saved (id-based) order, not within q — q
      // only lists tracks currently present, so the two can diverge once
      // a track in this album has been forgotten but not yet reconnected
      const fullPos = S.albumOrder[album].indexOf(idOf(i));
      row.appendChild(moverCtl(S.albumOrder[album], fullPos, ord => { touchBackupField('albumOrder'); syncQueueOrder(ord.map(idxOf).filter(x => x >= 0)); }));
    }
    ul.appendChild(row);
  });
  host.appendChild(ul);
  if(mode === 'manual') host.appendChild(el('p','note',
    'Your order for this album holds for the session. Tap a track to play the album in this order.'));
}

/* Library-wide search + sort, and tag-aware search (CREDITS spec §3),
   moved to src/library/search.js (step 5e). */

/* S4: crate image tiers and the crate data model moved to
   src/crate/tiers.js/model.js (step 7c) — it sat in this same section
   only by physical accident, not because grouping/sorting albums is
   image-tier work. */

// NV3 (docs/11_SMOOTH_NAVIGATION.md): "anchor-preserving" rebuilds —
// renderTracks() wipes and rebuilds #libBody's whole contents every time
// (sort/filter/group can all change between one render and the next, so a
// partial patch here isn't generally possible, unlike updateTrackRow()'s
// one-row case above). Finding the first row still on screen before the
// rebuild and scrolling that same row (by id) back to the same screen
// position after it is what actually keeps a rebuild from reading as a
// jump — same "the id survives the rebuild, the position doesn't" idea as
// crate/model.js's own persistCrateAnchor().
function captureScrollAnchor(host){
  if(!host || typeof host.querySelectorAll !== 'function') return null;
  const rows = host.querySelectorAll('li[data-id]');
  let target = null;
  for(const li of rows){
    if(typeof li.getBoundingClientRect !== 'function') continue;
    if(li.getBoundingClientRect().bottom > 0){ target = li; break; }
  }
  if(!target) return null;
  const rect = target.getBoundingClientRect();
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  let focusSelector = null;
  if(active && active !== target && typeof target.contains === 'function' && target.contains(active)){
    const cls = active.className && String(active.className).trim();
    focusSelector = cls ? '.' + cls.split(/\s+/).join('.') : null;
  }
  return { id: target.dataset.id, top: rect.top, focusSelector };
}

function restoreScrollAnchor(host, anchor){
  if(!host || !anchor) return;
  const li = host.querySelector(idSelector(anchor.id));
  if(!li || typeof li.getBoundingClientRect !== 'function') return;
  const delta = li.getBoundingClientRect().top - anchor.top;
  if(delta && typeof window !== 'undefined' && window.scrollBy) window.scrollBy(0, delta);
  if(anchor.focusSelector){
    const target = li.querySelector(anchor.focusSelector);
    if(target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }
}

export function renderTracks(){
  const host = $('#libBody');
  // NV6 (docs/11_SMOOTH_NAVIGATION.md): "filter the existing rows rather
  // than rebuilding when possible" — a narrowing search-query refinement
  // (library/search.js's own canFilterInPlace()) can patch the already-
  // rendered search results directly and skip renderTracksBody() entirely,
  // since that function's own host.innerHTML = '' reset (below) would
  // otherwise tear down the very rows there'd be nothing left to filter.
  const query = $('#librarySearch').value.trim();
  if(query && filterSearchInPlace(host, query)) return;
  const anchor = captureScrollAnchor(host);
  try{ renderTracksBody(host); }
  finally{ restoreScrollAnchor(host, anchor); }
}

function renderTracksBody(host){
  viewRenderGen++; // invalidate any chunked append job still running from a previous render
  host.innerHTML = '';
  // D3 (docs/DESKTOP_LAYOUT.md): every S.playlists mutation already lands
  // here (see this module's own CLAUDE.md entry — it's the hub every
  // library-mutating action's "now redraw the screen" call reaches), so
  // this is the one place the desktop sidebar's own playlists list needs
  // to be kept in sync from, rather than adding a second call site at
  // each of S.playlists' own mutation points.
  renderSidebarPlaylists();
  const v = S.view;
  $('#empty').style.display = S.tracks.length ? 'none' : 'block';
  if(!S.tracks.length) centerEmptyState();
  $('#selectToggle').style.display = (S.tracks.length && v.mode !== 'crate') ? '' : 'none';
  $('#selectBar').style.display = v.editSelecting ? 'flex' : 'none';
  updateLibTabsForLayout();
  updateHeaderActionsAvailability();
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v.mode)));
  refreshLibraryTools();
  // D5 (docs/DESKTOP_LAYOUT.md): hidden by default every render, same as
  // #crumb just below — the crate branch (renderCrate() -> crate/view.js's
  // own updateCrateGroupToggleUI()) is what turns this back on when
  // S.view.mode is actually 'crate'. Since RF8 (docs/12_REFINE.md), this is
  // the one home for crate grouping on every platform, not desktop-only.
  $('#crateGroupToggleTab').style.display = 'none';
  if(!S.tracks.length){ setPathNote(); return; }

  // a live search takes over the whole body, grouped by type, regardless
  // of whatever songs/albums/artists/playlists/crate view is otherwise
  // selected (see PLAYBACK spec §4) — clearing it returns to that view
  // untouched
  const query = $('#librarySearch').value.trim();
  if(query){
    $('#crumb').style.display = 'none';
    renderSearchResults(host, query);
    return;
  }

  // the crate is its own tab now (replacing Albums when the layout is
  // Crate) rather than a second top-level layout over all four tabs, so
  // Songs/Artists/Playlists are never hidden by it (S1/S2 spec)
  if(v.mode === 'crate'){
    $('#crumb').style.display = 'none';
    renderCrate(host);
    setPathNote();
    return;
  }

  // breadcrumb when drilled into an album, artist (and its albums), playlist,
  // person, or an artist's loose-tracks page opened from the crate
  const crumb = $('#crumb');
  const inside = v.group !== null || v.playlist !== null || v.mode === 'person' || v.mode === 'crateLoose';
  crumb.style.display = inside ? 'flex' : 'none';
  if(inside){
    crumb.innerHTML = '';
    const atArtistAlbum = v.mode === 'artists' && v.artistAlbum !== null;
    // an album or loose-tracks page reached from the crate says so, and
    // returning lands back in the crate at the same position (CRATE spec §4)
    const fromCrate = S.libraryLayout === 'crate'
      && ((v.mode === 'albums' && v.group !== null && !atArtistAlbum) || v.mode === 'crateLoose');
    const back = el('button','crumb-back', fromCrate ? '‹ Crate' : '‹ Back');
    back.addEventListener('click', ()=>{
      if(v.mode === 'person'){
        const r = v.personReturn;
        v.person = null; v.personReturn = null;
        if(r){ v.mode = r.mode; v.group = r.group; v.artistAlbum = r.artistAlbum; v.playlist = r.playlist; }
        else v.mode = 'songs';
      }
      else if(v.mode === 'crateLoose'){ v.mode = 'songs'; v.crateLooseIdx = null; v.crateLooseArtist = null; }
      else if(atArtistAlbum) v.artistAlbum = null;
      // an album opened from the crate returns to the crate itself, not the
      // flat albums grid underneath it (S1/S2 spec: crate is its own tab)
      else if(v.mode === 'albums' && S.libraryLayout === 'crate'){ v.group = null; v.mode = 'crate'; }
      else { v.group = null; v.playlist = null; v.picking = false; }
      renderTracks();
    });
    crumb.appendChild(back);
    crumb.appendChild(el('span','crumb-label',
      v.mode === 'person' ? v.person : (v.mode === 'crateLoose' ? v.crateLooseArtist :
      (v.playlist !== null ? S.playlists[v.playlist].name : (atArtistAlbum ? v.artistAlbum : v.group)))));
    // Album/artist deletion lives right where you're looking at that album
    // or artist — offered even for a single-album artist, no conditional
    // collapsing to album deletion (see LIBRARY spec §4)
    if(v.playlist === null && v.group !== null && (v.mode === 'albums' || v.mode === 'artists')){
      const removeBtn = el('button','crumb-back', (v.mode === 'albums' || atArtistAlbum) ? 'Remove Album' : 'Remove Artist');
      removeBtn.style.marginLeft = 'auto';
      removeBtn.addEventListener('click', ()=>{
        const group = v.group;
        if(v.mode === 'albums'){
          openConfirmDelete('album', countForAlbum(group), group, async () => { deleteAlbum(group); v.group = null; renderTracks(); });
        } else if(atArtistAlbum){
          const album = v.artistAlbum;
          const artist = v.group;
          openConfirmDelete('album', countForAlbum(album), album, async () => {
            deleteAlbum(album);
            v.artistAlbum = null;
            // if that was the artist's last album, there's nothing left to
            // pick from — back out to the artist list instead of an empty screen
            if(!countForArtist(artist)) v.group = null;
            renderTracks();
          });
        } else {
          openConfirmDelete('artist', countForArtist(group), group, async () => { deleteArtist(group); v.group = null; renderTracks(); });
        }
      });
      crumb.appendChild(removeBtn);
    }
  }

  const ul = el('ul','tracklist');

  if(v.mode === 'songs'){
    const q = allIdx().sort(librarySortComparator('songs'));
    host.appendChild(librarySortBar(q.length, q.length === 1 ? 'Song' : 'Songs'));
    host.appendChild(ul);
    appendRowsChunked(ul, q, (i, pos) => {
      const row = songRow(i, q, pos);
      if(isAlbumSealed(albumKey(S.tracks[i]))) row.querySelector('.t-name').appendChild(el('span','new-tag','NEW'));
      return row;
    });
  }

  else if(v.mode === 'person'){
    renderPersonView(host, v.person);
  }

  else if(v.mode === 'crateLoose'){
    const idx = v.crateLooseIdx || [];
    idx.forEach((i,pos) => ul.appendChild(songRow(i, idx, pos)));
    host.appendChild(ul);
  }

  else if(v.mode === 'albums'){
    if(v.group === null){
      const groups = sortAlbumGroups(groupBy('album'));
      host.appendChild(librarySortBar(groups.length, groups.length === 1 ? 'Album' : 'Albums'));
      appendRowsChunked(host, groups, ([album, idx]) => {
        const artist = S.tracks[idx[0]].tags.albumArtist;
        const row = groupRow(album, artist + ' · ' + idx.length + (idx.length===1?' track':' tracks'),
          idx, ()=>{ v.group = album; renderTracks(); });
        if(isAlbumSealed(albumKey(S.tracks[idx[0]]))) row.querySelector('.g-text b').appendChild(el('span','new-tag','NEW'));
        return row;
      });
    } else {
      renderAlbumDetail(host, ul, v.group);
    }
  }

  else if(v.mode === 'artists'){
    if(v.group === null){
      appendRowsChunked(host, groupBy('artist'), ([artist, idx]) => {
        const albums = new Set(idx.map(i => S.tracks[i].tags.album)).size;
        return groupRow(artist, albums + (albums===1?' album · ':' albums · ') + idx.length
          + (idx.length===1?' track':' tracks'), idx, ()=>{ v.group = artist; renderTracks(); });
      });
    } else if(v.artistAlbum === null){
      // an artist with multiple albums lands here first — pick an album
      // before seeing its tracks, same as the top-level Albums view, rather
      // than dumping every song from every album in one flat list
      const idx = allIdx().filter(i => S.tracks[i].tags.artist === v.group);
      const albums = new Map();
      idx.forEach(i => {
        const album = S.tracks[i].tags.album;
        if(!albums.has(album)) albums.set(album, []);
        albums.get(album).push(i);
      });
      [...albums.entries()].sort((a,b) => byName(a[0], b[0])).forEach(([album, aidx]) => {
        host.appendChild(groupRow(album, aidx.length + (aidx.length===1?' track':' tracks'),
          aidx, ()=>{ v.artistAlbum = album; renderTracks(); }));
      });
    } else {
      renderAlbumDetail(host, ul, v.artistAlbum);
    }
  }

  else if(v.mode === 'playlists'){
    if(v.playlist === null){
      if(!S.playlists.length) host.appendChild(el('p','note','Make your first playlist.'));
      // Favorites (and any other system playlist) pinned first, without
      // reordering S.playlists itself — v.playlist indexes the real array
      const order = S.playlists.map((_, n) => n).sort((a, b) => (S.playlists[a].system?0:1) - (S.playlists[b].system?0:1));
      order.forEach(n => {
        const pl = S.playlists[n];
        // playlist items are track ids (F3 spec) — the count/art shown
        // here is of the tracks currently reconnected; a forgotten track
        // stays in the playlist but isn't counted until it comes back
        const present = pl.items.map(idxOf).filter(i => i >= 0);
        host.appendChild(groupRow(pl.name, present.length + (present.length===1?' track':' tracks'),
          present, ()=>{ v.playlist = n; renderTracks(); }));
      });
      const add = el('div','stack');
      const nameIn = el('input','pl-input'); nameIn.placeholder = 'New playlist name'; nameIn.id = 'plName';
      const mk = el('button','cta','Create');
      mk.addEventListener('click', ()=>{
        const nm = nameIn.value.trim(); if(!nm) return;
        S.playlists.push({name:nm, items:[]}); queueSave(); touchBackupField('playlists');
        v.playlist = S.playlists.length - 1; v.picking = true; renderTracks();
      });
      add.appendChild(nameIn); add.appendChild(mk);
      host.appendChild(add);
    } else {
      const pl = S.playlists[v.playlist];
      if(v.picking){
        host.appendChild(el('p','note','Tap tracks to add or remove them, then tap Done.'));
        const all = allIdx().sort((a,b) => byName(S.tracks[a].tags.title, S.tracks[b].tags.title));
        all.forEach((i,pos) => {
          const row = songRow(i, all, pos);
          if(pl.items.includes(idOf(i))) row.classList.add('picked');
          ul.appendChild(row);
        });
        host.appendChild(ul);
        const done = el('button','cta','Done');
        done.addEventListener('click', ()=>{ v.picking = false; renderTracks(); });
        const wrap = el('div','stack'); wrap.appendChild(done); host.appendChild(wrap);
      } else {
        // playlist items are track ids (F3 spec) — a forgotten track's id
        // stays in pl.items but is simply skipped here, hidden until a
        // matching file is imported again, at which point it reappears in
        // its saved place rather than at the end
        const present = pl.items.map(idxOf).filter(i => i >= 0);
        if(!present.length) host.appendChild(el('p','note','This playlist is empty.'));
        present.forEach((i,pos) => {
          const row = songRow(i, present, pos);
          if(present.length > 1){
            // move within the full (id-based) order, not within `present`,
            // so a hidden/forgotten entry elsewhere in the playlist keeps
            // its own relative place
            const fullPos = pl.items.indexOf(idOf(i));
            row.appendChild(moverCtl(pl.items, fullPos, ord => { touchBackupField('playlists'); syncQueueOrder(ord.map(idxOf).filter(x => x >= 0)); }));
          }
          ul.appendChild(row);
        });
        host.appendChild(ul);
        const edit = el('button','cta ghost','Add or remove tracks');
        edit.addEventListener('click', ()=>{ v.picking = true; renderTracks(); });
        const wrap = el('div','stack'); wrap.appendChild(edit); host.appendChild(wrap);
      }
    }
  }

  setPathNote();
}
