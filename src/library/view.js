/* ================= library =================
   The "library" section's row/group renderers and selection/deletion UI
   helpers, plus renderTracks() itself — the function that actually draws
   the Songs/Artists/Playlists/crate tabs, search results, and the
   breadcrumb/drill-down between them. The gatefold and sealed-record
   sheet live separately in src/gatefold/ and src/crate/view.js — this
   module has nothing to do with either. */
import { S, touchBackupKey, touchBackupMembership } from '../state.js';
import { $, el } from '../util/dom.js';
import { backHeader, emptyNote, listMenu } from '../ui/parts.js';
import { openPlaylistNameSheet } from './playlist-sheet.js';
import { dragTargetIndex, reorderPresentIds } from './drag-reorder.js';
import { fmt } from '../util/text.js';
import { setQueue, setQueueList, setQpos, playNext, addToQueue } from '../player/queue.js';
import { trackHasCreditsContent, albumCreditRoll, creditRow, renderPersonView, openCreditsSheet } from './credits.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import { appendConnectedShelf } from './connected.js';
import { appendMostSpun, appendArtistHistory, appendPressings } from './artist-shelves.js';
import { albumYearFor, albumArtistFor } from '../crate/model.js';
import { queueSave } from '../storage/meta.js';
import { byName, groupBy, allIdx, idOf, idxOf, trackSort, mostCommonFormat, formatSuffix } from './model.js';
import { albumFormatFor } from '../shell/ceremony-timing.js';
import { formatRecordName } from '../record-art/format.js';
import { overlays, artwork } from '../storage/repo.js';
import { applyEdit, showUndoBanner, openEditSheet } from './edit.js';
import { countForAlbum, countForArtist, deleteAlbum, deleteArtist, deleteTracks } from './delete.js';
import { isAlbumSealed } from './sealed.js';
import { albumKey } from '../record-art/tiers.js';
import { getCrateArtURL } from '../crate/tiers.js';
import { thumbURL } from './thumbs.js';
import { distinctAlbumKeysInOrder, mosaicCells, mosaicLayout } from './playlist-mosaic.js';
import { renderSidebarPlaylists, renderSidebarBins } from '../shell/sidebar.js';
import {
  librarySortBar, librarySortComparator, sortAlbumGroups, renderSearchResults, filterSearchInPlace,
} from './search.js';
import { centerEmptyState, renderCrate, openCrateAlbum } from '../crate/view.js';
import { setPathNote } from '../ui/path-note.js';
import { updateLibTabsForLayout, updateHeaderActionsAvailability, refreshLibraryTools } from '../shell/header.js';
import { letterKeyFor, buildLetterGroups, buildRailTicks } from '../ui/letter-rail.js';
import { openLayer, closeLayer, forceCloseLayer } from '../shell/nav-stack.js';
import { saveScrollPosition, restoreScrollPosition } from '../shell/scroll-memory.js';

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

// CR9 (docs/13_CRATE.md): the thresholds past which Songs/Artists grow a
// sticky letter head + rail — Songs' own 200 is the plan's exact number;
// Artists reuses the crate's own "letter dividers show from 20 records"
// threshold (CR2) for the same reason — a shelf of a handful of artists
// doesn't need a rail to feel navigable.
const SONGS_RAIL_THRESHOLD = 200;
const ARTISTS_RAIL_THRESHOLD = 20;

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
// CR9 (docs/13_CRATE.md): `opts.labelFor`/`opts.headFor` add an optional
// sticky letter head in front of the first row of each new letter bucket
// — kept inside this same chunked-append loop (rather than a second pass
// over the list) so a huge library's idle-time chunks still only touch
// each row once, and so a header's position in the DOM is always exactly
// where the chunking loop actually is, never computed separately from it.
function appendRowsChunked(host, items, makeRow, opts){
  const labelFor = opts && opts.labelFor;
  const headFor = opts && opts.headFor;
  let lastKey = null;
  function appendOne(item, pos){
    if(labelFor){
      const key = letterKeyFor(labelFor(item));
      if(key !== lastKey){ lastKey = key; if(headFor) host.appendChild(headFor(key)); }
    }
    host.appendChild(makeRow(item, pos));
  }
  if(items.length <= CHUNK_THRESHOLD){
    items.forEach((item, pos) => appendOne(item, pos));
    return;
  }
  const gen = viewRenderGen;
  let at = 0;
  const firstEnd = Math.min(CHUNK_FIRST, items.length);
  for(; at < firstEnd; at++) appendOne(items[at], at);
  function next(){
    if(gen !== viewRenderGen) return; // the view moved on — stop appending
    const end = Math.min(at + CHUNK_SIZE, items.length);
    for(; at < end; at++) appendOne(items[at], at);
    if(at < items.length) scheduleIdle(next);
  }
  if(at < items.length) scheduleIdle(next);
}

// A div-based (non-sticky-within-ul) letter head, for the Artists list,
// which renders its rows straight into `host` rather than into a `<ul>`.
function letterHead(key){
  const h = el('div','letter-head', key);
  h.dataset.letterKey = key;
  return h;
}

// Builds the floating A–Z rail itself (CR9's "the crate's rail reused")
// and wires each tick to scroll the matching letter head into view. A
// no-op when there's nothing to group (fewer than one bucket) so callers
// can call this unconditionally once they've already decided the list is
// long enough to want one.
function attachLetterRail(host, groups){
  if(groups.length < 2) return;
  const rail = el('div','lib-rail');
  host.appendChild(rail);
  buildRailTicks(rail, groups, {
    itemClass: 'letter-rail-item', dimClass: 'letter-rail-dim', currentClass: 'letter-rail-current',
    onTap: e_ => {
      const head = host.querySelector('[data-letter-key="' + e_.key + '"]');
      if(head) head.scrollIntoView({block: 'start', behavior: 'smooth'});
    },
  });
}

function artFor(indices){
  const withArt = indices.find(i => S.tracks[i].art);
  return withArt === undefined ? null : S.tracks[withArt].art;
}

// LB4 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 4): pulled out of songRow()
// below so the new playlist-page row (playlistSongRow(), further down)
// can build the same art-thumbnail/title-artist cells without a second,
// drifting copy of this markup -- the one "easy, low-risk" share the
// addendum's own LB4 step calls for between the two row shapes, short of
// a full shared row component (left for LB7, which builds this row style
// everywhere).
function trackArtNode(t){
  if(t.art){
    const im = el('img','t-art'); im.src = t.art; im.alt='';
    // NV6 (docs/11_SMOOTH_NAVIGATION.md): a large library can have
    // thousands of these — lazy/async decoding keeps an off-screen row's
    // art from costing anything until it's actually scrolled near, and the
    // fixed width/height (matching .t-art's own CSS, 02-stage-platter.css)
    // means the browser never has to reflow once the image actually loads.
    im.loading = 'lazy'; im.decoding = 'async';
    im.width = 34; im.height = 34;
    return im;
  }
  return el('span','t-art');
}
function trackNameNode(t){
  const name = el('span','t-name');
  name.appendChild(el('b', null, t.tags.title));
  name.appendChild(el('em', null, t.tags.artist + formatSuffix(t, libCommonFormat)));
  return name;
}

export function songRow(i, queue, pos, extra){
  const t = S.tracks[i];
  const li = el('li');
  li.dataset.id = t.id;
  if(i === S.index) li.setAttribute('aria-current','true');
  if(S.view.editSelecting && S.editSelection.has(t.id)) li.classList.add('picked');
  const idx = el('span','t-idx', String(pos + 1).padStart(2,'0'));
  li.appendChild(idx);
  li.appendChild(trackArtNode(t));
  li.appendChild(trackNameNode(t));
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
    nameEl.appendChild(el('em', null, t.tags.artist + formatSuffix(t, libCommonFormat)));
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

// every track id currently rendered as a row in #libBody, in display order
// — the same "read the DOM in its current order" shape
// applyTrackNumbersInOrder() already uses just below. Whatever's on screen
// (the flat Songs list, a drilled-into album/artist/playlist, a crateLoose
// page, or a live search) is what "select all" means here, since select
// mode itself works the same way across every one of those views.
function visibleTrackIds(){
  const ids = [];
  const host = $('#libBody');
  if(host) host.querySelectorAll('li[data-id]').forEach(li => ids.push(li.dataset.id));
  return ids;
}

// toggles between selecting every currently-visible track and clearing the
// selection entirely — a second tap undoes the first, the same shape a
// single row's own tap already has
export function selectAllVisible(){
  const ids = visibleTrackIds();
  if(!ids.length) return;
  const allPicked = ids.every(id => S.editSelection.has(id));
  if(allPicked) ids.forEach(id => S.editSelection.delete(id));
  else ids.forEach(id => S.editSelection.add(id));
  renderTracks();
  updateSelectBar();
}

function updateSelectBar(){
  $('#selectCount').textContent = S.editSelection.size + ' selected';
  $('#selectEdit').disabled = S.editSelection.size === 0;
  $('#selectNumber').disabled = S.editSelection.size === 0;
  $('#selectDelete').disabled = S.editSelection.size === 0;
  const ids = visibleTrackIds();
  const allPicked = ids.length > 0 && ids.every(id => S.editSelection.has(id));
  const allBtn = $('#selectAll');
  if(allBtn){
    allBtn.disabled = ids.length === 0;
    allBtn.textContent = allPicked ? 'Select none' : 'Select all';
  }
}

/* ---- deletion UI: row overflow menu + shared confirm dialog ----
   No undo window (see LIBRARY spec §4) — the confirm dialog is the
   safeguard, and its copy must be unambiguous that files stay on disk. */
// UN3 (docs/36_UNIFORMITY.md): the header (cover/title/artist · album)
// and the list-menu body are rebuilt from scratch on every open, since
// both depend on this one track -- same "rebuild, don't diff" posture
// openGatefoldTrackMenu() (gatefold/view.js) already takes for its own
// per-track sheet. "Add to playlist…" is left out, see miziki.html's own
// comment on #rowMenuOverlay for why.
// LB4 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 4): `extraGroups` (an
// array of groups, same shape as this function's own return value) lets
// a caller insert context-only rows -- today just the playlist page's own
// "Move up"/"Move down"/"Remove from this playlist" (openPlaylistRowMenu()
// below) -- ahead of the library-wide "Remove from library…" group, which
// always stays last. Reusing this one sheet rather than a second menu
// component is the same "share the sheet, not the row" posture this step
// took for trackArtNode()/trackNameNode() above.
function rowMenuGroups(t, extraGroups){
  const groups = [
    [
      { label: 'Play next', onClick: () => { const i = idxOf(t.id); if(i >= 0) rowMenuPlayNext(i); } },
      { label: 'Add to queue', onClick: () => { const i = idxOf(t.id); if(i >= 0) rowMenuAddQueue(i); } },
    ],
    [
      { label: isFavorite(t.id) ? 'Remove from Favorites' : 'Add to Favorites', onClick: () => rowMenuToggleFavorite(t.id) },
      ...(trackHasCreditsContent(t) ? [{ label: 'Credits and notes', onClick: () => rowMenuOpenCredits(t) }] : []),
      { label: 'Edit info', onClick: () => rowMenuEditInfo(t.id) },
    ],
  ];
  if(extraGroups && extraGroups.length) groups.push(...extraGroups);
  groups.push([
    { label: '!Remove from library…', onClick: () => rowMenuRemove(t.id) },
  ]);
  return groups;
}
function openRowMenu(t, extraGroups){
  $('#rowMenuTitle').textContent = t.tags.title;
  $('#rowMenuSub').textContent = t.tags.artist + ' · ' + t.tags.album;
  const cover = $('#rowMenuCover');
  cover.innerHTML = '';
  const src = thumbURL['album:' + albumKey(t)] || t.art;
  if(src){ const im = el('img', null); im.src = src; im.alt = ''; cover.appendChild(im); }
  else cover.appendChild(el('span', null, '◍'));
  const body = $('#rowMenuBody');
  body.innerHTML = '';
  rowMenuGroups(t, extraGroups).forEach((group, i) => {
    if(i > 0) body.appendChild(el('div', 'p-list-menu-divider'));
    group.forEach(item => {
      const danger = item.label.startsWith('!');
      const btn = el('button', danger ? 'p-list-menu-item p-list-menu-item--danger' : 'p-list-menu-item',
        danger ? item.label.slice(1) : item.label);
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.addEventListener('click', item.onClick);
      body.appendChild(btn);
    });
  });
  $('#rowMenuOverlay').classList.add('open');
  $('#rowMenuOverlay').setAttribute('aria-hidden','false');
  // Was a plain classList toggle with no Back/Escape/tap-outside support at
  // all — an accepted gap under NV2 (src/wiring/overlays.js's own comment),
  // closed now per Ken's "easily close any menu" request. The close-button
  // wiring (src/wiring/library-view.js) routes through closeLayer/
  // forceCloseLayer instead of calling closeRowMenu() directly now.
  openLayer('row-menu', closeRowMenu, { container: $('#rowMenuOverlay') });
}
// UN3: each row's own action, inlined into rowMenuGroups() above rather
// than wired by id from src/wiring/library-view.js, since the buttons
// themselves no longer have stable ids (the menu is rebuilt per track).
// Same close-then-act shape the old per-id wiring used — see this
// function's own history in src/wiring/library-view.js before UN3 for
// the skipHistory/forceCloseLayer reasoning each of these preserves.
function rowMenuPlayNext(i){ closeLayer('row-menu'); playNext(i); }
function rowMenuAddQueue(i){ closeLayer('row-menu'); addToQueue(i); }
function rowMenuToggleFavorite(id){ closeLayer('row-menu'); toggleFavorite(id); }
function rowMenuOpenCredits(t){
  forceCloseLayer('row-menu', {skipHistory: true});
  openCreditsSheet(t);
}
function rowMenuEditInfo(id){
  forceCloseLayer('row-menu', {skipHistory: true});
  openEditSheet([id]);
}
// UN3 point 2: "Remove today's confirm" — this removes the track from
// the *library listing* only (files on disk are untouched, same as
// every other library removal), unlike the artist page's "Remove
// artist…" (UN3 point 5), which still confirms through #confirmOverlay
// since deleting every album by an artist is a much larger, harder to
// walk back action.
async function rowMenuRemove(id){
  closeLayer('row-menu');
  await deleteTracks([id]);
}
export function closeRowMenu(){
  $('#rowMenuOverlay').classList.remove('open');
  $('#rowMenuOverlay').setAttribute('aria-hidden','true');
}

/* Liner notes & credits (CREDITS spec §1) and credits that link: person
   view (CREDITS spec §2) moved to src/library/credits.js (step 5e). */

export let confirmDeleteAction = null;
export function openConfirmDelete(kind, count, name, action){
  $('#confirmTitle').textContent = kind === 'song' ? 'Remove song' :
    kind === 'album' ? 'Remove album' : kind === 'artist' ? 'Remove artist' :
    kind === 'playlist' ? 'Delete playlist' : 'Remove songs';
  // LB4 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 4): "Delete playlist…"
  // reuses this same shared dialog (the step's own wording), but its copy
  // is its own case rather than a variant of the library-removal sentence
  // below -- deleting a playlist removes none of its songs from the
  // library, the opposite of what that sentence promises.
  if(kind === 'playlist'){
    $('#confirmBody').textContent = '“' + name + '” will be deleted. Your songs stay in your library — only the playlist itself goes.';
  } else {
    const noun = count === 1 ? 'track' : 'tracks';
    const nameBit = name ? '“' + name + '” — ' : '';
    $('#confirmBody').textContent = nameBit + count + ' ' + noun + ' will be removed from Miziki’s library. '
      + 'This removes ' + (count === 1 ? 'it' : 'them') + ' from the library only, not from disk — your files stay where they are.';
  }
  $('#confirmGo').textContent = kind === 'playlist' ? 'Delete' : 'Remove';
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

// GF12 (docs/29_GATEFOLD.md) point 1: the Albums tab's drill-down and an
// artist's own album drill-down both open the gatefold now, via the same
// sealed -> single -> gatefold routing crate/view.js's openCrateAlbum()
// already does, rather than a second implementation of that branch.
// albumArtistFor() (crate/model.js) resolves the artist the same way the
// crate does, so the two agree on the exact same album.
export function openAlbumFromLibrary(album, idx){
  openCrateAlbum({kind:'album', albumId: albumKey(S.tracks[idx[0]]), album, artist: albumArtistFor(idx),
    year: albumYearFor(idx), idx});
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

// CR9 (docs/13_CRATE.md): the Artists tab's own row — a fanned stack of
// up to three covers (reusing thumbURL, the already-generated/cropped
// tier, the same source crate/view.js's own sleeves read) in place of
// groupRow's single disc icon, since an artist is several records, not
// one. `idx` is every track by this artist.
export function artistRow(artist, idx, onTap){
  const b = el('button','grouprow artist-row');
  const albumAt = new Map(); // one representative track index per album, first-seen order
  idx.forEach(i => { const alb = S.tracks[i].tags.album; if(!albumAt.has(alb)) albumAt.set(alb, i); });
  const stack = el('span','artist-stack');
  const covers = [...albumAt.values()].slice(0, 3)
    .map(i => thumbURL['album:' + albumKey(S.tracks[i])] || S.tracks[i].art)
    .filter(Boolean);
  if(covers.length){
    covers.forEach(src => {
      const im = el('img', null); im.src = src; im.alt = '';
      im.loading = 'lazy'; im.decoding = 'async'; im.width = 40; im.height = 40;
      stack.appendChild(im);
    });
  } else stack.appendChild(el('span','g-art','◍'));
  b.appendChild(stack);
  const years = idx.map(i => S.tracks[i].tags.year).filter(Boolean);
  const yearRange = years.length
    ? (Math.min(...years) === Math.max(...years) ? String(Math.min(...years)) : Math.min(...years) + '–' + Math.max(...years))
    : '';
  const box = el('span','g-text');
  box.appendChild(el('b', null, artist));
  box.appendChild(el('em', null, albumAt.size + (albumAt.size === 1 ? ' record' : ' records') + (yearRange ? ' · ' + yearRange : '')));
  b.appendChild(box);
  b.appendChild(el('span','g-chev','›'));
  b.addEventListener('click', onTap);
  return b;
}

// CR9 (docs/13_CRATE.md): a playlist's own "compilation sleeve" tile for
// the 2x2 grid — up to four covers in their own mini-grid under a cream
// title strip, in place of the plain groupRow list every other tab still
// uses (an album or an artist is a single sleeve; a playlist of several
// different albums reads better as a compilation's own cover collage).
// LB2 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 2): the "New playlist"
// sheet -- title "New playlist", button "Create playlist" -- shared by
// both of this screen's own entry points (the empty-note action and the
// grid's own button). Resolves to null (typed name empty, or the sheet
// was closed) without doing anything.
async function createPlaylistViaSheet(){
  const name = await openPlaylistNameSheet({
    title: 'New playlist',
    confirmLabel: 'Create playlist',
    existingNames: S.playlists.map(p => p.name),
  });
  if(!name) return;
  S.playlists.push({ name, items: [] });
  queueSave();
  touchBackupKey('playlistDefs', name);
  S.view.playlist = S.playlists.length - 1;
  S.view.picking = true;
  renderTracks();
}

// LB3 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 3): one mosaic per
// playlist -- its first four *different* records' covers, cached in
// memory and rebuilt only when that playlist's own items actually
// change. Keyed by the playlist object itself (a WeakMap, so a deleted
// playlist's cache entry is simply dropped along with it, no explicit
// cleanup needed); the dirty check is a content snapshot of pl.items
// (view.js's own reorder/add/remove all mutate that array in place via
// splice/push, so a reference-equality check on the array itself would
// never see a change) -- the same "remember what a thumbnail was last
// cut from, compare on the next pass" shape thumbs.js's thumbSrcSeen map
// already uses for its own per-item cache invalidation.
const playlistMosaicCache = new WeakMap();

function playlistMosaicEntry(pl, present){
  const itemsKey = pl.items.join(',');
  const cached = playlistMosaicCache.get(pl);
  if(cached && cached.itemsKey === itemsKey) return cached;
  const distinct = distinctAlbumKeysInOrder(present, S.tracks, albumKey);
  const entry = {
    itemsKey,
    layout: mosaicLayout(distinct.length),
    cells: mosaicCells(distinct),
    urls: new Map(),   // albumId -> resolved crate-art-S url, filled in as it builds
  };
  playlistMosaicCache.set(pl, entry);
  return entry;
}

// The mosaic itself: 2x2 grid (4, or 3 padded with a repeat), a diagonal
// split (2), a single cover (1), or UN5's empty-note treatment, scaled to
// the tile, for 0. Art comes from the crate's own "S" (640px) tier
// (src/crate/tiers.js, built lazily and LRU-cached there) -- the same
// resolver/fallback order every other cover in the app already follows
// (crate/view.js's own setCardImage(), gatefold/view.js's art lookups):
// the crate-tier url once it's built, else the existing 800px album
// thumbnail, else nothing. getCrateArtURL() is async (it may need to
// build the tier from the original file first), so each cell starts on
// whatever's already available synchronously and upgrades in place once
// the tier resolves -- `cell.dataset.albumId` guards against a cell
// having been re-used (a re-render) by the time the promise settles.
function playlistMosaicArt(pl, present){
  const entry = playlistMosaicEntry(pl, present);
  const wrap = el('span', 'pl-mosaic pl-mosaic--' + entry.layout);
  if(entry.layout === 'empty'){
    // UN5's empty-note card pattern (src/ui/parts.js's emptyNote()), at
    // mosaic-tile scale rather than the full head/sub/actions card that
    // component builds for a whole empty screen -- a 96px square has no
    // room for that, so this reuses just its tape-sticker-on-stock-card
    // visual (05-parts.css's .p-empty-note/.p-empty-note-tape), which is
    // the one piece of the pattern that still reads at this size. Judgment
    // call, flagged in the PR body (LB0 never exported this frame).
    const empty = el('span', 'pl-mosaic-empty');
    empty.appendChild(el('span', 'pl-mosaic-empty-tape'));
    wrap.appendChild(empty);
    return wrap;
  }
  entry.cells.forEach(albumId => {
    const cell = el('span', 'pl-mosaic-cell');
    cell.dataset.albumId = albumId;
    const img = el('img', null);
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    const fallback = entry.urls.get(albumId) || thumbURL['album:' + albumId];
    if(fallback) img.src = fallback;
    else cell.classList.add('pl-mosaic-cell--blank');
    cell.appendChild(img);
    wrap.appendChild(cell);
    if(!entry.urls.has(albumId)){
      getCrateArtURL(albumId, 'S').then(url => {
        if(!url) return;
        entry.urls.set(albumId, url);
        if(cell.dataset.albumId !== albumId) return;   // recycled since
        cell.classList.remove('pl-mosaic-cell--blank');
        img.src = url;
      });
    }
  });
  return wrap;
}

function playlistTile(pl, present, onTap){
  const b = el('button','playlist-tile' + (pl.system === 'favorites' ? ' is-fav' : ''));
  b.appendChild(playlistMosaicArt(pl, present));
  const strip = el('span','pl-strip');
  // Decision 2 (LB3's own title, "{n} songs · {length}"): Archivo 15/500
  // for the title, 13 for the caption -- neither lands on an existing
  // --fs-* token (15 sits between --fs-body/14 and --fs-row/16; 13 sits
  // between --fs-caption/12 and --fs-body/14, and repeats verbatim across
  // this addendum's own decisions 2 and 7/LB7, so it isn't a one-off
  // worth bending onto --fs-caption just for this tile). Kept literal with
  // this comment, same "canvas-exact, flagged for Ken" posture 05-parts.css's
  // own file-top note already sets for the 15px button type/22px sheet
  // title/etc that don't land on the scale either -- flagged again in this
  // PR's own body since LB0 never exported a frame to check the pixel
  // reading against.
  strip.appendChild(el('b', 'pl-title', pl.name));
  const songCount = present.length;
  const lengthSec = present.reduce((sum, i) => sum + (S.tracks[i].duration || 0), 0);
  // Decision 5: "songs", never "tracks", in anything the library says
  // about songs -- this caption, the header row below, and the empty-grid
  // note all say "songs."
  strip.appendChild(el('span', 'pl-caption',
    songCount + (songCount === 1 ? ' song · ' : ' songs · ') + fmt(lengthSec)));
  b.appendChild(strip);
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
  // RF17 (docs/12_REFINE.md): membership is an add-wins set per (playlist,
  // track) pair, not one stamp for the whole playlist — see state.js's
  // touchBackupMembership(). The order array itself also changed (appended
  // to, or spliced out of), so playlistOrder gets its own per-playlist stamp.
  touchBackupMembership(pl.name, id, at >= 0 ? 'removed' : 'added');
  touchBackupKey('playlistOrder', pl.name);
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
export function syncQueueOrder(order){
  if(S.baseQueue.length !== order.length) return;
  if(!S.baseQueue.every(i => order.indexOf(i) >= 0)) return;
  S.baseQueue = order.slice();
  if(!S.shuffle){ setQueueList(order.slice()); setQpos(Math.max(0, S.queue.indexOf(S.index))); }
}

// GF12 (docs/29_GATEFOLD.md): exported so the gatefold's own "Track order"
// reorder mode (src/gatefold/view.js) can reuse this mover control rather
// than a second implementation — it's also still used below for playlist
// manual reordering.
export function moverCtl(list, pos, after){
  const box = el('span','movers');
  // UN5 point 6: a decorative grip -- the visual "this row drags" cue the
  // plan's wording asks for, aria-hidden since no drag gesture is wired
  // to it yet (the ▲▼ buttons below stay the one working, accessible
  // reorder path -- see this PR's own body for why drag itself is out).
  const grip = el('span','mv-grip','⠿');
  grip.setAttribute('aria-hidden','true');
  box.appendChild(grip);
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

/* ================= LB4: the playlist detail page =================
   docs/36A_LIBRARY_AND_LAUNCH.md decision 4 -- backHeader('Playlists', '',
   ⋯) + the mosaic/title/caption + Play/Shuffle/Add songs, a drag-handle
   row in place of moverCtl()'s ▲▼ buttons (which stay exactly as they
   were above, for the gatefold's own "Track order" mode -- this is a
   second, playlist-only row shape, not a change to that shared one), and
   the "Add songs" pick screen that replaces the old inline "Add or remove
   tracks" toggle. */

// ---- the ⋯ menu (Rename…/Delete playlist…) ----
// "Share" is left out, same call UN3 point 5 already made for "Share
// artist" (openArtistMoreMenu() above) and for the same reason: there's
// no playlist share-card composer anywhere in src/share/ yet (its five
// composers are nowPlaying/record/pressings/crate/season -- see
// src/share/sheet.js's own CARD_FILENAMES) -- building one is real new
// feature work, not a menu restyle, so it's flagged in the LB4 PR body as
// a follow-up rather than built here.
function playlistMoreMenuGroups(pl){
  return [
    [{ label: 'Rename…', onClick: () => playlistMoreMenuRename(pl) }],
    [{ label: '!Delete playlist…', onClick: () => playlistMoreMenuDelete(pl) }],
  ];
}
function openPlaylistMoreMenu(btn, pl){
  const menu = $('#playlistMoreMenu');
  menu.innerHTML = '';
  menu.appendChild(listMenu(playlistMoreMenuGroups(pl)));
  const r = btn.getBoundingClientRect();
  menu.style.top = Math.round(r.bottom + window.scrollY + 8) + 'px';
  menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
  $('#playlistMoreMenuScrim').classList.add('open');
  menu.classList.add('open');
  openLayer('playlist-more-menu', closePlaylistMoreMenu, { container: [menu, $('#playlistMoreMenuScrim')] });
}
export function closePlaylistMoreMenu(){
  $('#playlistMoreMenuScrim').classList.remove('open');
  $('#playlistMoreMenu').classList.remove('open');
}
// LB2 built openPlaylistNameSheet() with exactly this call in mind (its
// own file-top comment) -- {title, initial, confirmLabel, existingNames},
// same signature "New playlist" already uses above, just pre-filled and
// excluding this playlist's own current name from the collision check.
async function playlistMoreMenuRename(pl){
  // forceCloseLayer(...,{skipHistory:true}), not closeLayer() -- this
  // opens another layer (the name sheet) in the very same tick, the same
  // "close-then-immediately-open" shape rowMenuEditInfo()/rowMenuOpenCredits()
  // already use above for exactly this reason: a plain closeLayer()'s own
  // history pop can race the new layer's own history push and close it
  // right back (confirmed live with Playwright before settling on this).
  forceCloseLayer('playlist-more-menu', {skipHistory: true});
  const name = await openPlaylistNameSheet({
    title: 'Rename playlist',
    initial: pl.name,
    confirmLabel: 'Save',
    existingNames: S.playlists.filter(p => p !== pl).map(p => p.name),
  });
  if(!name || name === pl.name) return;
  // Judgment call, flagged in the LB4 PR body: the sync engine keys a
  // playlist's own order/membership backup stamps by its *name* (RF17,
  // src/sync/backup-doc.js's buildPlaylistDefsAndOrder()) -- a pre-
  // existing property of that keying, not something this step changes.
  // Renaming here only stamps playlistDefs under the new name; a device
  // that synced this playlist under its old name before the rename syncs
  // will keep that old entry around rather than having it replaced. A
  // real fix is a tombstone convention for the sync engine, which is out
  // of scope for a page-assembly step like this one.
  pl.name = name;
  queueSave();
  touchBackupKey('playlistDefs', name);
  renderTracks();
}
async function playlistMoreMenuDelete(pl){
  // Same reasoning as playlistMoreMenuRename() just above.
  forceCloseLayer('playlist-more-menu', {skipHistory: true});
  openConfirmDelete('playlist', 0, pl.name, async () => {
    const at = S.playlists.indexOf(pl);
    if(at < 0) return;
    S.playlists.splice(at, 1);
    queueSave();
    // Same judgment call as the rename above: deleting a playlist here is
    // local-only -- nothing today marks playlistDefs/playlistOrder as
    // *removed* for the sync engine to carry to another device, which
    // would need its own tombstone convention (out of scope here, see
    // rename's own comment just above).
    S.view.playlist = null;
    renderTracks();
  });
}

// ---- rows: handle · number · art · title/artist · time · ⋯ ----
function playlistSongRow(pl, i, pos, present){
  const t = S.tracks[i];
  const li = el('li','pl-row');
  li._plTrackId = t.id;   // the real id value, not a dataset string -- see
                           // wirePlaylistDrag()'s own comment on why
  if(i === S.index) li.setAttribute('aria-current','true');

  // present.length > 1 gated the same way moverCtl() gates its own ▲▼
  // buttons above -- nothing to reorder with a single row.
  if(present.length > 1){
    const handle = el('span','pl-row-handle','⠿');
    handle.setAttribute('aria-hidden','true');   // decorative; the
    // keyboard-accessible path is "Move up"/"Move down" in this row's own
    // ⋯ menu (openPlaylistRowMenu() below), same split UN5 point 6 drew
    // between moverCtl()'s own decorative grip and its real ▲▼ buttons.
    handle.addEventListener('click', e => e.stopPropagation());
    li.appendChild(handle);
  } else {
    li.appendChild(el('span','pl-row-handle'));
  }

  li.appendChild(el('span','t-idx', String(pos + 1).padStart(2,'0')));
  li.appendChild(trackArtNode(t));
  li.appendChild(trackNameNode(t));
  li.appendChild(el('span','t-dur', fmt(t.duration)));

  const editBtn = el('button','t-edit','⋯');
  editBtn.setAttribute('aria-label','Track options');
  editBtn.addEventListener('click', e => { e.stopPropagation(); openPlaylistRowMenu(pl, t); });
  li.appendChild(editBtn);

  li.addEventListener('click', ()=> setQueue(present, present.indexOf(i), true));
  return li;
}

// openRowMenu()'s own extraGroups parameter (above) is what lets this
// reuse the one track-options sheet rather than a second menu component.
function openPlaylistRowMenu(pl, t){
  const fullPos = pl.items.indexOf(t.id);
  const extra = [];
  const moveItems = [];
  if(fullPos > 0) moveItems.push({ label: 'Move up', onClick: () => { closeLayer('row-menu'); reorderPlaylistItem(pl, fullPos, -1); } });
  if(fullPos < pl.items.length - 1) moveItems.push({ label: 'Move down', onClick: () => { closeLayer('row-menu'); reorderPlaylistItem(pl, fullPos, 1); } });
  if(moveItems.length) extra.push(moveItems);
  extra.push([{ label: '!Remove from this playlist', onClick: () => { closeLayer('row-menu'); removeFromPlaylist(pl, t.id); } }]);
  openRowMenu(t, extra);
}
function reorderPlaylistItem(pl, fullPos, dir){
  if(!moveIn(pl.items, fullPos, dir)) return;
  queueSave();
  touchBackupKey('playlistOrder', pl.name);
  syncQueueOrder(pl.items.map(idxOf).filter(x => x >= 0));
  renderTracks();
}
function removeFromPlaylist(pl, id){
  const at = pl.items.indexOf(id);
  if(at < 0) return;
  pl.items.splice(at, 1);
  queueSave();
  touchBackupMembership(pl.name, id, 'removed');
  touchBackupKey('playlistOrder', pl.name);
  renderTracks();
}

// ---- reorder by drag handle ----
// Only the "which slot" math (dragTargetIndex()) and the "fold the new
// present-order back into the playlist's full id list" math
// (reorderPresentIds()) are pure/tested (src/library/drag-reorder.js) --
// everything here is the DOM half: lift the dragged row with a transform
// while it's live, actually move it in the DOM as it crosses a slot
// boundary (which is what makes the rest of the list "make room" --
// ordinary reflow, no second animation layer), and persist once on drop.
function wirePlaylistDrag(ul, pl){
  const rows = () => Array.from(ul.children);
  rows().forEach(li => {
    const handle = li.querySelector('.pl-row-handle');
    if(!handle || !handle.getAttribute('aria-hidden')) return;
    handle.addEventListener('pointerdown', e => {
      if(e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      // `all` is a fixed snapshot of the row order at drag-start -- the
      // dragged row itself is never re-parented in the DOM until the very
      // end (onUp), only visually translated; moving it mid-drag (an
      // earlier version of this function did) turned out to silently
      // drop the handle's own pointer capture on this preview's Chromium
      // build, which stops pointerup ever reaching this listener at all
      // -- confirmed live with Playwright before settling on this shape.
      // Every *other* row's own "make room" shift is a pure CSS transform
      // during the drag instead (applyShift() below, the same FLIP-style
      // split moverCtl()'s own click-and-rerender never needed), so
      // nothing but `li` ever moves in the DOM before the gesture ends.
      const all = rows();
      const startIndex = all.indexOf(li);
      const rowHeight = li.getBoundingClientRect().height;
      const firstTop = all[0].getBoundingClientRect().top;
      const startClientY = e.clientY;
      try{ handle.setPointerCapture(e.pointerId); }catch(_e){ /* older WebKit */ }
      li.classList.add('dragging');
      let target = startIndex;

      const applyShift = () => {
        all.forEach((row, idx) => {
          if(row === li) return;
          let shift = 0;
          if(idx > startIndex && idx <= target) shift = -1;
          else if(idx < startIndex && idx >= target) shift = 1;
          row.style.transform = shift ? 'translateY(' + (shift * rowHeight) + 'px)' : '';
        });
      };
      const onMove = ev => {
        li.style.transform = 'translateY(' + (ev.clientY - startClientY) + 'px)';
        target = dragTargetIndex(firstTop, rowHeight, all.length, ev.clientY);
        applyShift();
      };
      const onUp = ev => {
        try{ handle.releasePointerCapture(ev.pointerId); }catch(_e){ /* already released */ }
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        li.classList.remove('dragging');
        li.style.transform = '';
        all.forEach(row => { if(row !== li) row.style.transform = ''; });
        if(target !== startIndex){
          const ref = target > startIndex ? all[target].nextSibling : all[target];
          ul.insertBefore(li, ref);
          const finalIds = rows().map(r => r._plTrackId);
          pl.items = reorderPresentIds(pl.items, finalIds);
          queueSave();
          touchBackupKey('playlistOrder', pl.name);
          syncQueueOrder(pl.items.map(idxOf).filter(x => x >= 0));
          renderTracks();
        }
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  });
}

// ---- the detail page itself ----
function renderPlaylistDetail(host, pl){
  const present = pl.items.map(idxOf).filter(i => i >= 0);

  const moreBtn = el('button','hdr-icon-btn','⋯');
  moreBtn.type = 'button';
  moreBtn.setAttribute('aria-label','Playlist options');
  moreBtn.setAttribute('aria-haspopup','menu');
  const header = backHeader('Playlists', '', moreBtn);
  header.backBtn.addEventListener('click', ()=>{ S.view.playlist = null; renderTracks(); });
  moreBtn.addEventListener('click', ()=> openPlaylistMoreMenu(moreBtn, pl));
  host.appendChild(header);

  const info = el('div','pl-detail-head');
  const mosaicBox = el('div','pl-detail-mosaic');
  mosaicBox.appendChild(playlistMosaicArt(pl, present));
  info.appendChild(mosaicBox);
  const text = el('div','pl-detail-text');
  text.appendChild(el('h2','pl-detail-title', pl.name));
  const songCount = present.length;
  const lengthSec = present.reduce((sum, i) => sum + (S.tracks[i].duration || 0), 0);
  text.appendChild(el('p','pl-detail-caption',
    songCount + (songCount === 1 ? ' song · ' : ' songs · ') + fmt(lengthSec)));
  info.appendChild(text);
  host.appendChild(info);

  const actions = el('div','pl-detail-actions');
  const playBtn = el('button','p-btn p-btn--primary','Play');
  playBtn.type = 'button';
  playBtn.disabled = !present.length;
  playBtn.addEventListener('click', ()=> setQueue(present, 0, true));
  const shuffleBtn = el('button','p-btn','Shuffle');
  shuffleBtn.type = 'button';
  shuffleBtn.disabled = !present.length;
  shuffleBtn.addEventListener('click', ()=>{
    const shuffled = present.slice();
    for(let k = shuffled.length - 1; k > 0; k--){
      const j = Math.floor(Math.random() * (k + 1));
      [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
    }
    setQueue(shuffled, 0, true);
  });
  const addBtn = el('button','p-btn','Add songs');
  addBtn.type = 'button';
  addBtn.addEventListener('click', ()=>{ S.view.picking = true; renderTracks(); });
  actions.appendChild(playBtn); actions.appendChild(shuffleBtn); actions.appendChild(addBtn);
  host.appendChild(actions);

  if(!present.length) host.appendChild(el('p','note','This playlist is empty.'));
  const ul = el('ul','pl-tracklist');
  present.forEach((i,pos) => ul.appendChild(playlistSongRow(pl, i, pos, present)));
  host.appendChild(ul);
  if(present.length > 1) wirePlaylistDrag(ul, pl);
}

// ---- "Add songs": the Songs list in pick mode ----
// Judgment call, flagged in the LB4 PR body (LB0 never exported this
// frame to check against): only songs *not already* in the playlist are
// listed, rather than every song with the already-in ones pre-checked --
// "Add {n}" then always means exactly what it says, and removing a song
// is the row ⋯ menu's own job now (decision 4 point 4), not this screen's.
// The transient selection is kept here, outside S.playlists, until "Add
// {n}" actually commits it -- `plName` guards against a stale selection
// surviving into a second playlist's own Add-songs session.
let addSongsState = { plName: null, ids: new Set() };
function addSongsSelection(pl){
  if(addSongsState.plName !== pl.name) addSongsState = { plName: pl.name, ids: new Set() };
  return addSongsState;
}
function updateAddSongsBar(state){
  const bar = $('#plAddSongsBar');
  const btn = $('#plAddSongsBtn');
  const n = state.ids.size;
  bar.style.display = n ? 'block' : 'none';
  btn.textContent = 'Add ' + n + (n === 1 ? ' song' : ' songs');
  btn.onclick = () => commitAddSongs(state);
}
function commitAddSongs(state){
  const pl = S.playlists.find(p => p.name === state.plName);
  if(pl){
    state.ids.forEach(id => {
      if(!pl.items.includes(id)){
        pl.items.push(id);
        touchBackupMembership(pl.name, id, 'added');
      }
    });
    queueSave();
    touchBackupKey('playlistOrder', pl.name);
  }
  addSongsState = { plName: null, ids: new Set() };
  S.view.picking = false;
  renderTracks();
}
function addSongsRow(t, pos, state){
  const li = el('li','pl-row');
  li.setAttribute('role','checkbox');
  const checked = state.ids.has(t.id);
  li.setAttribute('aria-checked', String(checked));
  if(checked) li.classList.add('picked');
  li.appendChild(el('span','pl-row-handle'));
  li.appendChild(el('span','t-idx', String(pos + 1).padStart(2,'0')));
  li.appendChild(trackArtNode(t));
  li.appendChild(trackNameNode(t));
  li.addEventListener('click', ()=>{
    const now = !state.ids.has(t.id);
    if(now) state.ids.add(t.id); else state.ids.delete(t.id);
    li.classList.toggle('picked', now);
    li.setAttribute('aria-checked', String(now));
    updateAddSongsBar(state);
  });
  return li;
}
function renderPlaylistAddSongs(host, pl){
  const state = addSongsSelection(pl);

  const header = backHeader(pl.name, 'Add songs', null);
  header.backBtn.addEventListener('click', ()=>{ S.view.picking = false; renderTracks(); });
  host.appendChild(header);

  const already = new Set(pl.items);
  const candidates = allIdx().filter(i => !already.has(idOf(i)))
    .sort((a,b) => byName(S.tracks[a].tags.title, S.tracks[b].tags.title));
  if(!candidates.length){
    host.appendChild(el('p','note','Every song in your library is already in this playlist.'));
  } else {
    host.appendChild(el('p','note','Tap songs to add, then tap Add.'));
    const ul = el('ul','pl-tracklist');
    candidates.forEach((i,pos) => ul.appendChild(addSongsRow(S.tracks[i], pos, state)));
    host.appendChild(ul);
  }
  updateAddSongsBar(state);
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

// The body-level scroll lock (shell/routes.js's own showRoute()) means
// #libBody can no longer rely on page scroll to reveal a longer
// Songs/Artists/Playlists/search-results list -- this gives it its own
// internal scroll region instead, sized to whatever room is actually left
// under the header/tabs and above the mini player/tab bar, the same
// getBoundingClientRect()+--chrome-inset approach crate/view.js's own
// applyCrateMiniInset() already uses for the same "how much room is left"
// question. Crate view is deliberately exempt -- it already fits itself to
// the viewport via applyCrateMiniInset() and never relies on page scroll
// at all, so giving it a second, competing scroll container here would
// only fight that.
export function updateLibBodyInset(){
  const route = document.getElementById('route-library');
  const host = $('#libBody');
  if(!route || !host || !route.classList.contains('on')) return;
  const searching = !!$('#librarySearch').value.trim();
  if(S.view.mode === 'crate' && !searching){
    host.style.maxHeight = '';
    host.style.overflowY = '';
    return;
  }
  const top = host.getBoundingClientRect().top;
  const chromeInset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-inset')) || 0;
  const maxH = Math.max(120, window.innerHeight - top - chromeInset);
  host.style.maxHeight = maxH + 'px';
  host.style.overflowY = 'auto';
}

// Ken, 2026-10-31: drilling into an artist/album/playlist/person from a
// list view, then backing out via the crumb, used to always land back at
// the top of that list — captureScrollAnchor()/restoreScrollAnchor() below
// only re-finds a specific row across a same-view rebuild (an edit, a sort
// change), not across navigating to a completely different view and back,
// since the old row ids simply don't exist in the new view's rows. This
// gives each distinct drill-down level its own remembered scrollTop
// instead, the same per-key idea shell/scroll-memory.js already uses for
// routes/Sundown views, just targeted at #libBody's own internal scroller
// (saveScrollPosition/restoreScrollPosition's optional `target` param)
// rather than window.scrollY.
let lastLibViewKey = null;
function libViewKey(v){
  return [v.mode, v.group, v.artistAlbum, v.playlist, v.person, v.crateLooseArtist].join('\u0001');
}

// UN5 point 1: the Listening empty state's "Open the crate" action --
// same view-mode-setting shape as wiring/library-view.js's sidebarBins
// click handler, pulled out so a non-library screen (profile/screens.js)
// can jump here without duplicating it. Only sets view state + redraws;
// the caller (which already knows it's not on the library route) does
// the route switch itself.
export function openLibraryCrate(){
  S.view.mode = 'crate'; S.view.group = null; S.view.artistAlbum = null; S.view.playlist = null;
  S.view.person = null; S.view.crateLooseIdx = null; S.view.picking = false;
  renderTracks();
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
  const newKey = libViewKey(S.view);
  // first render ever (lastLibViewKey is still null) is a fresh load, not
  // a navigation — nothing to save, and the natural top position is right
  const viewChanged = lastLibViewKey !== null && lastLibViewKey !== newKey;
  if(viewChanged) saveScrollPosition('lib-view:' + lastLibViewKey, host);
  const anchor = viewChanged ? null : captureScrollAnchor(host);
  try{ renderTracksBody(host); }
  finally{
    if(viewChanged) restoreScrollPosition('lib-view:' + newKey, host);
    else restoreScrollAnchor(host, anchor);
    lastLibViewKey = newKey;
  }
}

// UN3 point 5: set each render by the artist-page branch below, read by
// openArtistMoreMenu()'s own "Credits" item -- module-scoped since the
// menu's rect-based open/close (same shape as shell/header.js's small
// popovers) lives outside renderTracksBody() itself, and by the time a
// tap can reach it, the render that set it has already finished.
let artistCreditsToggle = null;

// UN5 point 5: the library's own most-common codec/lossless combo,
// recomputed once per renderTracksBody() pass rather than per row --
// songRow()/updateTrackRow() read it from here instead of taking it as a
// parameter, since both are also called from playlist/search code paths
// that don't thread extra arguments through.
let libCommonFormat = null;
function openArtistMoreMenu(btn){
  const r = btn.getBoundingClientRect();
  const menu = $('#artistMoreMenu');
  menu.style.top = Math.round(r.bottom + window.scrollY + 8) + 'px';
  menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
  $('#artistMoreMenuScrim').classList.add('open');
  menu.classList.add('open');
  $('#artistMoreCreditsBtn').onclick = () => {
    closeLayer('artist-more-menu');
    if(artistCreditsToggle) artistCreditsToggle();
  };
  $('#artistMoreRemoveBtn').onclick = () => {
    closeLayer('artist-more-menu');
    const group = S.view.group;
    openConfirmDelete('artist', countForArtist(group), group, async () => { deleteArtist(group); S.view.group = null; renderTracks(); });
  };
  openLayer('artist-more-menu', closeArtistMoreMenu, { container: [menu, $('#artistMoreMenuScrim')] });
}
export function closeArtistMoreMenu(){
  $('#artistMoreMenuScrim').classList.remove('open');
  $('#artistMoreMenu').classList.remove('open');
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
  // CR10 (docs/13_CRATE.md point 3): same reasoning — any render here is
  // also the one place the sidebar's BINS list (New arrivals/Staff
  // picks/Sealed counts) needs to stay in sync from.
  renderSidebarBins();
  const v = S.view;
  libCommonFormat = mostCommonFormat(S.tracks);
  $('#empty').style.display = S.tracks.length ? 'none' : 'block';
  if(!S.tracks.length) centerEmptyState();
  // UN3 (docs/36_UNIFORMITY.md) retired the header's own Select toggle
  // button (#selectToggle) in favor of a "Select" row inside the Library
  // tools sheet (#libToolsSelectRow, wiring/library-view.js) -- this
  // render pass kept trying to show/hide the now-gone button and threw
  // on every render, blanking the whole library screen.
  $('#selectBar').style.display = v.editSelecting ? 'flex' : 'none';
  // LB4 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 4): reset every render --
  // renderPlaylistAddSongs()'s own updateAddSongsBar() (below) is what
  // shows it again, only for the one playlist currently in "Add songs"
  // pick mode. Without this, navigating away from that screen by any path
  // that doesn't itself touch this bar (switching tabs, drilling into an
  // album) left it stuck showing the stale count from whatever was picked
  // last -- confirmed live with Playwright before adding this reset.
  $('#plAddSongsBar').style.display = 'none';
  updateLibTabsForLayout();
  updateHeaderActionsAvailability();
  // UN5 point 2: a live search covers every type regardless of the
  // Songs/Albums/Artists/Playlists tab otherwise selected, so no tab
  // should read as pressed while results are showing.
  const liveQuery = $('#librarySearch').value.trim();
  let pressedTab = null;
  document.querySelectorAll('[data-view]').forEach(b => {
    const pressed = !liveQuery && b.dataset.view === v.mode;
    b.setAttribute('aria-pressed', String(pressed));
    if(pressed) pressedTab = b;
  });
  // UN5 point 4: with Larger text on (or just a lot of tabs), the row can
  // overflow its own scrollable width (.lib-tabs-group, 01-header.css) --
  // the selected tab scrolls into view rather than staying wherever the
  // row's scroll position already was, so it's never the one left clipped
  // at the edge (the "Playlists" cut to "Playli" bug).
  if(pressedTab) pressedTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  refreshLibraryTools();
  updateLibBodyInset();
  // D5 (docs/DESKTOP_LAYOUT.md): hidden by default every render, same as
  // #crumb just below — the crate branch (renderCrate() -> crate/view.js's
  // own updateCrateGroupToggleUI()) is what turns this back on when
  // S.view.mode is actually 'crate'. Since RF8 (docs/12_REFINE.md), this is
  // the one home for crate grouping on every platform, not desktop-only.
  // FS6 (docs/25_FROM_SCRATCH.md point 2): the chip now lives inside
  // #crateSortRow, so hiding that row is what hides the whole line.
  $('#crateSortRow').style.display = 'none';
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
  // UN3 (docs/36_UNIFORMITY.md point 5): a plain artist page (not drilled
  // into one of its albums) gets backHeader('Artists', name, ⋯) instead
  // of the generic crumb -- "Remove artist…" moves into the ⋯ menu
  // (openArtistMoreMenu() below), so this is the one case the old
  // crumb's own removeBtn ternary used to cover with "Remove Artist"
  // (the `else` of `(v.mode === 'albums' || atArtistAlbum)` just below).
  const isArtistPage = v.mode === 'artists' && v.group !== null && v.artistAlbum === null;
  // LB4 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 4): a playlist that's
  // been drilled into gets its own backHeader('Playlists', '', ⋯) too --
  // same reasoning as isArtistPage just above, since this screen now
  // needs a ⋯ menu (Rename…/Delete playlist…) the generic crumb has no
  // room for, and the title moves out of the header row entirely (point
  // 1), which the crumb's own single label slot can't do either.
  const isPlaylistDetail = v.mode === 'playlists' && v.playlist !== null;
  crumb.style.display = (inside && !isArtistPage && !isPlaylistDetail) ? 'flex' : 'none';
  if(inside && !isArtistPage && !isPlaylistDetail){
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
    // Album deletion lives right where you're looking at that album —
    // offered even for a single-album artist, no conditional collapsing
    // (see LIBRARY spec §4). The plain-artist-page case (UN3 point 5,
    // "Remove artist…") is excluded from this whole block by
    // !isArtistPage above now, and lives in openArtistMoreMenu() instead.
    if(v.playlist === null && v.group !== null && (v.mode === 'albums' || atArtistAlbum)){
      const removeBtn = el('button','crumb-back','Remove album…');
      removeBtn.style.marginLeft = 'auto';
      removeBtn.addEventListener('click', ()=>{
        const group = v.group;
        if(v.mode === 'albums'){
          openConfirmDelete('album', countForAlbum(group), group, async () => { deleteAlbum(group); v.group = null; renderTracks(); });
        } else {
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
        }
      });
      crumb.appendChild(removeBtn);
    }
  }

  // UN3 point 5: the plain artist page's own header -- backHeader('Artists',
  // name, ⋯), with Credits and "Remove artist…" (danger, with a confirm,
  // unchanged from what the old crumb removeBtn did) moved into the ⋯
  // menu. "Share artist" (the plan's other ⋯ item) is left out: there's
  // no share-card composer for an artist anywhere in src/share/ yet
  // (every composer there is per-album/per-track/per-crate) -- building
  // one is real new feature work, not a menu restyle, so it's noted as a
  // follow-up in the PR rather than built here.
  if(isArtistPage){
    const moreBtn = el('button', 'hdr-icon-btn', '⋯');
    moreBtn.type = 'button';
    moreBtn.setAttribute('aria-label', 'Artist options');
    moreBtn.setAttribute('aria-haspopup', 'menu');
    const header = backHeader('Artists', v.group, moreBtn);
    header.backBtn.addEventListener('click', ()=>{ v.group = null; renderTracks(); });
    moreBtn.addEventListener('click', ()=> openArtistMoreMenu(moreBtn));
    host.appendChild(header);
  }

  const ul = el('ul','tracklist');

  if(v.mode === 'songs'){
    const q = allIdx().sort(librarySortComparator('songs'));
    host.appendChild(librarySortBar(q.length, q.length === 1 ? 'Song' : 'Songs'));
    host.appendChild(ul);
    // CR9 (docs/13_CRATE.md): sticky letter heads + rail above 200 tracks
    // — only while the current sort is actually alphabetical (artist or
    // album; "added"/"played"/"sessions" aren't, and a letter head over a
    // list that jumps around by recency would read as broken, not helpful).
    const sortKey = S.librarySort;
    const songLabelFor = sortKey === 'album' ? i => S.tracks[i].tags.album : (!sortKey || sortKey === 'artist') ? i => S.tracks[i].tags.artist : null;
    const showSongsRail = songLabelFor && q.length > SONGS_RAIL_THRESHOLD;
    appendRowsChunked(ul, q, (i, pos) => {
      const row = songRow(i, q, pos);
      if(isAlbumSealed(albumKey(S.tracks[i]))) row.querySelector('.t-name').appendChild(el('span','new-tag','NEW'));
      return row;
    }, showSongsRail ? { labelFor: songLabelFor, headFor: key => { const h = el('li','letter-head', key); h.dataset.letterKey = key; return h; } } : null);
    if(showSongsRail) attachLetterRail(host, buildLetterGroups(q, songLabelFor));
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
    // GF12 (docs/29_GATEFOLD.md): the album drill-down opens the gatefold
    // directly (openAlbumFromLibrary(), same sealed -> single -> gatefold
    // order the crate uses) instead of setting v.group and rendering
    // renderAlbumDetail() in its place — v.group is never set from here,
    // so this screen stays put underneath and regains focus on close for
    // free, via the gatefold/sealed-front/picture-sleeve's own existing
    // returnFocus handling.
    const groups = sortAlbumGroups(groupBy('album'));
    host.appendChild(librarySortBar(groups.length, groups.length === 1 ? 'Album' : 'Albums'));
    appendRowsChunked(host, groups, ([album, idx]) => {
      const artist = S.tracks[idx[0]].tags.albumArtist;
      const row = groupRow(album, artist + ' · ' + idx.length + (idx.length===1?' track':' tracks'),
        idx, () => openAlbumFromLibrary(album, idx));
      if(isAlbumSealed(albumKey(S.tracks[idx[0]]))) row.querySelector('.g-text b').appendChild(el('span','new-tag','NEW'));
      return row;
    });
  }

  else if(v.mode === 'artists'){
    if(v.group === null){
      const artistGroups = groupBy('artist');
      const showArtistsRail = artistGroups.length > ARTISTS_RAIL_THRESHOLD;
      appendRowsChunked(host, artistGroups, ([artist, idx]) => artistRow(artist, idx, ()=>{ v.group = artist; renderTracks(); }),
        showArtistsRail ? { labelFor: ([artist]) => artist, headFor: letterHead } : null);
      if(showArtistsRail) attachLetterRail(host, buildLetterGroups(artistGroups, ([artist]) => artist));
    } else {
      // GF12 (docs/29_GATEFOLD.md): an artist's own album drill-down opens
      // the gatefold directly too (v.artistAlbum is never set), same as
      // the Albums tab above — a shelf to pick an album from, same as the
      // top-level Albums view, rather than dumping every song from every
      // album in one flat list (CR9's own "Artist page" shelf,
      // docs/13_CRATE.md)
      const idx = allIdx().filter(i => S.tracks[i].tags.artist === v.group);
      const albums = new Map();
      idx.forEach(i => {
        const album = S.tracks[i].tags.album;
        if(!albums.has(album)) albums.set(album, []);
        albums.get(album).push(i);
      });
      // shelf order is release year, oldest first, like a record-store bin
      // (and the crate's own per-artist order) — undated albums last, A–Z
      const yearOf = new Map([...albums.entries()].map(([album, aidx]) => [album, albumYearFor(aidx)]));
      const entries = [...albums.entries()].sort((a,b) =>
        (yearOf.get(a[0]) || 9999) - (yearOf.get(b[0]) || 9999) || byName(a[0], b[0]));
      const flat = entries.flatMap(([, aidx]) => aidx.slice().sort(trackSort));

      // UN3 point 5: the action row is Play all (primary) and Shuffle
      // (secondary) only now -- Credits moved into the ⋯ menu above
      // (openArtistMoreMenu()'s own toggle, set below, is what that
      // menu's "Credits" item actually calls).
      const actions = el('div','artist-actions');
      const playAll = el('button','cta','Play all');
      playAll.addEventListener('click', ()=> setQueue(flat, 0, true));
      const shuffleBtn = el('button','cta ghost','Shuffle');
      shuffleBtn.addEventListener('click', ()=>{
        const shuffled = flat.slice();
        for(let k = shuffled.length - 1; k > 0; k--){
          const j = Math.floor(Math.random() * (k + 1));
          [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
        }
        setQueue(shuffled, 0, true);
      });
      const creditsBody = el('div','artist-credits');
      creditsBody.hidden = true;
      artistCreditsToggle = () => {
        const open = creditsBody.hidden;
        creditsBody.hidden = !open;
        if(open && !creditsBody.childNodes.length){
          const roll = new Map();
          entries.forEach(([album]) => albumCreditRoll(album).forEach((names, label) => {
            if(!roll.has(label)) roll.set(label, []);
            names.forEach(n => { if(!roll.get(label).includes(n)) roll.get(label).push(n); });
          }));
          if(!roll.size) creditsBody.appendChild(el('p','note','No credits in these files.'));
          else roll.forEach((names, label) => creditsBody.appendChild(creditRow(label, names)));
        }
      };
      actions.appendChild(playAll); actions.appendChild(shuffleBtn);
      host.appendChild(actions);
      host.appendChild(creditsBody);

      const shelf = el('div','artist-shelf');
      entries.forEach(([album, aidx], k) => {
        // docs/21_ARTIST_PAGE.md: each sleeve carries its title and year
        // underneath, so a cover doesn't have to be recognized to be found
        const item = el('div','shelf-item');
        const btn = el('button','shelf-sleeve' + (k % 2 ? ' shelf-sleeve-alt' : ''));
        const src = thumbURL['album:' + albumKey(S.tracks[aidx[0]])] || S.tracks[aidx[0]].art;
        if(src){
          const im = el('img', null); im.src = src; im.alt = album;
          im.loading = 'lazy'; im.decoding = 'async';
          btn.appendChild(im);
        } else btn.appendChild(el('span','g-art','◍'));
        btn.title = album;
        btn.addEventListener('click', () => openAlbumFromLibrary(album, aidx));
        item.appendChild(btn);
        const cap = el('span','shelf-caption');
        cap.appendChild(el('b', null, album));
        // UN13 point 5: "a captioned grid (cover, title, '2019 · 12″
        // LP')" -- the format half reuses record-art/format.js's own
        // table (formatRecordName()), the same one the gatefold/crate
        // stickers/liner notes already read, rather than a second
        // format-naming scheme just for this shelf.
        const year = yearOf.get(album);
        const albumId = albumKey(S.tracks[aidx[0]]);
        const format = albumFormatFor(aidx, S.tracks, (S.albumFormat && S.albumFormat[albumId]) || 'auto');
        const caption = [year ? String(year) : '', format ? formatRecordName(format) : ''].filter(Boolean).join(' · ');
        if(caption) cap.appendChild(el('span', null, caption));
        item.appendChild(cap);
        shelf.appendChild(item);
      });
      host.appendChild(shelf);
      // the local shelves (docs/21_ARTIST_PAGE.md) — on-device stats only,
      // each omitted until it has something to show
      appendMostSpun(host, idx);
      appendArtistHistory(host, v.group, idx);
      appendPressings(host, entries);
      // Connected crate (docs/20_CONNECTED.md): related artists' records
      // under the shelf — stays hidden until the shared cache has some
      appendConnectedShelf(host, v.group);
    }
  }

  else if(v.mode === 'playlists'){
    if(v.playlist === null){
      // CR9 (docs/13_CRATE.md): a 2x2 grid of compilation sleeves in place
      // of the plain groupRow list — Favorites first with its heart.
      // UN5 point 1 / LB2 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 2):
      // the old dashed-sleeve tile, and the inline "New playlist name"
      // field + Create button that used to sit under the grid, are both
      // gone -- every path to a new playlist now opens the same name
      // sheet (createPlaylistViaSheet() below).
      if(!S.playlists.length){
        host.appendChild(emptyNote({
          head: 'No playlists yet.',
          sub: "Name one here, or add songs to one from any song's ⋯ menu.",
          action: { label: 'New playlist', onClick: createPlaylistViaSheet },
        }));
      } else {
        // Decision 3's own header row: "{n} playlists" left, "New
        // playlist" (secondary, .p-btn -- UN2) right, replacing the old
        // full-width .cta button that used to sit under the grid.
        const head = el('div', 'playlist-grid-head');
        head.appendChild(el('span', 'playlist-grid-count',
          S.playlists.length + (S.playlists.length === 1 ? ' playlist' : ' playlists')));
        const mk = el('button', 'p-btn', 'New playlist');
        mk.type = 'button';
        mk.addEventListener('click', createPlaylistViaSheet);
        head.appendChild(mk);
        host.appendChild(head);

        // Favorites (and any other system playlist) pinned first, without
        // reordering S.playlists itself — v.playlist indexes the real array
        const order = S.playlists.map((_, n) => n).sort((a, b) => (S.playlists[a].system?0:1) - (S.playlists[b].system?0:1));
        const grid = el('div','playlist-grid');
        order.forEach(n => {
          const pl = S.playlists[n];
          // playlist items are track ids (F3 spec) — the count/art shown
          // here is of the tracks currently reconnected; a forgotten track
          // stays in the playlist but isn't counted until it comes back
          const present = pl.items.map(idxOf).filter(i => i >= 0);
          grid.appendChild(playlistTile(pl, present, ()=>{ v.playlist = n; renderTracks(); }));
        });
        host.appendChild(grid);
      }
    } else {
      // LB4 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 4): the real
      // playlist-detail page and its "Add songs" pick mode -- see the
      // block of functions above moverCtl()'s own "Library-wide search"
      // divider comment for both.
      const pl = S.playlists[v.playlist];
      if(v.picking) renderPlaylistAddSongs(host, pl);
      else renderPlaylistDetail(host, pl);
    }
  }

  setPathNote();
}
