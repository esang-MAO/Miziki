"use strict";
import { S, current, SOCIAL_SUPABASE_URL, SOCIAL_SUPABASE_ANON_KEY } from './state.js';
import { $, el } from './util/dom.js';
import { sleep } from './util/async.js';
import { trackTier, albumKey } from './record-art/tiers.js';
import { albumMetalFor } from './record-art/metals.js';
import { openLookPicker, closeLookPicker } from './record-art/looks.js';
import { byName, groupBy, allIdx, albumTracks, idxOf } from './library/model.js';
import {
  setQueue,
  playNext, addToQueue, openQueueSheet, closeQueueSheet,
} from './player/queue.js';
import { addFiles, filesFromDataTransferItems, addTestTone } from './library/import.js';
import { closeDupOverlay, closeDuplicateScan } from './library/duplicates-ui.js';
import {
  persistAlbumLookPref, touchActiveSession, restoreSessions,
} from './history/sessions.js';
import { clearListeningHistory } from './history/clear.js';
import {
  loadOverlayFor, cropSquareImage, applyEdit, revertTrack,
  undoLastEdit, showUndoBanner, openEditSheet, closeEditSheet, saveEditSheet,
  renderEditArtPreview,
} from './library/edit.js';
import {
  countForAlbum, countForArtist,
  deleteTracks, deleteAlbum, deleteArtist, forgetLibrary,
} from './library/delete.js';
import { openDuplicateScan } from './library/duplicate-scan.js';
import {
  trackHasCreditsContent, openPersonOrArtist, creditRow, openCreditsSheet, closeCreditsSheet,
  updateCreditsButtonForCurrent, albumLinerNotes, albumCreditRoll, rebuildPeopleIndex, renderPersonView,
} from './library/credits.js';
import { isFavorite, toggleFavorite } from './library/favorites.js';
import {
  librarySortBar, librarySortComparator, sortAlbumGroups, renderSearchResults,
  renderSearchChips, updateSearchChipsVisibility, closeSortMenu,
} from './library/search.js';
import { isAlbumSealed, buildSealOverlay, restoreSealedAlbums } from './library/sealed.js';
import { thumbURL, healThumbs, healDetails } from './library/thumbs.js';
import { nowClock } from './sundown/solar.js';
import { getCrateArtURL, healCrateArt } from './crate/tiers.js';
import { invalidateCrateModel } from './crate/model.js';
import { renderCrate, centerEmptyState } from './crate/view.js';
import {
  runLaunchSequence, attachLaunchSettingRow, toggleLaunchIntro,
  resolveLastPlayedAlbum, resolveLastPlayedTrackIndex, markLibraryReady,
} from './launch/intro.js';
import { askLocation, fallbackSun, toggleSleevePull, toggleMotion } from './sundown/location.js';
import { openSleepSheet, closeSleepSheet } from './player/sleep-timer.js';
import { ensureContext, applyCharacter } from './audio/engine.js';
import { setMode } from './audio/mode.js';
import { play, pause, seek } from './player/transport.js';
import { nextTrack, prevTrack, toggleShuffle, cycleRepeat } from './player/controls.js';
import {
  bgPrime, bgUpdateUI, toggleBgAudio,
} from './player/background.js';
import { fmt, drawSun, frame } from './player/clock.js';
import { wireSpinToScrub, toggleScratch } from './player/scrub.js';
import {
  closeShareSheet, openPlayerShareSheet, closePlayerShareSheet,
  queueShareRender, queuePlayerShareRender, shareDoSave, shareDoShare, shareDoCopy, shareSelectedFormat,
} from './share/sheet.js';
import { setPathNote } from './ui/path-note.js';
import { clamp } from './util/math.js';
import { DB } from './storage/idb.js';
import {
  storage, tracks, overlays, artwork,
} from './storage/repo.js';
import { queueSave, restoreMeta } from './storage/meta.js';
import { persistProfile, renderProfile } from './profile/screens.js';
import { closeSocialAuth } from './profile/settings.js';
import { popSocialScreen, closeRecordSheet } from './social/screens/friend-store.js';
import { REDUCED } from './util/motion.js';
import { updateShellAlbum, updateChromeInset } from './shell/mini-player.js';
import { showRoute } from './shell/routes.js';
import {
  updateHeaderActionsAvailability, updateLibTabsForLayout, refreshLibraryTools,
  openSearchField, closeSearchField, isSearchFieldOpen,
  openAddMenu, closeAddMenu, isAddMenuOpen,
} from './shell/header.js';
import {
  openPlayerViaSheet, openPlayer, closePlayer, morphInFlight, interruptMorph,
} from './shell/player-overlay.js';
import { runStartSequence, interruptStartSequence } from './shell/start-sequence.js';
import { runGatefoldHandoff, gfHandoffInFlight, interruptGatefoldHandoff } from './shell/handoff.js';

/* REDUCED moved to src/util/motion.js (step 7b), alongside easeOutCubic.

   metal tiers (albumMetalFor/trackMetalFor/metalBackground/setDiscBackground,
   plus the threshold/color tables) moved to src/record-art/metals.js
   (step 6b). */

/* look switching (availableLooks/resolveLook/setLookPref/lookLabel/
   openLookPicker/closeLookPicker/applyDiscVariant) moved to
   src/record-art/looks.js (step 6b). */

/* The "profile tab" / S5 sealed-records / thumbnails / achievements /
   duplicate-scan leftover comments that used to sit here were pure
   documentation of code already moved out in steps 5c/5d/6b — each
   destination module (profile/screens.js, library/sealed.js,
   library/thumbs.js, history/achievements.js, library/duplicate-scan.js)
   already carries its own copy of the relevant note, so this was a stale
   duplicate with no code under it. Removed in step 7a rather than moved
   again.

   Persistence (queueSave/saveTimer/saveMeta/restoreMeta/applyPrefs) moved
   to src/storage/meta.js (step 7a). */

/* Session tracking and played-duration tracking moved to
   src/history/sessions.js and src/history/played.js (step 5c). */

/* Metadata editing (the sidecar-overlay section: applyEdit, revertTrack,
   the undo banner, the edit sheet) moved to src/library/edit.js (step 5d). */

/* Deletion (deleteTracks, deleteAlbum/deleteArtist, forgetLibrary) moved to
   src/library/delete.js (step 5d). clearListeningHistory moved to
   src/history/clear.js (step 5c). */

/* The rest of "visible queue: reorder, remove, play next / add"
   (queueInsert/playNext/addToQueue, queueRemoveAt, queueMove, the
   queue-sheet UI) moved into src/player/queue.js (step 5e). */

/* nextTrack/prevTrack/toggleShuffle/cycleRepeat moved to
   src/player/controls.js (step 6c). */

/* Navigation shell: mini-player, full-player overlay, sleeve pull
   (SLEEVE_ANIM, renderMiniPlayer, updateChromeInset, updateShellAlbum) moved
   to src/shell/mini-player.js (step 7b). GATEFOLD_ANIM stays here — it's
   gatefold's own open/close timing, not mini-player/overlay code, and the
   gatefold itself hasn't moved yet (step 7e). */

// GATEFOLD spec §A3 — total ~950ms open, ~600ms close, independent of
// SLEEVE_ANIM (opening the gatefold never touches playback or the sleeve)
const GATEFOLD_ANIM = {
  liftMs: 200, swingMs: 420, holdMs: 80, pushMs: 250,   // open: 200+420+80+250 = 950
  closeMs: 600, skipMs: 120, leftPanelMs: 250,
  swingEasing: 'cubic-bezier(.4,0,.2,1)', liftEasing: 'ease-out'
};
document.documentElement.style.setProperty('--gatefold-lift-duration', GATEFOLD_ANIM.liftMs + 'ms');
document.documentElement.style.setProperty('--gatefold-swing-duration', GATEFOLD_ANIM.swingMs + 'ms');
document.documentElement.style.setProperty('--gatefold-push-duration', GATEFOLD_ANIM.pushMs + 'ms');
document.documentElement.style.setProperty('--gatefold-close-duration', GATEFOLD_ANIM.closeMs + 'ms');
document.documentElement.style.setProperty('--gatefold-swing-easing', GATEFOLD_ANIM.swingEasing);

/* Gatefold-to-player hand-off (HANDOFF_ANIM, runGatefoldHandoff,
   interruptGatefoldHandoff and helpers) moved to src/shell/handoff.js
   (step 7b). */

/* Put-away (runPutAwaySequence/putAwayInstant/shouldPutAway/clearSpinDown)
   moved to src/shell/put-away.js (step 7b). easeOutCubic moved to
   src/util/motion.js instead, alongside REDUCED (step 7b) — it's a generic
   easing helper only player/clock.js's render loop actually calls, not
   put-away-specific despite sitting physically in this section. */

/* Launch intro (runLaunchSequence, attachLaunchSettingRow,
   toggleLaunchIntro, resolveLastPlayedAlbum, resolveLastPlayedTrackIndex,
   the libraryReadyResolve/libraryReadyPromise pair now behind
   markLibraryReady()) moved to src/launch/intro.js (step 7c).
   toggleScratch sat in this same section only by physical accident (it's
   not launch-intro code) -- moved to src/player/scrub.js instead, the
   module that already owns Scratch. */

/* The player overlay (openPlayerViaSheet, openPlayer, closePlayer,
   morphInFlight, runMorphOpen, interruptMorph) sat under this "launch
   intro" header only by physical accident — moved to
   src/shell/player-overlay.js (step 7b). */

/* Background playback (background.js/bgPrime/bgRouteActive/bgIdleNow/
   bgPosition/bgSync/bgUpdateUI/toggleBgAudio/applyBgAudioSetting/
   applyOutputRoute, and the Media Session / lock-screen handlers) moved to
   src/player/background.js (step 6c). */

/* ================= library ================= */
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
  if(t.art){ const im = el('img','t-art'); im.src = t.art; im.alt=''; li.appendChild(im); }
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
    setQueue(queue, pos, true);
  });
  if(extra) extra(li, i);
  return li;
}

function toggleEditSelect(id, node){
  if(S.editSelection.has(id)) S.editSelection.delete(id); else S.editSelection.add(id);
  node.classList.toggle('picked', S.editSelection.has(id));
  updateSelectBar();
}

function enterSelectMode(){
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
let rowMenuTrackId = null;
function openRowMenu(t){
  rowMenuTrackId = t.id;
  $('#rowMenuTitle').textContent = t.tags.title;
  $('#rowMenuCredits').style.display = trackHasCreditsContent(t) ? '' : 'none';
  $('#rowMenuFav').textContent = isFavorite(t.id) ? 'Remove from Favorites' : 'Add to Favorites';
  $('#rowMenuOverlay').classList.add('open');
  $('#rowMenuOverlay').setAttribute('aria-hidden','false');
}
function closeRowMenu(){
  rowMenuTrackId = null;
  $('#rowMenuOverlay').classList.remove('open');
  $('#rowMenuOverlay').setAttribute('aria-hidden','true');
}

/* Liner notes & credits (CREDITS spec §1) and credits that link: person
   view (CREDITS spec §2) moved to src/library/credits.js (step 5e). */

let confirmDeleteAction = null;
function openConfirmDelete(kind, count, name, action){
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
function closeConfirmDelete(){
  confirmDeleteAction = null;
  $('#confirmOverlay').classList.remove('open');
  $('#confirmOverlay').setAttribute('aria-hidden','true');
}

// numbers the current selection 1..N in whatever order it's currently
// displayed in — session tracking needs a real order, which an untagged
// hand-assembled folder otherwise has no reliable way to express
async function applyTrackNumbersInOrder(){
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
  if(art){ const im = el('img','g-art'); im.src = art; im.alt=''; b.appendChild(im); }
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
  const at = pl.items.indexOf(i);
  if(at >= 0) pl.items.splice(at,1); else pl.items.push(i);
  queueSave();
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
      if(k === 'manual' && !S.albumOrder[album]) S.albumOrder[album] = albumTracks(album);
      S.albumSort[album] = k;
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
    if(mode === 'manual') row.appendChild(moverCtl(S.albumOrder[album], pos, syncQueueOrder));
    ul.appendChild(row);
  });
  host.appendChild(ul);
  if(mode === 'manual') host.appendChild(el('p','note',
    'Your order for this album holds for the session. Tap a track to play the album in this order.'));
}

/* Library-wide search + sort, and tag-aware search (CREDITS spec §3),
   moved to src/library/search.js (step 5e). */

/* S4: crate image tiers (buildCrateTier, deleteCrateArtTiers, healCrateArt,
   getCrateArtURL, prewarmCrateAnchorL) moved to src/crate/tiers.js
   (step 7c). The crate data model (buildCrateModel, ensureCrateModel,
   invalidateCrateModel, isNowPlayingAlbum, persistCrateAnchor,
   crateRailJumpTarget, libraryHasGenres) moved to src/crate/model.js
   (step 7c) -- it sat in this same section only by physical accident,
   not because grouping/sorting albums is image-tier work. */

/* ================= S3: gatefold album view (opens from the crate) =========
   Three flat planes in one 3D stage (the cover, its own backface-hidden
   back face as the inside-left panel, and the tracklist sitting behind it
   at the same spot) — see GATEFOLD spec §A2. Entry point is the crate only;
   every other album entry point keeps renderAlbumDetail() untouched. */
export let GF = null;   // ephemeral render state for the open gatefold; null when closed

export function isGatefoldOpen(){ return !!GF; }

function gatefoldViewportMode(){
  const w = window.innerWidth, h = window.innerHeight;
  if(w >= 700 && h >= 500) return 'wide';
  if(h < 640) return 'short';
  return 'normal';
}

function updateGatefoldScale(){
  if(!GF) return;
  const s = GF.mode === 'wide' ? 1 : Math.min(window.innerWidth / 390, window.innerHeight / 740);
  document.documentElement.style.setProperty('--gf-page-scale', s);
}

// same ordering as renderAlbumDetail()/albumTracks() (spec §A4)
function gatefoldTrackIndices(item){ return albumTracks(item.album); }

// null (no split) or an ordered list of {label, idx:[...]} — multi-disc
// splits by disc, a single disc of 4+ tracks splits at the midpoint, 3 or
// fewer never splits (spec §A5); track numbers still count straight through
function gatefoldSideSplits(trackIdx){
  if(!S.albumSides || trackIdx.length < 4) return null;
  const discs = [...new Set(trackIdx.map(i => S.tracks[i].tags.disc || 0))];
  if(discs.length > 1){
    return discs.map((d, k) => ({label:'SIDE ' + String.fromCharCode(65 + k),
      idx: trackIdx.filter(i => (S.tracks[i].tags.disc || 0) === d)}));
  }
  const mid = Math.ceil(trackIdx.length / 2);
  return [{label:'SIDE A', idx: trackIdx.slice(0, mid)}, {label:'SIDE B', idx: trackIdx.slice(mid)}];
}

function gatefoldNowGlyph(){
  const span = el('span','gf-now-glyph');
  span.innerHTML = '<span></span><span></span><span></span>';
  return span;
}

function gatefoldTrackRow(i, pos, trackIdx, playHandler){
  const t = S.tracks[i];
  const row = document.createElement('button');
  row.className = 'gf-track-row';
  row.setAttribute('role','listitem');
  row.dataset.pos = pos;
  const isNow = i === S.index;
  row.classList.toggle('gf-now-playing', isNow);
  const num = el('span','gf-tn');
  if(isNow) num.appendChild(gatefoldNowGlyph()); else num.textContent = String(pos).padStart(2,'0');
  row.appendChild(num);
  row.appendChild(el('span','gf-tt', t.tags.title));
  row.appendChild(el('span','gf-td', fmt(t.duration)));
  row.addEventListener('click', () => (playHandler || gatefoldPlayTrack)(trackIdx, i));
  return row;
}

// playHandler lets the sealed sheet reuse this exact rendering (order, rows,
// sides) while running a different play path (SEALED spec §5) — the
// gatefold's own default stays fully quiet, no ceremony (GATEFOLD spec §A6)
function buildGatefoldTracklist(item, trackIdx, playHandler){
  const host = document.createDocumentFragment();
  host.appendChild(el('p','gf-tl-head', item.artist.toUpperCase()));
  host.appendChild(el('h2','gf-tl-title', item.album));
  const sides = gatefoldSideSplits(trackIdx);
  if(sides){
    sides.forEach(side => {
      const total = side.idx.reduce((s,i) => s + (S.tracks[i].duration || 0), 0);
      const head = el('div','gf-side-head');
      head.appendChild(el('b', null, side.label));
      head.appendChild(el('span', null, side.idx.length + (side.idx.length===1?' TRACK · ':' TRACKS · ') + fmt(total).toUpperCase()));
      host.appendChild(head);
      side.idx.forEach(i => host.appendChild(gatefoldTrackRow(i, trackIdx.indexOf(i) + 1, trackIdx, playHandler)));
    });
  } else {
    trackIdx.forEach((i,k) => host.appendChild(gatefoldTrackRow(i, k + 1, trackIdx, playHandler)));
  }
  return host;
}

// credit names close the gatefold before opening the person view, so the
// crate underneath isn't left showing a stale position when it reopens
function gatefoldCreditLink(name){
  const b = el('button','', name);
  b.style.color = 'var(--accent)'; b.style.textDecoration = 'underline';
  b.addEventListener('click', () => { closeGatefoldInstant(); openPersonOrArtist(name); });
  return b;
}

// Rating stars, sleeve note and pin toggle for YOUR OWN copy of this record
// — local-first (MizikiSocial.setRating/setNote/pin work with no server
// configured at all), published by the sync engine once signed in. Lives at
// the end of the gatefold's "Inside" panel — today's closest thing to an
// album detail view — so it's reachable from both the normal left panel and
// the short-viewport flat "Inside" tab, which both call this same builder.
function gatefoldSocialControlsHTML(item){
  const wrap = el('div','gf-social');
  wrap.appendChild(el('p','gf-social-caption','YOUR COPY'));

  const stars = el('div','gf-stars');
  stars.setAttribute('role','radiogroup');
  stars.setAttribute('aria-label','Your rating');
  for(let i = 1; i <= 5; i++){
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'gf-star-btn'; b.dataset.star = String(i);
    b.setAttribute('aria-label', i + (i === 1 ? ' star' : ' stars'));
    stars.appendChild(b);
  }
  wrap.appendChild(stars);

  const note = document.createElement('textarea');
  note.className = 'gf-note-input'; note.maxLength = 140; note.rows = 2;
  note.placeholder = 'Tap to add a sleeve note.';
  note.setAttribute('aria-label', 'Sleeve note');
  note.addEventListener('change', () => MizikiSocial.setNote(item.albumId, note.value));
  wrap.appendChild(note);

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button'; pinBtn.className = 'gf-pin-btn';
  wrap.appendChild(pinBtn);

  function paint(){
    const s = MizikiSocial.getAlbumSocial(item.albumId);
    stars.querySelectorAll('.gf-star-btn').forEach(b => {
      const i = Number(b.dataset.star), on = s.rating != null && i <= s.rating;
      b.textContent = on ? '★' : '☆';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if(document.activeElement !== note) note.value = s.note || '';
    const pinned = s.pinRank != null;
    pinBtn.setAttribute('aria-pressed', String(pinned));
    pinBtn.textContent = pinned ? 'Pinned to crate · #' + s.pinRank : 'Pin to crate';
  }
  stars.querySelectorAll('.gf-star-btn').forEach(b => {
    b.addEventListener('click', () => {
      const i = Number(b.dataset.star);
      const cur = MizikiSocial.getAlbumSocial(item.albumId).rating;
      MizikiSocial.setRating(item.albumId, cur === i ? null : i);   // tap the lit star again to clear
      paint();
    });
  });
  pinBtn.addEventListener('click', () => {
    const pinned = MizikiSocial.getAlbumSocial(item.albumId).pinRank != null;
    if(pinned) MizikiSocial.unpin(item.albumId);
    else if(!MizikiSocial.pin(item.albumId)){
      pinBtn.textContent = 'Staff picks full — unpin one first';
      setTimeout(paint, 1800);
      return;
    }
    paint();
  });

  paint();
  return wrap;
}

function buildGatefoldLeftPanel(item){
  const host = document.createDocumentFragment();
  const liner = albumLinerNotes(item.album);
  const roll = albumCreditRoll(item.album);
  if(!liner && !roll.size){
    host.appendChild(el('h3', null, item.album));
    const metaBits = [item.year || null, item.genre || null,
      item.trackCount + (item.trackCount===1?' track':' tracks'), fmt(item.idx.reduce((s,i)=>s+(S.tracks[i].duration||0),0))].filter(Boolean);
    host.appendChild(el('p','gf-meta-line', metaBits.join(' · ').toUpperCase()));
    host.appendChild(el('p','gf-minimal-note','No liner notes in these files.'));
    host.appendChild(gatefoldSocialControlsHTML(item));
    return host;
  }
  if(liner) host.appendChild(el('p','gf-liner', liner));
  if(roll.size){
    roll.forEach((names, label) => {
      const row = el('div','gf-credit-row');
      row.appendChild(el('em', null, label));
      const cell = el('span');
      names.forEach((n,i) => { if(i) cell.appendChild(document.createTextNode(', ')); cell.appendChild(gatefoldCreditLink(n)); });
      row.appendChild(cell);
      host.appendChild(row);
    });
  }
  const metaBits = [item.year || null, item.genre || null,
    item.trackCount + (item.trackCount===1?' track':' tracks')].filter(Boolean);
  host.appendChild(el('p','gf-meta-line', metaBits.join(' · ').toUpperCase()));
  host.appendChild(gatefoldSocialControlsHTML(item));
  return host;
}

function gatefoldOnPlatter(item){
  return S.shellAlbumId === item.albumId && !S.platterEmpty;
}

function updateGatefoldSleeveState(){
  if(!GF) return;
  $('#gfSleeveDiscWrap').classList.toggle('gf-disc-empty', gatefoldOnPlatter(GF.item));
}

// decorative only: the disc peeks out as if pulled from the pocket, then the
// pocket settles into its normal (now-empty, since this album is playing)
// state — never touches S.shellAlbumId, the pull, or the full player (§A6)
function gatefoldSleeveFlourish(){
  const wrap = $('#gfSleeveDiscWrap');
  wrap.classList.add('gf-disc-out');
  setTimeout(() => { wrap.classList.remove('gf-disc-out'); updateGatefoldSleeveState(); }, 400);
}

// A tap on a track already in the open gatefold's own album either changes
// nothing but the song (same album as whatever's playing — just a plain,
// quiet play, exactly as before) or hands the record off to the main player
// (a different album — Part 2 §1). "Different" here compares the open
// gatefold's album against whatever is CURRENTLY PLAYING, not against the
// tapped track's album (every row in this tracklist is the same album as
// the open gatefold by construction).
function gatefoldPlayTrack(trackIdx, i){
  const albumId = GF && GF.item && GF.item.albumId;
  const curr = current();
  const sameAlbum = !!albumId && !!curr && albumKey(curr) === albumId;
  if(sameAlbum || !S.playInFullPlayer){
    setQueue(trackIdx, trackIdx.indexOf(i), false);
    play();
    gatefoldSleeveFlourish();
    return;
  }
  const startRect = $('#gfSleeveDiscWrap').getBoundingClientRect();
  setQueue(trackIdx, trackIdx.indexOf(i), false);
  if(REDUCED){
    // no flight — the player opens with the record already seated, then audio
    closeGatefoldInstant();
    if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
    else openPlayerViaSheet(current(), S.pendingShellInfo);
    return;
  }
  runGatefoldHandoff(startRect, current(), S.pendingShellInfo, play);
}

// a sealed album's first play runs the normal ceremony (so the peel is
// actually seen) but on the platter/mini-player only — never the full
// player sheet (SEALED spec §5: "the sleeve pull runs behind the sheet as
// usual... the player is not forced open"). Used by the crate's own Play
// affordances for a sealed record (list/crate rows) — unchanged by Part 2.
export function sealedQuietPlay(trackIdx, i){
  setQueue(trackIdx, trackIdx.indexOf(i), false);
  runStartSequence(current(), S.pendingShellInfo, play);
}

// the seal sheet's own row tap: the closest equivalent to "the gatefold
// song-tap handler" for an album that can't open the gatefold yet (Part 2
// §1, "Sealed albums"). A sealed album was by definition never played, so
// this is always the "different album" case — peel first (the existing S5
// peel, reused as-is via runStartSequence), then the hand-off's spirit is
// satisfied by forcing the player open (rather than staying quiet) when the
// setting is on. There is no separate pocket to fly from here, so unlike
// gatefoldPlayTrack this reuses the ceremony wholesale instead of the flight.
function sealedHandoffPlay(trackIdx, i){
  setQueue(trackIdx, trackIdx.indexOf(i), false);
  closeSealedSheetInstant();
  if(!S.playInFullPlayer){
    runStartSequence(current(), S.pendingShellInfo, play);
    return;
  }
  if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
  else openPlayerViaSheet(current(), S.pendingShellInfo);
}

function gatefoldRestoreRowNumber(row){
  const num = row.querySelector('.gf-tn');
  if(num) num.textContent = String(row.dataset.pos).padStart(2,'0');
}

// live-updates the now-playing marker without rebuilding the whole panel —
// called from load() on every track change while the gatefold is open (§A4).
// Rows are built in the same order as GF.trackIdx (sides only insert divider
// headers between them, never reorder the tracks), so position maps directly.
export function updateGatefoldNowPlaying(){
  if(!GF) return;
  updateGatefoldSleeveState();
  document.querySelectorAll('.gf-track-row.gf-now-playing').forEach(row => {
    row.classList.remove('gf-now-playing');
    gatefoldRestoreRowNumber(row);
  });
  const t = current();
  if(!t || albumKey(t) !== GF.item.albumId) return;
  let pos = -1;
  GF.trackIdx.forEach((i, k) => { if(i === S.index) pos = k; });
  const rows = document.querySelectorAll('.gf-track-row');
  if(pos < 0 || pos >= rows.length) return;
  const row = rows[pos];
  row.classList.add('gf-now-playing');
  const num = row.querySelector('.gf-tn');
  if(num){ num.innerHTML = ''; num.appendChild(gatefoldNowGlyph()); }
}

function gatefoldInfoAndSleeveHTML(item){
  const info = $('#gfInfo'); info.innerHTML = '';
  info.appendChild(el('h3','gf-info-title', item.album));
  info.appendChild(el('p','gf-info-sub', item.artist + (item.year ? ' · ' + item.year : '')));
  const metaBits = [item.genre || null, item.trackCount + (item.trackCount===1?' track':' tracks'),
    fmt(item.idx.reduce((s,i)=>s+(S.tracks[i].duration||0),0))].filter(Boolean);
  info.appendChild(el('p','gf-info-meta', metaBits.join(' · ').toUpperCase()));
}

async function gatefoldSetCoverArt(item){
  const img = $('#gfCoverArt'), discArt = $('#gfDiscArt');
  const fallback = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art) || '';
  if(fallback){ img.src = fallback; discArt.src = fallback; }
  const url = await getCrateArtURL(item.albumId, 'L');
  if(url && GF && GF.item === item){ img.src = url; discArt.src = url; }
}

function gatefoldSwitchPanel(panel){
  if(!GF) return;
  GF.panel = panel;
  const camera = $('#gfCamera');
  if(GF.mode !== 'wide'){
    camera.style.transition = 'transform ' + GATEFOLD_ANIM.leftPanelMs + 'ms ease';
    camera.style.setProperty('--gf-cx', panel === 'left' ? '-175px' : '175px');
  }
  document.querySelectorAll('#gfPanelToggle [data-panel], #gfFlatSeg [data-panel]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.panel === panel)));
  if(GF.mode === 'short'){
    $('#gfFlatBody').innerHTML = '';
    if(panel === 'left') $('#gfFlatBody').appendChild(buildGatefoldLeftPanel(GF.item));
    else $('#gfFlatBody').appendChild(buildGatefoldTracklist(GF.item, GF.trackIdx));
  } else {
    (panel === 'left' ? $('#gfLeft') : $('#gfTracklist')).focus();
  }
}

let gfSkipHandler = null, gfDragCleanup = null;

function gatefoldTeardownGestures(){
  if(gfSkipHandler){ $('#gatefold').removeEventListener('pointerdown', gfSkipHandler, {capture:true}); gfSkipHandler = null; }
  if(gfDragCleanup){ gfDragCleanup(); gfDragCleanup = null; }
}

// swipe right/left between the tracklist and the inside-left panel in both
// normal mode (live camera pan over #gfStage) and short mode (plain panel
// swap over #gfFlatBody, since #gfFlatTracks sits on top of #gfStage there
// and would otherwise swallow the gesture) — a direction lock after ~8px
// keeps a vertical scroll from also triggering a panel switch — plus a
// drag-down on the info strip to close (§A3, §A7)
function gatefoldWireGestures(){
  let start = null;
  const onDown = e => { start = {x:e.clientX, y:e.clientY, locked:null, t:performance.now()}; };
  const onMove = e => {
    if(!start || !GF || GF.mode === 'short') return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if(!start.locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) start.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    if(start.locked === 'h' && GF.mode !== 'wide'){
      const base = GF.panel === 'left' ? -175 : 175;
      const next = clamp(base + dx * 0.5, -175, 175);
      $('#gfCamera').style.transition = 'none';
      $('#gfCamera').style.setProperty('--gf-cx', next + 'px');
    }
  };
  const onUp = e => {
    if(!start) return;
    const dx = e.clientX - start.x;
    if(start.locked === 'h' && GF && GF.mode !== 'wide'){
      if(Math.abs(dx) > 60) gatefoldSwitchPanel(dx < 0 ? 'left' : (GF.panel === 'left' && dx > 0 ? 'right' : GF.panel));
      else gatefoldSwitchPanel(GF.panel);
    }
    start = null;
  };
  const stage = $('#gfStage');
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);

  // short mode shows #gfFlatTracks as an opaque full-cover sibling of
  // #gfStage, so the stage's own listeners above never fire there — swipe
  // needs its own (simpler: no live camera pan, just swap panels on release)
  let flatStart = null;
  const onFlatDown = e => { flatStart = {x:e.clientX, y:e.clientY, locked:null}; };
  const onFlatMove = e => {
    if(!flatStart || !GF || GF.mode !== 'short') return;
    const dx = e.clientX - flatStart.x, dy = e.clientY - flatStart.y;
    if(!flatStart.locked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) flatStart.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
  };
  const onFlatUp = e => {
    if(!flatStart) return;
    const dx = e.clientX - flatStart.x;
    if(flatStart.locked === 'h' && GF && GF.mode === 'short' && Math.abs(dx) > 60)
      gatefoldSwitchPanel(dx < 0 ? 'left' : (GF.panel === 'left' && dx > 0 ? 'right' : GF.panel));
    flatStart = null;
  };
  const flatBody = $('#gfFlatBody');
  flatBody.addEventListener('pointerdown', onFlatDown);
  flatBody.addEventListener('pointermove', onFlatMove);
  flatBody.addEventListener('pointerup', onFlatUp);
  flatBody.addEventListener('pointercancel', onFlatUp);

  let infoDrag = null;
  const onInfoDown = e => { infoDrag = e.clientY; };
  const onInfoMove = e => {
    if(infoDrag == null) return;
    const dy = e.clientY - infoDrag;
    if(dy > 50) closeGatefold();
  };
  const onInfoUp = () => { infoDrag = null; };
  const info = $('#gfInfo');
  info.addEventListener('pointerdown', onInfoDown);
  info.addEventListener('pointermove', onInfoMove);
  info.addEventListener('pointerup', onInfoUp);

  gfDragCleanup = () => {
    stage.removeEventListener('pointerdown', onDown);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
    flatBody.removeEventListener('pointerdown', onFlatDown);
    flatBody.removeEventListener('pointermove', onFlatMove);
    flatBody.removeEventListener('pointerup', onFlatUp);
    flatBody.removeEventListener('pointercancel', onFlatUp);
    info.removeEventListener('pointerdown', onInfoDown);
    info.removeEventListener('pointermove', onInfoMove);
    info.removeEventListener('pointerup', onInfoUp);
  };
}

function gatefoldSettledState(mode){
  const camera = $('#gfCamera'), cover = $('#gfCover');
  camera.style.transition = 'none';
  camera.style.setProperty('--gf-s', mode === 'wide' ? '1' : '.55');
  camera.style.setProperty('--gf-cx', mode === 'wide' ? '175px' : '0px');
  cover.style.transition = 'none';
  cover.style.transform = 'rotateY(-180deg)';
  $('#gfShadow').style.opacity = '0';
}

// tapping anywhere during the opening jumps straight to the settled spread,
// with a short fade, so repeat opens never feel slow (§A3)
function gatefoldSkipToSettled(mode){
  const overlay = $('#gatefold');
  overlay.style.transition = 'opacity ' + GATEFOLD_ANIM.skipMs + 'ms linear';
  gatefoldSettledState(mode);
  overlay.classList.add('gf-chrome-in');
  requestAnimationFrame(() => { $('#gfTracklist').focus(); });
}

async function runGatefoldOpen(mode){
  const overlay = $('#gatefold'), camera = $('#gfCamera'), cover = $('#gfCover');
  const seq = GF.seq;
  const skip = e => { e.stopPropagation(); e.preventDefault(); gatefoldSkipToSettled(mode); };
  gfSkipHandler = skip;
  overlay.addEventListener('pointerdown', skip, {capture:true, once:true});

  if(REDUCED || mode === 'short'){
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 150ms linear';
    void overlay.offsetWidth;
    overlay.style.opacity = '1';
    await sleep(150);
  } else {
    camera.style.transition = 'none';
    camera.style.setProperty('--gf-s', '1');
    camera.style.setProperty('--gf-cx', '175px');
    cover.style.transition = 'none';
    cover.style.transform = 'rotateY(0deg)';
    overlay.style.opacity = '0';
    void overlay.offsetWidth;
    overlay.style.transition = 'opacity ' + GATEFOLD_ANIM.liftMs + 'ms ' + GATEFOLD_ANIM.liftEasing;
    overlay.style.opacity = '1';
    await sleep(GATEFOLD_ANIM.liftMs);
    if(!GF || GF.seq !== seq) return;

    if(mode !== 'wide'){
      camera.style.transition = 'transform ' + GATEFOLD_ANIM.swingMs + 'ms ' + GATEFOLD_ANIM.swingEasing;
      camera.style.setProperty('--gf-s', '.55'); camera.style.setProperty('--gf-cx', '0px');
    }
    cover.style.transition = 'transform ' + GATEFOLD_ANIM.swingMs + 'ms ' + GATEFOLD_ANIM.swingEasing;
    cover.style.transform = 'rotateY(-180deg)';
    $('#gfShadow').style.transition = 'opacity ' + GATEFOLD_ANIM.swingMs + 'ms linear';
    $('#gfShadow').style.opacity = '0';
    await sleep(GATEFOLD_ANIM.swingMs);
    if(!GF || GF.seq !== seq) return;

    await sleep(GATEFOLD_ANIM.holdMs);
    if(!GF || GF.seq !== seq) return;

    if(mode !== 'wide'){
      camera.style.transition = 'transform ' + GATEFOLD_ANIM.pushMs + 'ms ' + GATEFOLD_ANIM.swingEasing;
      camera.style.setProperty('--gf-s', '1'); camera.style.setProperty('--gf-cx', '175px');
    }
    overlay.classList.add('gf-chrome-in');
    await sleep(GATEFOLD_ANIM.pushMs);
    if(!GF || GF.seq !== seq) return;
  }
  overlay.removeEventListener('pointerdown', skip, {capture:true});
  gfSkipHandler = null;
  overlay.classList.add('gf-chrome-in');
  $('#gfTracklist').focus();
}

let gfSeqCounter = 0;

export function openGatefold(item){
  if(GF) return;
  const mode = gatefoldViewportMode();
  const trackIdx = gatefoldTrackIndices(item);
  if(!trackIdx.length) return;
  GF = {item, trackIdx, panel:'right', seq: ++gfSeqCounter, mode, returnFocus: document.activeElement};

  const overlay = $('#gatefold');
  overlay.setAttribute('aria-label', item.album);
  overlay.classList.toggle('gf-wide', mode === 'wide');
  overlay.classList.remove('gf-chrome-in');
  overlay.style.opacity = '';

  $('#gfTracklist').innerHTML = ''; $('#gfTracklist').appendChild(buildGatefoldTracklist(item, trackIdx));
  $('#gfLeft').innerHTML = ''; $('#gfLeft').appendChild(buildGatefoldLeftPanel(item));
  gatefoldInfoAndSleeveHTML(item);
  gatefoldSetCoverArt(item).catch(() => {});
  updateGatefoldSleeveState();

  const hasLeftContent = !!(albumLinerNotes(item.album) || albumCreditRoll(item.album).size);
  $('#gfLeftCue').style.display = hasLeftContent ? '' : 'none';

  if(mode === 'short'){
    $('#gfFlatTracks').classList.add('show');
    $('#gfFlatBody').innerHTML = ''; $('#gfFlatBody').appendChild(buildGatefoldTracklist(item, trackIdx));
    document.querySelectorAll('#gfFlatSeg [data-panel]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.panel === 'right')));
  } else {
    $('#gfFlatTracks').classList.remove('show');
  }

  updateGatefoldScale();
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  gatefoldWireGestures();
  runGatefoldOpen(mode);
}

async function closeGatefold(){
  if(!GF) return;
  const g = GF; GF = null;
  gatefoldTeardownGestures();
  const overlay = $('#gatefold'), camera = $('#gfCamera'), cover = $('#gfCover');
  overlay.classList.remove('gf-chrome-in');
  if(REDUCED || g.mode === 'short'){
    overlay.style.transition = 'opacity 150ms linear';
    overlay.style.opacity = '0';
    await sleep(150);
  } else {
    if(g.mode !== 'wide'){
      camera.style.transition = 'transform ' + Math.round(GATEFOLD_ANIM.closeMs * 0.4) + 'ms ease-in';
      camera.style.setProperty('--gf-s', '.55'); camera.style.setProperty('--gf-cx', '0px');
    }
    cover.style.transition = 'transform ' + Math.round(GATEFOLD_ANIM.closeMs * 0.6) + 'ms ' + GATEFOLD_ANIM.swingEasing;
    cover.style.transform = 'rotateY(0deg)';
    await sleep(Math.round(GATEFOLD_ANIM.closeMs * 0.6));
    overlay.style.transition = 'opacity ' + Math.round(GATEFOLD_ANIM.closeMs * 0.4) + 'ms linear';
    overlay.style.opacity = '0';
    await sleep(Math.round(GATEFOLD_ANIM.closeMs * 0.4));
  }
  overlay.classList.remove('open','gf-wide');
  $('#gfFlatTracks').classList.remove('show');
  overlay.style.opacity = ''; overlay.style.transition = '';
  overlay.setAttribute('aria-hidden','true');
  if(g.returnFocus && document.contains(g.returnFocus) && typeof g.returnFocus.focus === 'function') g.returnFocus.focus();
  else { const stage = $('.crate-stage'); if(stage) stage.focus(); }
}

// an immediate, non-animated close for when the gatefold is being replaced
// by real navigation (a credit link) rather than dismissed on its own
export function closeGatefoldInstant(){
  if(!GF) return;
  GF = null;
  gatefoldTeardownGestures();
  const overlay = $('#gatefold');
  overlay.classList.remove('open','gf-wide','gf-chrome-in');
  $('#gfFlatTracks').classList.remove('show');
  overlay.style.opacity = ''; overlay.style.transition = '';
  overlay.setAttribute('aria-hidden','true');
}

let SEALSHEET = null;   // {item}, null when closed

function isSealedSheetOpen(){ return !!SEALSHEET; }

// after a seal breaks, fade the wrap off the small cover if its sheet is
// the one open right now — the sheet itself stays as it is (SEALED spec §5)
export function updateSealedSheetAfterBreak(albumId){
  if(!SEALSHEET || SEALSHEET.item.albumId !== albumId) return;
  const host = $('#sealSheetCoverWrap');
  const bits = host.querySelectorAll('.seal-wrap, .seal-sticker');
  bits.forEach(elm => {
    elm.style.transition = 'opacity .3s';
    elm.style.opacity = '0';
    setTimeout(() => elm.remove(), 300);
  });
}

export function openSealedSheet(item){
  if(SEALSHEET || GF) return;
  const trackIdx = gatefoldTrackIndices(item);
  if(!trackIdx.length) return;
  SEALSHEET = {item, returnFocus: document.activeElement};
  const sheet = $('#sealSheet');
  sheet.setAttribute('aria-label', item.album);
  $('#sealSheetArtist').textContent = item.artist.toUpperCase();
  $('#sealSheetTitle').textContent = item.album;
  const coverWrap = $('#sealSheetCoverWrap');
  coverWrap.querySelectorAll('.seal-wrap, .seal-sticker').forEach(n => n.remove());
  coverWrap.appendChild(buildSealOverlay(96));
  const art = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art) || '';
  if(art) $('#sealSheetCoverArt').src = art;
  getCrateArtURL(item.albumId, 'S').then(url => { if(url && SEALSHEET && SEALSHEET.item === item) $('#sealSheetCoverArt').src = url; });
  $('#sealSheetBody').innerHTML = '';
  $('#sealSheetBody').appendChild(buildGatefoldTracklist(item, trackIdx, sealedHandoffPlay));

  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden','false');
  requestAnimationFrame(() => { sheet.classList.add('show'); $('#sealSheetBody').focus(); });
}

async function closeSealedSheet(){
  if(!SEALSHEET) return;
  const s = SEALSHEET; SEALSHEET = null;
  const sheet = $('#sealSheet');
  sheet.classList.remove('show');
  await sleep(REDUCED ? 150 : 250);
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden','true');
  if(s.returnFocus && document.contains(s.returnFocus) && typeof s.returnFocus.focus === 'function') s.returnFocus.focus();
  else { const stage = $('.crate-stage'); if(stage) stage.focus(); }
}

// non-animated close, for when a track tap is already handing off to the
// player sheet — mirrors closeGatefoldInstant()'s role for the gatefold
function closeSealedSheetInstant(){
  if(!SEALSHEET) return;
  SEALSHEET = null;
  const sheet = $('#sealSheet');
  sheet.classList.remove('open','show');
  sheet.setAttribute('aria-hidden','true');
}

/* The crate view (openCrateAlbum, renderCrate, renderCrateFlat,
   applyCrateMiniInset, centerEmptyState) sat under the old "S3: gatefold
   album view" header only by physical accident -- moved to
   src/crate/view.js (step 7c). */

export function renderTracks(){
  const host = $('#libBody'); host.innerHTML = '';
  const v = S.view;
  $('#empty').style.display = S.tracks.length ? 'none' : 'block';
  if(!S.tracks.length) centerEmptyState();
  $('#selectToggle').style.display = (S.tracks.length && v.mode !== 'crate') ? '' : 'none';
  $('#selectBar').style.display = v.editSelecting ? 'flex' : 'none';
  updateLibTabsForLayout();
  updateHeaderActionsAvailability();
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v.mode)));
  refreshLibraryTools();
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
    host.appendChild(librarySortBar());
    const q = allIdx().sort(librarySortComparator('songs'));
    q.forEach((i,pos) => {
      const row = songRow(i, q, pos);
      if(isAlbumSealed(albumKey(S.tracks[i]))) row.querySelector('.t-name').appendChild(el('span','new-tag','NEW'));
      ul.appendChild(row);
    });
    host.appendChild(ul);
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
      host.appendChild(librarySortBar());
      sortAlbumGroups(groupBy('album')).forEach(([album, idx]) => {
        const artist = S.tracks[idx[0]].tags.albumArtist;
        const row = groupRow(album, artist + ' · ' + idx.length + (idx.length===1?' track':' tracks'),
          idx, ()=>{ v.group = album; renderTracks(); });
        if(isAlbumSealed(albumKey(S.tracks[idx[0]]))) row.querySelector('.g-text b').appendChild(el('span','new-tag','NEW'));
        host.appendChild(row);
      });
    } else {
      renderAlbumDetail(host, ul, v.group);
    }
  }

  else if(v.mode === 'artists'){
    if(v.group === null){
      groupBy('artist').forEach(([artist, idx]) => {
        const albums = new Set(idx.map(i => S.tracks[i].tags.album)).size;
        host.appendChild(groupRow(artist, albums + (albums===1?' album · ':' albums · ') + idx.length
          + (idx.length===1?' track':' tracks'), idx, ()=>{ v.group = artist; renderTracks(); }));
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
      if(!S.playlists.length) host.appendChild(el('p','note','No playlists yet. They live for this session only, since the library itself is rebuilt each time you open Miziki.'));
      // Favorites (and any other system playlist) pinned first, without
      // reordering S.playlists itself — v.playlist indexes the real array
      const order = S.playlists.map((_, n) => n).sort((a, b) => (S.playlists[a].system?0:1) - (S.playlists[b].system?0:1));
      order.forEach(n => {
        const pl = S.playlists[n];
        host.appendChild(groupRow(pl.name, pl.items.length + (pl.items.length===1?' track':' tracks'),
          pl.items, ()=>{ v.playlist = n; renderTracks(); }));
      });
      const add = el('div','stack');
      const nameIn = el('input','pl-input'); nameIn.placeholder = 'New playlist name'; nameIn.id = 'plName';
      const mk = el('button','cta','Create');
      mk.addEventListener('click', ()=>{
        const nm = nameIn.value.trim(); if(!nm) return;
        S.playlists.push({name:nm, items:[]}); queueSave();
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
          if(pl.items.includes(i)) row.classList.add('picked');
          ul.appendChild(row);
        });
        host.appendChild(ul);
        const done = el('button','cta','Done');
        done.addEventListener('click', ()=>{ v.picking = false; renderTracks(); });
        const wrap = el('div','stack'); wrap.appendChild(done); host.appendChild(wrap);
      } else {
        if(!pl.items.length) host.appendChild(el('p','note','This playlist is empty.'));
        pl.items.forEach((i,pos) => {
          const row = songRow(i, pl.items, pos);
          if(pl.items.length > 1) row.appendChild(moverCtl(pl.items, pos, syncQueueOrder));
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

/* Profile tab rendering (persistProfile, formatDisplayName, fmtCount,
   topTile, badges, the socialAuth wizard, renderSocialSettingsScreen, the
   storefront, and the real profile screens -- renderProfile,
   renderProfileHome, renderProfileExtras, renderTopAlbumsScreen,
   renderTopSongsScreen, renderCollectionScreen, which used to sit under
   the "Social Step E: demo mode" header below only because that's
   physically where they ended up) moved to src/profile/ (badges.js,
   storefront.js, settings.js, screens.js -- step 6e). persistTrackLastPlayed
   (the tiny "profile tab" section) moved there too, into screens.js.

   Social Step D (friend store, locked state, record sheet, home feed --
   socialNav, openFriendStore, openRecordSheet/closeRecordSheet, renderHome,
   the now-spinning subscription) moved to src/social/screens/
   (friend-store.js, home.js -- step 6e).

   installSocialDemo (Social Step E's only other export) moved to
   src/social/demo.js, loaded with a dynamic import() only when
   ?social=demo is present, so it never reaches the main bundle real
   users download -- see restoreLibrary() below. */

/* Share images (the style x format system, the My Crate card, the Now
   Playing card, and the share sheets' wiring) moved to src/share/
   (styles.js, crate-card.js, now-playing-card.js, sheet.js — step 6d). */

/* Navigation shell: header actions, search field, add menu
   (isLibraryRouteVisible/isProfileRouteVisible/showRoute moved to
   src/shell/routes.js; updateHeaderActionsAvailability/
   updateLibTabsForLayout/refreshLibraryTools/the header search field/the
   header + menu moved to src/shell/header.js — step 7b). These sat under
   the old "share image"/"setMode" header only because that's physically
   where they were in the file, not because they're share-image or mode
   code. */

/* ================= wiring ================= */
(function init(){
  renderSearchChips();
  $('#play').addEventListener('click', async ()=>{
    if(!S.playing) bgPrime();
    if(!S.ctx) await ensureContext(null);
    if(S.playing) pause();
    // the sleeve is covering an empty platter — bring the disc back out
    // before playing, same ceremony as picking a track from the library
    else if(S.platterEmpty) runStartSequence(current(), updateShellAlbum(current()), play);
    else play();
  });
  $('#next').addEventListener('click', nextTrack);
  $('#prev').addEventListener('click', prevTrack);
  $('#shuffle').addEventListener('click', ()=>{ toggleShuffle(); queueSave(); });
  $('#repeat').addEventListener('click', ()=>{ cycleRepeat(); queueSave(); });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', ()=>{
    S.view.mode = b.dataset.view; S.view.group = null; S.view.artistAlbum = null; S.view.playlist = null;
    S.view.person = null; S.view.crateLooseIdx = null; S.view.picking = false;
    renderTracks();
  }));
  document.querySelectorAll('#libLayoutToggle [data-layout]').forEach(b => b.addEventListener('click', ()=>{
    S.libraryLayout = b.dataset.layout;
    document.querySelectorAll('#libLayoutToggle [data-layout]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    // the first tab's identity (crate vs flat albums) follows the layout —
    // if that's where the user currently is, follow it there too; otherwise
    // (Songs/Artists/Playlists, or drilled into something) leave them put
    if(S.view.mode === 'crate' || (S.view.mode === 'albums' && S.view.group === null)){
      S.view.mode = (S.libraryLayout === 'crate') ? 'crate' : 'albums';
    }
    queueSave();
    renderTracks();
  }));
  document.querySelectorAll('#crateGroupToggle [data-group]').forEach(b => b.addEventListener('click', ()=>{
    if(b.style.display === 'none') return;
    S.crateGroup = b.dataset.group;
    invalidateCrateModel();
    queueSave();
    renderTracks();
  }));
  document.querySelectorAll('#sidesToggle [data-sides]').forEach(b => b.addEventListener('click', ()=>{
    S.albumSides = b.dataset.sides === 'on';
    document.querySelectorAll('#sidesToggle [data-sides]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave();
  }));
  document.querySelectorAll('#sealedToggle [data-sealed]').forEach(b => b.addEventListener('click', ()=>{
    S.sealedRecords = b.dataset.sealed === 'on';
    document.querySelectorAll('#sealedToggle [data-sealed]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave();
    renderTracks();
  }));
  document.querySelectorAll('#playFullToggle [data-playfull]').forEach(b => b.addEventListener('click', ()=>{
    S.playInFullPlayer = b.dataset.playfull === 'on';
    document.querySelectorAll('#playFullToggle [data-playfull]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave();
  }));
  $('#scrub').addEventListener('input', ()=>{ S.scrubbing = true; });
  $('#scrub').addEventListener('change', e=>{
    S.scrubbing = false;
    const t = current(); if(t) seek((t.duration || 0) * e.target.value/1000);
  });
  $('#modeVinyl').addEventListener('click', ()=>{ setMode('vinyl'); queueSave(); });
  $('#modePure').addEventListener('click', ()=>{ setMode('pure'); queueSave(); });

  document.querySelectorAll('.tabbar-btn').forEach(b => b.addEventListener('click', ()=> showRoute(b.dataset.route)));

  $('#autoOn').addEventListener('click', ()=>{
    S.auto = true; $('#autoOn').setAttribute('aria-pressed','true'); $('#autoOff').setAttribute('aria-pressed','false');
    $('#manualRow').style.display = 'none';
    $('#autoDesc').textContent = 'The platter eases down across twilight.';
  });
  $('#autoOff').addEventListener('click', ()=>{
    S.auto = false; $('#autoOn').setAttribute('aria-pressed','false'); $('#autoOff').setAttribute('aria-pressed','true');
    $('#manualRow').style.display = 'block';
    $('#autoDesc').textContent = 'You are driving the platter yourself.';
  });
  $('#manual').addEventListener('input', e=>{
    S.manualRate = e.target.value/1000;
    $('#manualOut').textContent = S.manualRate.toFixed(3) + '×';
  });

  document.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', ()=>{
    S.target = parseFloat(b.dataset.target); queueSave();
    document.querySelectorAll('[data-target]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  document.querySelectorAll('[data-pace]').forEach(b => b.addEventListener('click', ()=>{
    S.pace = b.dataset.pace; queueSave();
    document.querySelectorAll('[data-pace]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#pacingDesc').textContent = S.pace === 'window'
      ? 'Spread across the whole twilight window.'
      : 'Held back, then a felt drop near the end.';
  }));

  $('#preview').addEventListener('input', e=>{
    const v = +e.target.value;
    if(!S.sun.ok || v === 0){ S.previewMin = 0; $('#previewOut').textContent = 'Live'; return; }
    const span = (S.sun.dusk - S.sun.set)/60000;
    const from = (S.sun.set - Date.now())/60000 - 5;
    S.previewMin = from + (v/100) * (span + 12);
    const c = nowClock();
    $('#previewOut').textContent = c.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  });
  $('#liveBtn').addEventListener('click', ()=>{ S.previewMin = 0; $('#preview').value = 0; $('#previewOut').textContent = 'Live'; });

  const charMap = {wow:'wowOut', sat:'satOut', soft:'softOut', comp:'compOut'};
  Object.keys(charMap).forEach(k => {
    $('#' + k).addEventListener('input', e=>{
      S.char[k] = e.target.value/100;
      $('#' + charMap[k]).textContent = e.target.value + '%';
      applyCharacter(); queueSave();
    });
  });
  const presets = {light:{wow:.12,sat:.18,soft:.22,comp:.2}, classic:{wow:.30,sat:.35,soft:.40,comp:.35}, worn:{wow:.62,sat:.6,soft:.68,comp:.55}};
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', ()=>{
    const p = presets[b.dataset.preset];
    Object.keys(p).forEach(k => {
      S.char[k] = p[k]; $('#' + k).value = Math.round(p[k]*100);
      $('#' + charMap[k]).textContent = Math.round(p[k]*100) + '%';
    });
    applyCharacter(); queueSave();
    if(S.mode !== 'vinyl') setMode('vinyl');
  }));

  $('#scratchBtn').addEventListener('click', toggleScratch);
  $('#motionBtn').addEventListener('click', toggleMotion);
  $('#sleevePullBtn').addEventListener('click', toggleSleevePull);
  $('#launchIntroBtn').addEventListener('click', toggleLaunchIntro);
  attachLaunchSettingRow();
  $('#bgAudioBtn').addEventListener('click', toggleBgAudio);
  bgUpdateUI();
  $('#floor').addEventListener('input', e=>{ S.motion.floor = e.target.value/100; $('#floorOut').textContent = e.target.value + '%'; });
  $('#maxSpeed').addEventListener('input', e=>{
    S.motion.max = +e.target.value;
    $('#maxSpeedOut').textContent = Math.round(S.motion.max*2.23694) + ' mph';
  });

  $('#pick').addEventListener('click', ()=> $('#file').click());
  $('#pickFolder').addEventListener('click', ()=> $('#folderFile').click());
  $('#tone').addEventListener('click', addTestTone);
  $('#tone2').addEventListener('click', addTestTone);
  $('#file').addEventListener('change', e=> addFiles(e.target.files));
  $('#folderFile').addEventListener('change', e=> addFiles(e.target.files));

  // Drag-and-drop over the library route — the nearest web equivalent to
  // "Open in Miziki"/UIFileSharingEnabled, which have no web API (see
  // PLAYBACK/IMPORT spec §2). Folders dropped via the OS file manager are
  // walked recursively through the DataTransferItem entry API.
  const libRoute = $('#route-library');
  ['dragenter','dragover'].forEach(evt => libRoute.addEventListener(evt, e => {
    e.preventDefault(); libRoute.classList.add('drag-over');
  }));
  ['dragleave','drop'].forEach(evt => libRoute.addEventListener(evt, e => {
    e.preventDefault(); libRoute.classList.remove('drag-over');
  }));
  libRoute.addEventListener('drop', async e => {
    const items = e.dataTransfer && e.dataTransfer.items;
    const files = items ? await filesFromDataTransferItems(items) : Array.from(e.dataTransfer.files || []);
    if(files.length) addFiles(files);
  });

  let armed = false, armTimer = null;
  $('#forget').addEventListener('click', async e => {
    if(!armed){
      armed = true; e.target.textContent = 'TAP AGAIN';
      armTimer = setTimeout(()=>{ armed = false; e.target.textContent = 'FORGET'; }, 4000);
      return;
    }
    clearTimeout(armTimer); armed = false; e.target.textContent = 'FORGET';
    await forgetLibrary();
  });

  $('#clearHistoryBtn').addEventListener('click', ()=>{
    $('#clearHistoryOverlay').classList.add('open');
    $('#clearHistoryOverlay').setAttribute('aria-hidden', 'false');
  });
  const closeClearHistory = () => {
    $('#clearHistoryOverlay').classList.remove('open');
    $('#clearHistoryOverlay').setAttribute('aria-hidden', 'true');
  };
  $('#clearHistoryClose').addEventListener('click', closeClearHistory);
  $('#clearHistoryCancel').addEventListener('click', closeClearHistory);
  $('#clearOrphanedBtn').addEventListener('click', async ()=>{ closeClearHistory(); await clearListeningHistory(true); });
  $('#clearAllHistoryBtn').addEventListener('click', async ()=>{ closeClearHistory(); await clearListeningHistory(false); });

  $('#dupClose').addEventListener('click', ()=>closeDupOverlay('skip'));
  $('#dupKeepBoth').addEventListener('click', ()=>closeDupOverlay('keep'));
  $('#dupReplace').addEventListener('click', ()=>closeDupOverlay('replace'));
  $('#dupSkip').addEventListener('click', ()=>closeDupOverlay('skip'));

  $('#scanDuplicatesBtn').addEventListener('click', openDuplicateScan);
  $('#dupScanClose').addEventListener('click', closeDuplicateScan);

  let searchDebounce = null;
  $('#librarySearch').addEventListener('input', ()=>{
    updateSearchChipsVisibility();
    $('#hdrSearchClear').style.display = $('#librarySearch').value ? '' : 'none';
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderTracks, 120);
  });
  $('#librarySearch').addEventListener('focus', updateSearchChipsVisibility);
  $('#librarySearch').addEventListener('blur', ()=>{ setTimeout(updateSearchChipsVisibility, 120); });

  // header search icon / Cancel / × (S1 §2.1)
  $('#hdrSearchBtn').addEventListener('click', openSearchField);
  $('#hdrSearchCancel').addEventListener('click', ()=>{
    $('#librarySearch').value = '';
    $('#hdrSearchClear').style.display = 'none';
    closeSearchField();
    renderTracks();
  });
  $('#hdrSearchClear').addEventListener('click', ()=>{
    $('#librarySearch').value = '';
    $('#hdrSearchClear').style.display = 'none';
    $('#librarySearch').focus();
    updateSearchChipsVisibility();
    renderTracks();
  });

  // header + menu: Add songs / Add folder (S1 §3). The file-picker .click()
  // must fire synchronously inside this user-gesture handler (iOS Safari).
  $('#hdrAddBtn').addEventListener('click', ()=> isAddMenuOpen() ? closeAddMenu() : openAddMenu());
  $('#addScrim').addEventListener('click', closeAddMenu);
  $('#addSongsRow').addEventListener('click', ()=>{ closeAddMenu(); $('#file').click(); });
  $('#addFolderRow').addEventListener('click', ()=>{ closeAddMenu(); $('#folderFile').click(); });
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    if(isGatefoldOpen()) closeGatefold();
    else if(isSealedSheetOpen()) closeSealedSheet();
    else if(isAddMenuOpen()){ closeAddMenu(); $('#hdrAddBtn').focus(); }
    else if(isSearchFieldOpen()){ $('#librarySearch').value = ''; closeSearchField(); renderTracks(); }
  });

  $('#gfBack').addEventListener('click', closeGatefold);
  $('#gfFlatBack').addEventListener('click', closeGatefold);
  $('#gfLeftCue').addEventListener('click', () => gatefoldSwitchPanel('left'));
  document.querySelectorAll('#gfPanelToggle [data-panel], #gfFlatSeg [data-panel]').forEach(b =>
    b.addEventListener('click', () => gatefoldSwitchPanel(b.dataset.panel)));
  window.addEventListener('resize', updateGatefoldScale);
  $('#sealSheetClose').addEventListener('click', closeSealedSheet);

  // Library tools disclosure panel (S1 §5)
  $('#libToolsToggle').addEventListener('click', ()=>{
    const open = $('#libToolsPanel').classList.toggle('open');
    $('#libToolsToggle').setAttribute('aria-expanded', String(open));
  });

  $('#selectToggle').addEventListener('click', enterSelectMode);
  $('#selectCancel').addEventListener('click', exitSelectMode);
  $('#selectEdit').addEventListener('click', ()=>{
    if(S.editSelection.size) openEditSheet(Array.from(S.editSelection));
  });
  $('#selectNumber').addEventListener('click', ()=>{
    if(S.editSelection.size) applyTrackNumbersInOrder();
  });
  $('#selectDelete').addEventListener('click', ()=>{
    const ids = Array.from(S.editSelection);
    if(!ids.length) return;
    openConfirmDelete('batch', ids.length, null, async () => { await deleteTracks(ids); exitSelectMode(); });
  });

  $('#rowMenuClose').addEventListener('click', closeRowMenu);
  $('#rowMenuEdit').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    if(id) openEditSheet([id]);
  });
  $('#rowMenuCredits').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const t = S.tracks[idxOf(id)]; if(t) openCreditsSheet(t);
  });
  $('#rowMenuFav').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    if(id) toggleFavorite(id);
  });
  $('#rowMenuRemove').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const t = S.tracks[idxOf(id)]; if(!t) return;
    openConfirmDelete('song', 1, t.tags.title, async () => { await deleteTracks([id]); });
  });
  $('#rowMenuPlayNext').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const i = idxOf(id); if(i >= 0) playNext(i);
  });
  $('#rowMenuAddQueue').addEventListener('click', ()=>{
    const id = rowMenuTrackId; closeRowMenu();
    const i = idxOf(id); if(i >= 0) addToQueue(i);
  });

  $('#confirmClose').addEventListener('click', closeConfirmDelete);
  $('#confirmCancel').addEventListener('click', closeConfirmDelete);
  $('#confirmGo').addEventListener('click', async ()=>{
    const action = confirmDeleteAction;
    closeConfirmDelete();
    if(action) await action();
  });

  $('#editCurrentBtn').addEventListener('click', ()=>{ const t = current(); if(t) openEditSheet([t.id]); });
  $('#trackInfoBtn').addEventListener('click', ()=>{ const t = current(); if(t) openCreditsSheet(t); });
  $('#creditsClose').addEventListener('click', closeCreditsSheet);
  $('#socialAuthClose').addEventListener('click', closeSocialAuth);
  $('#socialNavBack').addEventListener('click', popSocialScreen);
  $('#recordSheetClose').addEventListener('click', closeRecordSheet);
  $('#playerFavBtn').addEventListener('click', ()=>{ const t = current(); if(t) toggleFavorite(t.id); });
  $('#miniFavBtn').addEventListener('click', e => { e.stopPropagation(); const t = current(); if(t) toggleFavorite(t.id); });
  $('#sleepTimerBtn').addEventListener('click', openSleepSheet);
  $('#sleepClose').addEventListener('click', closeSleepSheet);
  $('#editClose').addEventListener('click', closeEditSheet);
  $('#editSave').addEventListener('click', saveEditSheet);
  $('#editRevert').addEventListener('click', async ()=>{
    const target = S.editTarget;
    if(!target || target.batch) return;
    await revertTrack(target.trackIds[0]);
    closeEditSheet();
  });
  $('#editArtPick').addEventListener('click', ()=> $('#editArtFile').click());
  $('#editArtFile').addEventListener('change', async e=>{
    const file = e.target.files[0];
    e.target.value = '';
    if(!file) return;
    try{
      const blob = await cropSquareImage(file, 800);
      S.editArtBlob = blob;
      renderEditArtPreview(URL.createObjectURL(blob));
    }catch(err){ /* bad image — leave whatever preview was already showing */ }
  });
  $('#undoBtn').addEventListener('click', undoLastEdit);

  $('#profilePicFile').addEventListener('change', async e=>{
    const file = e.target.files[0];
    e.target.value = '';
    if(!file) return;
    try{
      const blob = await cropSquareImage(file, 500);
      if(S.profile.art) try{ URL.revokeObjectURL(S.profile.art); }catch(err){}
      S.profile.artBlob = blob;
      S.profile.art = URL.createObjectURL(blob);
      await persistProfile();
      renderProfile();
    }catch(err){ /* bad image — leave the existing picture as-is */ }
  });

  $('#shareClose').addEventListener('click', closeShareSheet);
  document.querySelectorAll('#shareToggles button').forEach(b => b.addEventListener('click', ()=>{
    const key = b.dataset.section;
    S.shareSelection[key] = !S.shareSelection[key];
    b.setAttribute('aria-pressed', String(S.shareSelection[key]));
    queueShareRender();
  }));
  document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(b => b.addEventListener('click', ()=>{
    S.shareStyle = b.dataset.style;
    document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.style === S.shareStyle)));
    queueSave(); queueShareRender();
  }));
  document.querySelectorAll('#shareFormatSeg [data-format]').forEach(b => b.addEventListener('click', ()=>{
    S.shareFormat = b.dataset.format;
    document.querySelectorAll('#shareFormatSeg [data-format]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queueShareRender();
  }));
  $('#shareShareBtn').addEventListener('click', () => shareDoShare($('#shareCanvas'), 'miziki-crate-' + shareSelectedFormat('shareFormatSeg','square') + '.png'));
  $('#shareSave').addEventListener('click', () => shareDoSave($('#shareCanvas'), 'miziki-crate-' + shareSelectedFormat('shareFormatSeg','square') + '.png'));
  $('#shareCopy').addEventListener('click', () => shareDoCopy($('#shareCanvas')));

  $('#playerShareBtn').addEventListener('click', openPlayerShareSheet);
  $('#playerShareClose').addEventListener('click', closePlayerShareSheet);
  $('#lookBtn').addEventListener('click', openLookPicker);
  $('#queueBtn').addEventListener('click', openQueueSheet);
  $('#miniQueueBtn').addEventListener('click', openQueueSheet);
  $('#queueClose').addEventListener('click', closeQueueSheet);
  $('#lookClose').addEventListener('click', closeLookPicker);
  $('#sortMenuClose').addEventListener('click', closeSortMenu);
  document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(b => b.addEventListener('click', ()=>{
    S.shareStyle = b.dataset.style;
    document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.style === S.shareStyle)));
    queueSave(); queuePlayerShareRender();
  }));
  document.querySelectorAll('#playerShareFormatSeg [data-format]').forEach(b => b.addEventListener('click', ()=>{
    S.shareFormat = b.dataset.format;
    document.querySelectorAll('#playerShareFormatSeg [data-format]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queuePlayerShareRender();
  }));
  $('#playerShareShareBtn').addEventListener('click', () => shareDoShare($('#playerShareCanvas'), 'miziki-now-playing-' + shareSelectedFormat('playerShareFormatSeg','story') + '.png'));
  $('#playerShareSave').addEventListener('click', () => shareDoSave($('#playerShareCanvas'), 'miziki-now-playing-' + shareSelectedFormat('playerShareFormatSeg','story') + '.png'));
  $('#playerShareCopy').addEventListener('click', () => shareDoCopy($('#playerShareCanvas')));

  // backgrounding is the last reliable moment before the OS can kill the tab —
  // write the in-progress session synchronously, not on a timer
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') touchActiveSession();
  });

  wireSpinToScrub();

  $('#miniTap').addEventListener('click', openPlayer);
  $('#miniPlay').addEventListener('click', async ()=>{
    if(!S.playing) bgPrime();
    if(!S.ctx) await ensureContext(null);
    if(S.playing) pause();
    else if(S.platterEmpty && S.playerOpen) runStartSequence(current(), updateShellAlbum(current()), play);
    else if(S.platterEmpty){
      // the full player isn't open to show the pull, so there's nothing to
      // animate — skip straight to the pulled-out end state, same as
      // advance() already does for an ordinary track change with the
      // player closed, rather than running an unseen ~3-5s ceremony first
      S.platterEmpty = false;
      $('#platterBox').classList.remove('disc-hidden');
      play();
    }
    else play();
  });
  $('#playerDismiss').addEventListener('click', closePlayer);
  $('#playerOverlay').addEventListener('pointerdown', ()=>{
    interruptStartSequence();            // pull/return-to-sleeve: snap to end state
    if(morphInFlight()) interruptMorph(); // morph: reverse cleanly instead
    if(gfHandoffInFlight()) interruptGatefoldHandoff();   // hand-off flight: land instantly
  }, {capture:true});

  setMode('vinyl');
  fallbackSun();
  askLocation();
  drawSun();
  updateChromeInset();
  window.addEventListener('resize', updateChromeInset);
  requestAnimationFrame(frame);
  restoreLibrary();   // runs underneath the launch intro below; never waits on it
  // REDUCED and document.hidden are known synchronously; S.launchIntro's
  // persisted value isn't (it loads inside restoreLibrary()), so
  // runLaunchSequence() re-checks it itself once that's resolved
  if(REDUCED || document.hidden) $('#launchOverlay').remove();
  else runLaunchSequence();
})();

async function restoreLibrary(){
  const note = $('#storeNote');
  const ok = await storage.open();
  if(!ok){
    note.textContent = 'Storage is not available here, so this library lasts only for the session. '
      + 'Served from your own address and added to the Home Screen, it persists.';
    renderTracks();
    markLibraryReady();
    return;
  }
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
  const recs = await tracks.all();
  recs.sort((a,b) => (a.addedAt||0) - (b.addedAt||0));
  for(const r of recs){
    const t = {
      id:r.id, addedAt:r.addedAt, name:r.tags.title, tags:Object.assign({}, r.tags), details: r.details || null, meta:r.meta,
      duration:r.duration, buffer:null, blob:null, stored:true, artBlob:null,
      gaplessDelaySec:r.gaplessDelaySec || 0, gaplessPaddingSec:r.gaplessPaddingSec || 0,
      sizeBytes:r.sizeBytes || 0,
      art: r.art ? URL.createObjectURL(r.art) : null
    };
    await loadOverlayFor(t);
    S.tracks.push(t);
  }
  await restoreMeta();
  await restoreSessions();
  await restoreSealedAlbums();
  rebuildPeopleIndex();
  invalidateCrateModel();
  renderTracks();
  healThumbs().catch(() => {});
  healDetails().catch(() => {});
  healCrateArt().catch(() => {});
  markLibraryReady();   // from here on the launch intro's library variant has what it needs
  if(S.tracks.length){
    // the mini player should agree with the launch intro's title screen —
    // both show what was last played, not just the first file in the
    // library (see LAUNCH spec C5)
    const lastAlbum = resolveLastPlayedAlbum();
    const lastIdx = lastAlbum !== null ? resolveLastPlayedTrackIndex(lastAlbum) : -1;
    setQueue(allIdx(), lastIdx >= 0 ? lastIdx : 0, false);
    note.textContent = S.tracks.length + (S.tracks.length === 1 ? ' track' : ' tracks')
      + ' restored from this device. Tracks are decoded as you play them, so opening Miziki stays quick.';
  } else {
    note.textContent = 'Your library will be kept on this device. Add it to your Home Screen so iOS does not clear it.';
  }
  await MizikiSocial.init({ url: SOCIAL_SUPABASE_URL, anonKey: SOCIAL_SUPABASE_ANON_KEY,
    env: { S, DB, albumKey, trackTier, albumMetalFor } });
  MizikiSocial.libraryLoaded();
  $('#homeTabBtn').style.display = MizikiSocial.status().enabled ? '' : 'none';
  MizikiSocial.on('status', s => { $('#homeTabBtn').style.display = s.enabled ? '' : 'none'; });
  if(new URLSearchParams(location.search).get('social') === 'demo'){
    // Dynamic import, not a static one: ?social=demo is dev-only (see
    // CLAUDE.md), so src/social/demo.js — fixture data and ~700 lines of
    // monkey-patching MizikiSocial's methods — must not be in the main
    // bundle real users download. Vite puts it in its own chunk; this is
    // the exact point in startup installSocialDemo() has always run from.
    const { installSocialDemo } = await import('./social/demo.js');
    installSocialDemo();
  }
}
