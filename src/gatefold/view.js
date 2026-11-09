/* ================= S3: gatefold album view (opens from the crate) =========
   Three flat planes in one 3D stage (the cover, its own backface-hidden
   back face as the inside-left panel, and the tracklist sitting behind it
   at the same spot) — see GATEFOLD spec §A2. GF12 (docs/29_GATEFOLD.md):
   this is the one album view everywhere — the crate, the Albums tab and
   an artist's own album drill-down (library/view.js's openAlbumFromLibrary())
   all open it through the same sealed -> single -> gatefold routing
   (crate/view.js's openCrateAlbum()).

   Only the gatefold itself lives here — a sealed record's own sealed
   front (GF8, docs/29_GATEFOLD.md), which shares gatefoldTrackIndices/
   gatefoldItemFormat with it, lives in the sibling module
   src/gatefold/sealed-front.js. */
import { S, current, touchBackupKey } from '../state.js';
import { $, el } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { clamp } from '../util/math.js';
import { REDUCED } from '../util/motion.js';
import { albumKey, trackIdentityKey, albumPressingTrack } from '../record-art/tiers.js';
import { discLook, paintDiscLook, hasLookChoice, openLookPicker } from '../record-art/looks.js';
import { wearStage, wearCopy, wearPhaseWord } from '../record-art/wear.js';
import { formatRecordName, formatSpeedText, RPM_45, platterSizeAttr } from '../record-art/format.js';
import { etchingFor } from '../record-art/etchings.js';
import { buildBackCoverEl, buildBackCoverImageEl, getAlbumBackCoverBlob } from './back-cover.js';
import { albumTracks, idOf, idxOf } from '../library/model.js';
import { albumLinerNotes, albumLinerNoteIsOverride, albumLinerNotesSource, setAlbumLinerNoteOverride, clearAlbumLinerNoteOverride, albumCreditRoll, albumDynamicsNote, buildDynamicsNoteEl, openPersonOrArtist, openCreditsSheet, trackHasCreditsContent } from '../library/credits.js';
import { isFavorite, toggleFavorite } from '../library/favorites.js';
import { bookletPageCount } from '../library/booklet.js';
import { openBookletViewer, openAddBookletPagesPicker } from './booklet.js';
import { thumbURL } from '../library/thumbs.js';
import { getCrateArtURL } from '../crate/tiers.js';
import { fmt } from '../util/text.js';
import { fileSpecLine } from '../player/track-spec.js';
import { setQueue, playNext, addToQueue } from '../player/queue.js';
import { play } from '../player/transport.js';
import { hapticTick } from '../ui/haptic.js';
import { runStartSequence } from '../shell/start-sequence.js';
import { openPlayerViaSheet } from '../shell/player-overlay.js';
import { currentDayPosition } from '../sundown/solar.js';
import { isAfterSunset } from '../sundown/day.js';
import { KEPT_FOR_PHASES } from '../sundown/spin-wording.js';
import { persistAlbumKeptFor } from '../history/sessions.js';
import { runGatefoldHandoff } from '../shell/handoff.js';
import { splitSides, albumFormatFor, discGroupsFor } from '../shell/ceremony-timing.js';
import { openLayer, closeLayer, closeLayerThen, forceCloseLayer } from '../shell/nav-stack.js';
import { gatefoldGeometry, gatefoldRowLayout } from './geometry.js';
import { queueSave } from '../storage/meta.js';
import { openConfirmDelete, renderTracks, moverCtl, syncQueueOrder } from '../library/view.js';
import { countForAlbum, deleteAlbum, deleteTracks } from '../library/delete.js';
import { openEditSheet } from '../library/edit.js';

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

// GF2 point 1: the drag-down-to-close thresholds -- past 120px of travel,
// or a release velocity past 0.6px/ms (a short, sharp flick covers much
// less than 120px but still clearly means "close"), commits; short of
// both, the overlay springs back.
const GF_CLOSE_DRAG_DISTANCE = 120;
const GF_CLOSE_DRAG_VELOCITY = 0.6;

// GF2/GF3 (docs/29_GATEFOLD.md point 2): the one place that reads
// gatefoldGeometry() and publishes it as CSS custom properties, the same
// "compute once, push as a var" shape GATEFOLD_ANIM already uses just
// above -- 11-gatefold.css's .gf-camera/.gf-right/.gf-cover/.gf-left-cue/
// .gf-sleeve-disc-wrap/.gf-sleeve-paper read these instead
// of their own copies of the same literals. Called once at module load
// with the 12" fallback (so the vars exist before any gatefold has ever
// opened) and again from openGatefold() with the open record's own
// format (GF3) -- every GF_GEOM.* read elsewhere in this file was
// replaced by GF.geom.*, the per-open record's own resolved geometry.
function pushGatefoldGeometryVars(geom){
  document.documentElement.style.setProperty('--gf-ref-w', geom.referenceWidth + 'px');
  document.documentElement.style.setProperty('--gf-ref-h', geom.referenceHeight + 'px');
  document.documentElement.style.setProperty('--gf-panel-size', geom.panelSize + 'px');
  document.documentElement.style.setProperty('--gf-pan', geom.panDistance + 'px');
  document.documentElement.style.setProperty('--gf-pocket-size', geom.pocketSize + 'px');
  document.documentElement.style.setProperty('--gf-disc-size', geom.discDiameter + 'px');
}
pushGatefoldGeometryVars(gatefoldGeometry());

export let GF = null;   // ephemeral render state for the open gatefold; null when closed

export function isGatefoldOpen(){ return !!GF; }

function gatefoldViewportMode(){
  const w = window.innerWidth, h = window.innerHeight;
  if(w >= 700 && h >= 500) return 'wide';
  if(h < 640) return 'short';
  return 'normal';
}

export function updateGatefoldScale(){
  if(!GF) return;
  const s = GF.mode === 'wide' ? 1 : Math.min(window.innerWidth / GF.geom.referenceWidth, window.innerHeight / GF.geom.referenceHeight);
  document.documentElement.style.setProperty('--gf-page-scale', s);
}

// same ordering albumTracks() has always returned (spec §A4)
export function gatefoldTrackIndices(item){ return albumTracks(item.album); }

// null (no split) or an ordered list of {label, idx:[...]} — multi-disc
// splits by disc, a single disc of 4+ tracks splits at the midpoint, 3 or
// fewer never splits (spec §A5); track numbers still count straight through.
// Exported for its own unit test (step 7e), same precedent as angleDelta
// (scrub.js, step 3c) and computeFlickPosition (launch/intro.js, step 7c).
export function gatefoldSideSplits(trackIdx){
  // the split rule itself lives in shell/ceremony-timing.js so the side flip
  // (CEREMONY §3) reads exactly the same sides the gatefold shows
  return splitSides(trackIdx, S.tracks, S.albumSides);
}

function gatefoldNowGlyph(){
  const span = el('span','gf-now-glyph');
  span.innerHTML = '<span></span><span></span><span></span>';
  return span;
}

// GF9 (docs/29_GATEFOLD.md point 2): a long press (~450ms) opens the track
// menu instead of playing; a tap still plays exactly as before. Direction-
// locked the same ~8px way gatefoldWireGestures()'s own panel swipe is
// below, so scrolling the tracklist never also starts (or interrupts) a
// press. Exported for its own unit test, same precedent as angleDelta
// (scrub.js) and computeFlickPosition (launch/intro.js).
export const GF_LONG_PRESS_MS = 450;
export function wireGatefoldTrackLongPress(row, i, trackIdx, playHandler){
  let timer = null, start = null, longPressed = false;
  const clearTimer = () => { if(timer){ clearTimeout(timer); timer = null; } };
  row.addEventListener('pointerdown', e => {
    longPressed = false;
    start = { x: e.clientX, y: e.clientY };
    clearTimer();
    timer = setTimeout(() => {
      timer = null; longPressed = true; start = null;
      hapticTick();
      openGatefoldTrackMenu(i, trackIdx);
    }, GF_LONG_PRESS_MS);
  });
  row.addEventListener('pointermove', e => {
    if(!start) return;
    if(Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8){ clearTimer(); start = null; }
  });
  row.addEventListener('pointerup', () => { clearTimer(); start = null; });
  row.addEventListener('pointercancel', () => { clearTimer(); start = null; });
  row.addEventListener('click', e => {
    if(longPressed){ longPressed = false; if(e.preventDefault) e.preventDefault(); return; }
    (playHandler || gatefoldPlayTrack)(trackIdx, i);
  });
}

// GF12 (docs/29_GATEFOLD.md) point 2: in reorder mode the row is a plain
// div, not a button -- a mover control (library/view.js's own moverCtl())
// sits inside it, and a button can't nest another button. No play/long-
// press wiring either; tapping a row does nothing until Track order is
// left again. GF15: select mode stays a button (no nested control) --
// tapping toggles the pick (gatefoldToggleTrackSelect()) instead of
// playing, same "one interaction while a mode is active" shape.
function gatefoldTrackRow(i, pos, trackIdx, playHandler, reorderCtl, selecting){
  const t = S.tracks[i];
  const row = document.createElement(reorderCtl ? 'div' : 'button');
  row.className = 'gf-track-row';
  row.setAttribute('role','listitem');
  row.dataset.pos = pos;
  const isNow = i === S.index;
  row.classList.toggle('gf-now-playing', isNow);
  if(selecting) row.classList.toggle('picked', GF && GF.selection.has(t.id));
  const num = el('span','gf-tn');
  if(isNow) num.appendChild(gatefoldNowGlyph()); else num.textContent = String(pos).padStart(2,'0');
  row.appendChild(num);
  row.appendChild(el('span','gf-tt', t.tags.title));
  if(reorderCtl) row.appendChild(reorderCtl);
  else if(selecting) row.addEventListener('click', () => gatefoldToggleTrackSelect(t.id));
  else{
    row.appendChild(el('span','gf-td', fmt(t.duration)));
    wireGatefoldTrackLongPress(row, i, trackIdx, playHandler);
  }
  return row;
}

// GF9: the small action sheet a long press opens — title, side and length,
// then Play next/Add to queue/Favorite (player/queue.js's and library/
// favorites.js's existing exports, nothing new in either) and this one
// track's own read-only credits (library/credits.js's existing
// openCreditsSheet/trackHasCreditsContent, same role rows/ISRC/person-view
// links the full credits sheet already shows — no new builder needed).
let gfTrackMenuCtx = null;
export function openGatefoldTrackMenu(i, trackIdx){
  const t = S.tracks[i];
  if(!t) return;
  gfTrackMenuCtx = { i, trackIdx };
  $('#gfTrackMenuTitle').textContent = t.tags.title;
  const sides = gatefoldSideSplits(trackIdx);
  const side = sides && sides.find(s => s.idx.includes(i));
  $('#gfTrackMenuMeta').textContent = (side ? side.label + ' · ' : '') + fmt(t.duration);
  $('#gfTrackMenuFav').textContent = isFavorite(t.id) ? 'Remove from Favorites' : 'Add to Favorites';
  $('#gfTrackMenuCredits').style.display = trackHasCreditsContent(t) ? '' : 'none';
  const overlay = $('#gfTrackMenuOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  openLayer('gf-track-menu', closeGatefoldTrackMenu, { container: overlay });
}
export function closeGatefoldTrackMenu(){
  gfTrackMenuCtx = null;
  $('#gfTrackMenuOverlay').classList.remove('open');
  $('#gfTrackMenuOverlay').setAttribute('aria-hidden','true');
}
export function gatefoldTrackMenuPlayNext(){
  if(!gfTrackMenuCtx) return;
  const { i } = gfTrackMenuCtx;
  closeLayer('gf-track-menu');
  playNext(i);
}
export function gatefoldTrackMenuAddToQueue(){
  if(!gfTrackMenuCtx) return;
  const { i } = gfTrackMenuCtx;
  closeLayer('gf-track-menu');
  addToQueue(i);
}
export function gatefoldTrackMenuToggleFavorite(){
  if(!gfTrackMenuCtx) return;
  const t = S.tracks[gfTrackMenuCtx.i];
  closeLayer('gf-track-menu');
  if(t) toggleFavorite(t.id);
}
export function gatefoldTrackMenuOpenCredits(){
  if(!gfTrackMenuCtx) return;
  const t = S.tracks[gfTrackMenuCtx.i];
  forceCloseLayer('gf-track-menu', {skipHistory: true});
  if(t) openCreditsSheet(t);
}

// RW7 (docs/23_RHYTHM_AND_WEAR.md): pure per-side play-count sums, from
// trackPlayCounts summed over each side's own track indices -- pulled out
// of buildGatefoldTracklist below purely for testability (the same
// precedent gatefoldSideSplits itself already sets), since the DOM half
// of that function can't run under node:test's plain-object document
// stub. null when wear is off. The bar's width is each side's share of
// the album's total plays, so an album with no plays yet (every side at
// 0) carries no share to draw a bar from at all.
export function gatefoldSideWearShares(sides){
  if(!sides) return null;
  const plays = sides.map(side => side.idx.reduce((s,i) =>
    s + (S.trackPlayCounts[trackIdentityKey(S.tracks[i])] || 0), 0));
  const total = plays.reduce((s,n) => s + n, 0);
  return plays.map(n => ({ plays: n, pct: total > 0 ? Math.round(n / total * 100) : 0 }));
}

// playHandler lets the sealed sheet reuse this exact rendering (order, rows,
// sides) while running a different play path (SEALED spec §5) — the
// gatefold's own default stays fully quiet, no ceremony (GATEFOLD spec §A6).
// GF12 (docs/29_GATEFOLD.md) point 2: opts.reorder turns this into the
// "Track order" reorder mode -- a flat list (side splits don't make sense
// once tracks can be dragged across them) with a mover control per row,
// same moveIn()/queueSave()/renderTracks() path library/view.js's own
// playlist reordering already uses (moverCtl(), reused rather than
// duplicated), plus the album-order bookkeeping that path doesn't need:
// S.albumOrder[item.album] is kept in id form (same as S.albumSort's
// lazy seeding in library/model.js's albumTracks()), touchBackupKey'd and
// synced into the live queue when this album is what's playing.
export function buildGatefoldTracklist(item, trackIdx, playHandler, opts){
  const host = document.createDocumentFragment();
  host.appendChild(el('p','gf-tl-head', item.artist));
  host.appendChild(el('h2','gf-tl-title', item.album));
  if(opts && opts.reorder){
    const album = item.album;
    const bar = el('div','gf-reorder-bar');
    bar.appendChild(el('span', null, 'Reordering tracks'));
    const done = el('button','gf-reorder-done','Done');
    done.addEventListener('click', gatefoldExitReorderMode);
    bar.appendChild(done);
    host.appendChild(bar);
    trackIdx.forEach((i, k) => {
      const fullPos = S.albumOrder[album].indexOf(idOf(i));
      const ctl = moverCtl(S.albumOrder[album], fullPos, ord => {
        touchBackupKey('albumOrder', album);
        syncQueueOrder(ord.map(idxOf).filter(x => x >= 0));
        refreshGatefoldTracklist();
      });
      host.appendChild(gatefoldTrackRow(i, k + 1, trackIdx, playHandler, ctl));
    });
    return host;
  }
  // GF15: "Select" -- a flat list, same reasoning as Track order's own
  // flattening just above (a batch selection spanning sides doesn't need
  // the side splits at all), with a bar of its own (count + Edit/Remove/
  // Done) standing in for the library header's own #selectBar, which
  // sits behind the gatefold and so can't be reused directly.
  if(opts && opts.select){
    const bar = el('div','gf-select-bar');
    bar.appendChild(el('span','gf-select-count', GF.selection.size + ' selected'));
    const stack = el('div','gf-select-bar-stack');
    // GF16 (Ken, 2026-11-06): the library's own select bar has a Select
    // all/Select none toggle (library/view.js's selectAllVisible()) --
    // this mirrors it for the gatefold's own GF.selection, scoped to this
    // album's trackIdx rather than the library's visibleTrackIds().
    const allPicked = trackIdx.length > 0 && trackIdx.every(i => GF.selection.has(S.tracks[i].id));
    const allBtn = el('button','cta ghost small', allPicked ? 'Select none' : 'Select all');
    allBtn.addEventListener('click', () => gatefoldToggleSelectAll(trackIdx));
    const editBtn = el('button','cta small','Edit');
    editBtn.disabled = GF.selection.size === 0;
    editBtn.addEventListener('click', gatefoldSelectEdit);
    const removeBtn = el('button','cta ghost small','Remove');
    removeBtn.disabled = GF.selection.size === 0;
    removeBtn.addEventListener('click', gatefoldSelectDelete);
    const done = el('button','cta ghost small','Done');
    done.addEventListener('click', gatefoldExitSelectMode);
    stack.appendChild(allBtn); stack.appendChild(editBtn); stack.appendChild(removeBtn); stack.appendChild(done);
    bar.appendChild(stack);
    host.appendChild(bar);
    trackIdx.forEach((i, k) => {
      host.appendChild(gatefoldTrackRow(i, k + 1, trackIdx, playHandler, null, true));
    });
    return host;
  }
  // GS12 (docs/30_GROOVES_AND_SHELF.md): a sleeve note pinned to a track
  // (side.idx's own 1-based position within its side, not gatefoldTrackRow's
  // global pos badge -- see MizikiSocial.setNoteAnchor()'s own comment).
  // Sides off (or too few tracks to split) still needs a side to match
  // against -- "SIDE A" for the whole album, same fallback
  // gatefoldSocialControlsHTML()'s own anchor picker already uses.
  const anchorSocial = MizikiSocial.getAlbumSocial(item.albumId);
  const anchor = anchorSocial.noteAnchor;
  const sides = gatefoldSideSplits(trackIdx);
  if(sides){
    const showWear = S.showWear !== false;
    const shares = showWear ? gatefoldSideWearShares(sides) : null;
    const totalPlays = shares ? shares.reduce((s,x) => s + x.plays, 0) : 0;
    // GF4 point 2: a "DISC N" eyebrow above each disc's own first side,
    // only once this album actually spans more than one disc -- a
    // single-disc album's sides (even A/B) stay exactly as before.
    // Track numbers (gatefoldTrackRow's own k+1 below) keep counting
    // straight through regardless.
    const discGroups = discGroupsFor(trackIdx, S.tracks);
    const discStartIdx = discGroups.length > 1 ? new Set(discGroups.map(g => g.idx[0])) : null;
    sides.forEach((side, si) => {
      if(discStartIdx && discStartIdx.has(side.idx[0])){
        const group = discGroups.find(g => g.idx[0] === side.idx[0]);
        host.appendChild(el('div','gf-disc-eyebrow', 'DISC ' + group.disc));
      }
      const total = side.idx.reduce((s,i) => s + (S.tracks[i].duration || 0), 0);
      const head = el('div','gf-side-head');
      head.appendChild(el('b', null, side.label));
      head.appendChild(el('span', null, side.idx.length + (side.idx.length===1?' track · ':' tracks · ') + fmt(total)));
      host.appendChild(head);
      if(showWear && totalPlays > 0){
        // QC4 (docs/24_QUIET_COUNTS.md point 2): the bar still shows each
        // side's share of the record's plays (shares[si].pct), but nothing
        // numeric is ever drawn next to it -- side.label alone, no play count.
        const wrap = el('div','gf-side-wear');
        wrap.appendChild(el('span','gf-side-wear-label', side.label));
        const bar = el('div','gf-side-wear-bar');
        const fill = el('div','gf-side-wear-fill');
        fill.style.width = shares[si].pct + '%';
        bar.appendChild(fill);
        wrap.appendChild(bar);
        host.appendChild(wrap);
      }
      const sideLetter = side.label.replace('SIDE ', '');
      side.idx.forEach((i, k) => {
        host.appendChild(gatefoldTrackRow(i, trackIdx.indexOf(i) + 1, trackIdx, playHandler));
        if(anchor && anchor.side === sideLetter && anchor.track === k + 1){
          host.appendChild(el('div','gf-anchor-note', anchorSocial.note));
        }
      });
    });
  } else {
    trackIdx.forEach((i,k) => {
      host.appendChild(gatefoldTrackRow(i, k + 1, trackIdx, playHandler));
      if(anchor && anchor.side === 'A' && anchor.track === k + 1){
        host.appendChild(el('div','gf-anchor-note', anchorSocial.note));
      }
    });
  }
  return host;
}

// credit names close the gatefold before opening the person view, so the
// crate underneath isn't left showing a stale position when it reopens
// TY3 (docs/22_TYPE.md)/GF1 (docs/29_GATEFOLD.md point 5): a token class in
// 11-gatefold.css, not an inline color/textDecoration write, for the same
// underline every credit name uses.
function gatefoldCreditLink(name){
  const b = el('button','gf-credit-link', name);
  b.addEventListener('click', () => { forceCloseLayer('gatefold'); openPersonOrArtist(name); });
  return b;
}

// RF22 (docs/12_REFINE.md, "words that invite", point 1): the empty
// sleeve note rotates through one of these four prompts rather than
// always showing the same generic line — a nudge toward something worth
// writing, never saved into the note itself (it's the textarea's own
// `placeholder`, not its `value` — MizikiSocial.setNote() is only ever
// called from the `change` listener below, which only fires on real
// input). Picked deterministically from the album's own id (a small
// string hash, not Math.random()) so the same record shows the same
// prompt on every repaint of this same session rather than flickering
// between prompts each time paint() re-runs, and so the gatefold and the
// desktop crate detail panel (which both call this one builder, per its
// own doc comment below) show the same prompt for the same record.
const SLEEVE_NOTE_PROMPTS = [
  'First heard it…',
  'Best side and why',
  'Play it when…',
  'The sound that hooked me',
];
function sleeveNotePromptFor(albumId){
  const s = String(albumId || '');
  let h = 0;
  for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return SLEEVE_NOTE_PROMPTS[Math.abs(h) % SLEEVE_NOTE_PROMPTS.length];
}

// Rating stars, sleeve note and pin toggle for YOUR OWN copy of this record
// — local-first (MizikiSocial.setRating/setNote/pin work with no server
// configured at all), published by the sync engine once signed in. Lives at
// the end of the gatefold's "Inside" panel — today's closest thing to an
// album detail view — so it's reachable from both the normal left panel and
// the short-viewport flat "Inside" tab, which both call this same builder.
// Exported so the picture sleeve (src/gatefold/picture-sleeve.js) can reuse
// the exact same rating/sleeve-note/pin controls instead of a second
// implementation.
// GF1 (docs/29_GATEFOLD.md point 1): the Record share card's whole payload,
// gathered in one place so the gatefold and any later entry point (the
// picture sleeve, a friend's record sheet) share it rather than each
// building their own partial version — src/share/record-card.js's own doc
// comment lists exactly this shape and reads nothing else. art: the
// crate's own L tier, falling back to the thumbnail/track art the same way
// gatefoldSetCoverArt() below does. variant/look/metal: the same
// discLook() resolution applyGatefoldDiscVariant() already uses, off the
// album's own pressing track. speed: the album's real format (33 or 45),
// honoring the personal override the same way every other format reader
// does. friendsCount: always null here — this is always your own copy.
// GF3: the one place that resolves an open (or about-to-open) item's real
// format -- the album's own track lengths through the personal Auto/33/45
// override, exactly as every other format reader here already read it
// inline. Shared by gatherRecordShareData(), gatefoldFormatLine() and
// openGatefold()'s own gatefoldGeometry()/platterSizeAttr() calls (GF3
// point 1), so there's one override lookup, not three copies of it.
// GF8 (docs/29_GATEFOLD.md): also used by sealed-front.js's own format
// line, before the gatefold itself has ever opened for this album.
export function gatefoldItemFormat(item){
  const override = (S.albumFormat && S.albumFormat[item.albumId]) || 'auto';
  return albumFormatFor(item.idx, S.tracks, override);
}

// CC3 point 4 (docs/34_CARE_AND_CONTROL.md): reads from the real RPC now
// instead of a hardcode -- MizikiSocial.friendsStickerCountsByKeys()
// resolves this device's own release_key through the `releases` table
// (the client never has a release_id for its own crate, CC2's own note).
// This is always your own copy, and friends_sticker() always excludes a
// release the caller owns, so the resolved count is, in practice, always
// 0/null here -- wired to the same data source as every other sticker
// rather than a second hand-maintained hardcode, with no behavior change.
export async function gatherRecordShareData(item){
  const t = albumPressingTrack(item.albumId) || S.tracks[item.idx[0]];
  const d = t ? discLook(t) : null;
  const fallbackArt = thumbURL['album:' + item.albumId] || (t && t.art) || null;
  const art = (await getCrateArtURL(item.albumId, 'L').catch(() => null)) || fallbackArt;
  const format = gatefoldItemFormat(item);
  const social = MizikiSocial.getAlbumSocial(item.albumId);
  const key = MizikiSocial.releaseKey(item.artist, item.album);
  let friendsCount = null;
  if(key){
    const r = await MizikiSocial.friendsStickerCountsByKeys([key]);
    if(r.ok && r.counts[key] != null) friendsCount = r.counts[key];
  }
  return {
    album: item.album, artist: item.artist, year: item.year, albumId: item.albumId,
    art, variant: d ? d.variant : null, look: d ? d.look : null, metal: d ? d.metal : null,
    speed: format.speed === RPM_45 ? 45 : 33,
    rating: social.rating != null ? social.rating : null,
    note: social.note || null,
    friendsCount,
  };
}

export function gatefoldSocialControlsHTML(item){
  const wrap = el('div','gf-social');
  wrap.appendChild(el('p','gf-social-caption','Your copy'));

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
  note.placeholder = sleeveNotePromptFor(item.albumId);
  note.setAttribute('aria-label', 'Sleeve note');
  note.addEventListener('change', () => MizikiSocial.setNote(item.albumId, note.value));
  wrap.appendChild(note);

  // GS12 (docs/30_GROOVES_AND_SHELF.md): "optionally pin it to a side and
  // track" -- track is 1-based *within its side* (B1, B2... the physical
  // vinyl convention), not the tracklist's own global pos badge.
  const trackIdx = gatefoldTrackIndices(item);
  const anchorSides = gatefoldSideSplits(trackIdx) || (trackIdx.length ? [{label:'SIDE A', idx: trackIdx}] : []);
  const anchorSel = document.createElement('select');
  anchorSel.className = 'gf-note-anchor-select';
  anchorSel.setAttribute('aria-label','Pin this note to a track');
  const noneOpt = document.createElement('option');
  noneOpt.value = ''; noneOpt.textContent = 'Not pinned to a track';
  anchorSel.appendChild(noneOpt);
  anchorSides.forEach(side => {
    const sideLetter = side.label.replace('SIDE ', '');
    side.idx.forEach((i, k) => {
      const opt = document.createElement('option');
      opt.value = sideLetter + ':' + (k + 1);
      opt.textContent = side.label + ' · ' + (k + 1) + ' — ' + S.tracks[i].tags.title;
      anchorSel.appendChild(opt);
    });
  });
  anchorSel.addEventListener('change', () => {
    if(!anchorSel.value){ MizikiSocial.setNoteAnchor(item.albumId, null); return; }
    const [side, track] = anchorSel.value.split(':');
    MizikiSocial.setNoteAnchor(item.albumId, {side, track: Number(track)});
  });
  wrap.appendChild(anchorSel);

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button'; pinBtn.className = 'gf-pin-btn';
  wrap.appendChild(pinBtn);

  // SH1 (docs/18_SHARE.md): "Record sheet / gatefold: a Share record
  // row." GF1: the full payload, gathered by gatherRecordShareData() above.
  const shareBtn = document.createElement('button');
  shareBtn.type = 'button'; shareBtn.className = 'gf-share-btn';
  shareBtn.textContent = 'Share record';
  shareBtn.addEventListener('click', async () => {
    const [{ openShareSheet }, data] = await Promise.all([
      import('../share/sheet.js'), gatherRecordShareData(item),
    ]);
    openShareSheet({ card:'record', data });
  });
  wrap.appendChild(shareBtn);

  function paint(){
    const s = MizikiSocial.getAlbumSocial(item.albumId);
    stars.querySelectorAll('.gf-star-btn').forEach(b => {
      const i = Number(b.dataset.star), on = s.rating != null && i <= s.rating;
      b.textContent = on ? '★' : '☆';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if(document.activeElement !== note) note.value = s.note || '';
    if(document.activeElement !== anchorSel) anchorSel.value = s.noteAnchor ? (s.noteAnchor.side + ':' + s.noteAnchor.track) : '';
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
      pinBtn.textContent = 'In rotation full — unpin one first';
      setTimeout(paint, 1800);
      return;
    }
    paint();
  });

  paint();
  return wrap;
}

// Exported (docs/17_SINGLES.md) so the picture-sleeve view can reuse the
// gatefold's own left-panel content wholesale (liner notes/credits, the
// meta line, and the shared social controls) rather than a second copy.
// GF7 (docs/29_GATEFOLD.md): the "Liner notes · yours" heading + Edit
// button at the top of the panel, every reader's one entry point into
// openLinerEditSheet() below. Lives inside buildGatefoldLeftPanel's own
// .gf-left-panel wrapper, not a fixed row like gatefoldSocialControlsHTML
// (GF1 point 6) -- it scrolls with the notes it labels.
function buildLinerNotesHeading(item){
  const row = el('div','gf-liner-head');
  const label = el('p','gf-liner-label');
  label.appendChild(document.createTextNode('Liner notes'));
  if(albumLinerNoteIsOverride(item.album)){
    label.appendChild(document.createTextNode(' · '));
    label.appendChild(el('span','gf-liner-yours','yours'));
  }
  row.appendChild(label);
  const editBtn = el('button', 'gf-liner-edit-btn', 'Edit');
  editBtn.type = 'button';
  editBtn.setAttribute('aria-label', 'Edit liner notes');
  editBtn.addEventListener('click', () => openLinerEditSheet(item));
  row.appendChild(editBtn);
  return row;
}

// GF10 (docs/29_GATEFOLD.md): "Booklet · N pages" (opens the viewer),
// shown only once pages exist (point 2) -- plus "Add booklet pages…",
// always there, which is how a page gets there in the first place when it
// didn't arrive as a sidecar at import (point 1). Same two-button-row
// shape as buildLinerNotesHeading above.
function buildBookletRow(item){
  const n = bookletPageCount(item.albumId);
  const row = el('div','gf-liner-head');
  if(n){
    const openBtn = el('button','gf-liner-label','Booklet · ' + n + (n === 1 ? ' page' : ' pages'));
    openBtn.type = 'button';
    openBtn.addEventListener('click', () => openBookletViewer(item));
    row.appendChild(openBtn);
  } else {
    row.appendChild(el('p','gf-liner-label','Booklet'));
  }
  const addBtn = el('button', 'gf-liner-edit-btn', n ? 'Add pages' : 'Add booklet pages…');
  addBtn.type = 'button';
  addBtn.setAttribute('aria-label', 'Add booklet pages');
  addBtn.addEventListener('click', () => openAddBookletPagesPicker(item));
  row.appendChild(addBtn);
  return row;
}

export function buildGatefoldLeftPanel(item){
  const host = el('div', 'gf-left-panel');
  host.appendChild(buildLinerNotesHeading(item));
  const liner = albumLinerNotes(item.album);
  const roll = albumCreditRoll(item.album);
  if(!liner && !roll.size){
    host.appendChild(el('h3', null, item.album));
    const metaBits = [item.year || null, item.genre || null,
      item.trackCount + (item.trackCount===1?' track':' tracks'), fmt(item.idx.reduce((s,i)=>s+(S.tracks[i].duration||0),0))].filter(Boolean);
    host.appendChild(el('p','gf-meta-line', metaBits.join(' · ')));
    // GF7: the same empty state, now a call to action since the heading
    // right above it carries the one way in to add any.
    host.appendChild(el('p','gf-minimal-note','Add liner notes.'));
    // GF1 (docs/29_GATEFOLD.md point 3): "THE MASTER block... now on the
    // phone too" -- shown whenever the album has been measured, regardless
    // of whether it has liner notes/credits of its own.
    const minimalNote = albumDynamicsNote(item.album);
    if(minimalNote) host.appendChild(buildDynamicsNoteEl(minimalNote));
    host.appendChild(buildBookletRow(item));
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
  // GF1 point 3: THE MASTER block, under the credits.
  const dynamicsNote = albumDynamicsNote(item.album);
  if(dynamicsNote) host.appendChild(buildDynamicsNoteEl(dynamicsNote));
  const metaBits = [item.year || null, item.genre || null,
    item.trackCount + (item.trackCount===1?' track':' tracks')].filter(Boolean);
  host.appendChild(el('p','gf-meta-line', metaBits.join(' · ')));
  host.appendChild(buildBookletRow(item));
  host.appendChild(gatefoldSocialControlsHTML(item));
  return host;
}

function gatefoldOnPlatter(item){
  return S.shellAlbumId === item.albumId && !S.platterEmpty;
}

// GF4 point 1: which disc the currently-loaded track belongs to -- the
// one disc whose pocket should read empty ("on the platter") while this
// album is the one playing. CC5 point 4: reads the same discGroupsFor()
// mapping gatefoldBuildSleevePockets() built the pockets from, rather
// than the raw tag, so a computed double LP's virtual disc 1/2 numbers
// line up too -- an untagged single-disc track has no group to match
// (discGroupsFor() returns one entry whose own `disc` already falls
// back to 0 the same way), so the plain tag read below still covers it.
function gatefoldDiscOf(trackIndex){
  if(GF && GF.trackIdx && GF.trackIdx.length){
    const group = discGroupsFor(GF.trackIdx, S.tracks).find(g => g.idx.includes(trackIndex));
    if(group) return group.disc;
  }
  const t = S.tracks[trackIndex];
  return (t && t.tags && t.tags.disc) || 0;
}

// GF4 point 1/3: every sleeve pocket currently in the DOM, pocket 1
// (#gfSleeveDiscWrap, keeping its fixed id for shell/handoff.js's own
// read and every other function below) first, each later disc's own
// cloned pocket after it in the same order gatefoldBuildSleevePockets()
// appended them.
function gatefoldSleevePocketEls(){
  return Array.from(document.querySelectorAll('#gfSleevePockets .gf-sleeve-disc-wrap'));
}

// GF4 point 1/3: one pocket per disc, side by side once an album spans
// more than one -- built fresh on every open rather than kept around
// between them, same as the tracklist/left-panel content just above.
// Only #gfSleeveDiscWrap itself is real markup (miziki.html); every
// later disc's pocket is a clone of it with its id (and every id of its
// own descendants) stripped, found afterward through the shared
// .gf-sleeve-disc-wrap class and its own [data-disc] instead.
// CC5 point 5: exactly two discs (computed or tagged) sit side by side,
// fully visible, no scroll -- .gf-two-disc, toggled on both the pockets
// row (for its own flex layout) and #gfSleeve (so .gf-sleeve-paper, a
// sibling of #gfSleevePockets rather than a descendant, can get its own
// two-cutout mask). Three or more discs use gatefoldRowLayout() below
// instead, rows of 2 straight back, via .gf-row-disc.
// Box-set follow-up to CC5 (docs/34_CARE_AND_CONTROL.md point 5, Ken
// 2026-11-09): #gfSleeve's default CSS height (11-gatefold.css), tall
// enough for one row -- grown below, one GF_SLEEVE_ROW_STEP per extra
// row, so a box set's extra rows of 2 don't clip.
const GF_SLEEVE_BASE_HEIGHT = 252;
const GF_SLEEVE_ROW_STEP = 78; // gatefoldGeometry()'s uniform discDiameter (156) / 2

function gatefoldBuildSleevePockets(discGroups){
  const pockets = $('#gfSleevePockets');
  const gfSleeve = $('#gfSleeve');
  const twoDisc = discGroups.length === 2;
  const rowDisc = discGroups.length > 2;
  pockets.classList.toggle('gf-two-disc', twoDisc);
  pockets.classList.toggle('gf-row-disc', rowDisc);
  gfSleeve.classList.toggle('gf-two-disc', twoDisc);
  gfSleeve.classList.toggle('gf-row-disc', rowDisc);
  const layout = gatefoldRowLayout(discGroups.length);
  const rows = rowDisc ? layout.reduce((max, l) => Math.max(max, l.row), 0) : 0;
  gfSleeve.style.height = rowDisc ? (GF_SLEEVE_BASE_HEIGHT + rows * GF_SLEEVE_ROW_STEP) + 'px' : '';
  pockets.querySelectorAll('.gf-sleeve-disc-wrap-extra').forEach(n => n.remove());
  const first = $('#gfSleeveDiscWrap');
  first.classList.remove('gf-disc-out');
  first.setAttribute('data-disc', String(discGroups[0] ? discGroups[0].disc : 0));
  const applyRow = (wrap, i) => {
    const pos = layout[i];
    wrap.classList.remove('gf-row-left', 'gf-row-right', 'gf-row-center');
    if(!rowDisc || !pos) { wrap.style.removeProperty('--gf-row'); return; }
    wrap.classList.add('gf-row-' + pos.col);
    wrap.style.setProperty('--gf-row', String(pos.row));
  };
  applyRow(first, 0);
  for(let k = 1; k < discGroups.length; k++){
    const clone = first.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    clone.classList.add('gf-sleeve-disc-wrap-extra');
    clone.classList.remove('gf-disc-out', 'gf-disc-empty');
    clone.setAttribute('data-disc', String(discGroups[k].disc));
    applyRow(clone, k);
    pockets.appendChild(clone);
  }
}

const GF_WEAR_STAGES = ['light', 'worn', 'loved'];
function updateGatefoldSleeveState(){
  if(!GF) return;
  const onPlatter = gatefoldOnPlatter(GF.item);
  const playingDisc = onPlatter ? gatefoldDiscOf(S.index) : null;
  gatefoldSleevePocketEls().forEach(wrap => {
    wrap.classList.toggle('gf-disc-empty', onPlatter && Number(wrap.getAttribute('data-disc')) === playingDisc);
  });
  // RW7 (docs/23_RHYTHM_AND_WEAR.md): the gatefold's own sleeve/disc, the
  // same CSS layer the crate card and player sleeve use. GF5 point 4: the
  // back cover carries the same stage too -- the front cover face stays
  // pristine, so #gfCoverArt is never touched here.
  const gfSleeve = $('#gfSleeve'), backCover = $('#gfBackCover .gf-back-cover');
  GF_WEAR_STAGES.forEach(s => { gfSleeve.classList.remove('wear-' + s); if(backCover) backCover.classList.remove('wear-' + s); });
  if(S.showWear !== false){
    const stage = wearStage(S.sessionCounts[GF.item.albumId], S.albumFirstPlayed[GF.item.albumId], Date.now());
    if(stage !== 'new'){ gfSleeve.classList.add('wear-' + stage); if(backCover) backCover.classList.add('wear-' + stage); }
  }
}

// decorative only: the disc peeks out as if pulled from the pocket, then the
// pocket settles into its normal (now-empty, since this album is playing)
// state — never touches S.shellAlbumId, the pull, or the full player (§A6).
// GF4: discNumber picks which disc's own pocket flourishes (the one the
// played track is actually on); omitted, it falls back to the first.
function gatefoldSleeveFlourish(discNumber){
  const pockets = gatefoldSleevePocketEls();
  const wrap = (discNumber != null && pockets.find(w => Number(w.getAttribute('data-disc')) === discNumber)) || pockets[0];
  if(!wrap) return;
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
    gatefoldSleeveFlourish(gatefoldDiscOf(i));
    return;
  }
  const playedDisc = gatefoldDiscOf(i);
  const startWrap = gatefoldSleevePocketEls().find(w => Number(w.getAttribute('data-disc')) === playedDisc) || $('#gfSleeveDiscWrap');
  const startRect = startWrap.getBoundingClientRect();
  setQueue(trackIdx, trackIdx.indexOf(i), false);
  if(REDUCED){
    // no flight — the player opens with the record already seated, then audio.
    // {skipHistory:true}: forceCloseLayer's own history.go() is asynchronous,
    // and the openLayer('player', ...) call right below (inside
    // openPlayerViaSheet, when the player wasn't already open) pushes a new
    // history entry in this same synchronous tick — without skipHistory, the
    // still-pending go() would land on that new entry instead of the one it
    // was meant for, and close the player we just opened (see nav-stack.js's
    // own comment on finishClose() for the full race).
    forceCloseLayer('gatefold', { skipHistory: true });
    if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
    else openPlayerViaSheet(current(), S.pendingShellInfo);
    return;
  }
  runGatefoldHandoff(startRect, current(), S.pendingShellInfo, play);
}

// GF12 (docs/29_GATEFOLD.md) point 3: desktop's wide spread's own "Play
// the record" primary button, under the pocket -- plays the album from
// its first track, through the exact same gatefoldPlayTrack() hand-off
// every track row already uses, rather than a second play path.
export function gatefoldPlayRecord(){
  if(!GF || !GF.trackIdx.length) return;
  gatefoldPlayTrack(GF.trackIdx, GF.trackIdx[0]);
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

// GF1 point 4: "format name, speed, the file's format/bit depth/rate as
// the player's spec line already words it, track count and length." Not
// shared with crate/model.js's catalogLineFor() -- that line is the crate
// catalog card's own uppercase label/catalog-number wording, built from no
// file-level data at all; this one is mixed-case and always includes the
// file's own codec/rate/bit-depth, a different shape the two don't share.
function gatefoldFormatLine(item){
  const format = gatefoldItemFormat(item);
  const t = S.tracks[item.idx[0]];
  const bits = [
    formatRecordName(format) + ' · ' + formatSpeedText(format.speed) + ' RPM',
    t ? fileSpecLine(t.meta) : null,
    item.trackCount + (item.trackCount===1?' track':' tracks'),
    fmt(item.idx.reduce((s,i)=>s+(S.tracks[i].duration||0),0)),
  ].filter(Boolean);
  return bits.join(' · ');
}

// GF11 (docs/29_GATEFOLD.md), generalized by GF12 into an always-present
// "record options" menu, then GF14: Share/Pin moved in for good (daytime
// used to show their own always-on pill buttons instead) -- "a ··· button"
// (#gfMoreBtn, a fixed top-corner control, miziki.html) that forwards to
// the real Share/Pin buttons buildGatefoldLeftPanel() already built (those
// stay in the DOM, just never shown inline any more -- see .gf-left/
// .gf-flat-body in 11-gatefold.css -- so this menu needs no rating/note/
// pin logic of its own, only a paint-and-forward), plus "Track order" and
// "Remove album", every one of them shown every time, day or night.
export function openGatefoldMoreMenu(){
  const btn = $('#gfMoreBtn');
  const shareSrc = document.querySelector('.gf-share-btn');
  const pinSrc = document.querySelector('.gf-pin-btn');
  $('#gfMoreShareBtn').style.display = shareSrc ? '' : 'none';
  if(pinSrc){
    $('#gfMorePinBtn').style.display = '';
    $('#gfMorePinBtn').textContent = pinSrc.textContent;
  } else $('#gfMorePinBtn').style.display = 'none';
  // PRESSING_DRAW (docs/31_PRESSINGS_AND_LOOKS.md, PR B.3.3 point 1):
  // re-checked fresh every time the menu opens -- earning a rare/metal/
  // zoetrope mid-listen makes the row (and its swatch) show with no reload.
  const pressingTrack = GF ? (albumPressingTrack(GF.item.albumId) || S.tracks[GF.item.idx[0]]) : null;
  const lookBtn = $('#gfMoreLookBtn');
  lookBtn.style.display = (pressingTrack && hasLookChoice(pressingTrack)) ? '' : 'none';
  if(pressingTrack){
    const d = discLook(pressingTrack);
    lookBtn.querySelector('.look-row-disc').style.background = d.bg || '';
  }
  const r = btn.getBoundingClientRect(), menu = $('#gfMoreMenu');
  menu.style.top = Math.round(r.bottom + window.scrollY + 8) + 'px';
  menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
  $('#gfMoreMenuScrim').classList.add('open');
  menu.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  openLayer('gf-more-menu', closeGatefoldMoreMenu, { container: [menu, $('#gfMoreMenuScrim')] });
}
export function isGatefoldMoreMenuOpen(){ return $('#gfMoreMenu').classList.contains('open'); }
export function closeGatefoldMoreMenu(){
  $('#gfMoreMenuScrim').classList.remove('open');
  $('#gfMoreMenu').classList.remove('open');
  $('#gfMoreBtn').setAttribute('aria-expanded', 'false');
}
export function gatefoldMoreMenuShare(){
  closeLayer('gf-more-menu');
  const btn = document.querySelector('.gf-share-btn');
  if(btn) btn.click();
}
export function gatefoldMoreMenuPin(){
  closeLayer('gf-more-menu');
  const btn = document.querySelector('.gf-pin-btn');
  if(btn) btn.click();
}
// GS10 (docs/30_GROOVES_AND_SHELF.md point 1): "Keep for…" opens a second,
// static overflow menu (miziki.html's #gfKeepForMenu) off the same button
// the first menu's row closes -- same two-level pattern as the back-cover
// menu's own Choose/Photograph rows opening a hidden file input, just a
// second menu instead of a file picker. Paints which of the five slots
// (or "Not kept") is currently checked each time it opens, since the
// static rows have no other way to reflect S.albumKeptFor.
export function gatefoldMoreMenuKeepFor(){
  closeLayer('gf-more-menu');
  if(!GF) return;
  const kept = S.albumKeptFor[GF.item.album] || null;
  KEPT_FOR_PHASES.forEach(p => $('#gfKeepFor' + keptForBtnSuffix(p) + 'Btn').setAttribute('aria-checked', String(p === kept)));
  $('#gfKeepForNoneBtn').setAttribute('aria-checked', String(!kept));
  const btn = document.querySelector('.gf-more-btn'), menu = $('#gfKeepForMenu');
  if(btn){
    const r = btn.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + window.scrollY + 8) + 'px';
    menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
  }
  $('#gfKeepForMenuScrim').classList.add('open');
  menu.classList.add('open');
  openLayer('gf-keep-for-menu', closeGatefoldKeepForMenu, { container: [menu, $('#gfKeepForMenuScrim')] });
}
export function closeGatefoldKeepForMenu(){
  $('#gfKeepForMenuScrim').classList.remove('open');
  $('#gfKeepForMenu').classList.remove('open');
}
// 'firstLight' -> 'FirstLight', matching the static button ids above
function keptForBtnSuffix(phase){ return phase[0].toUpperCase() + phase.slice(1); }
export function gatefoldKeepForPick(phase){
  closeLayer('gf-keep-for-menu');
  if(!GF) return;
  const album = GF.item.album;
  if(phase) S.albumKeptFor[album] = phase;
  else delete S.albumKeptFor[album];
  persistAlbumKeptFor(album);
}
// GF12 point 2: "Track order" turns the tracklist into the reorder mode
// buildGatefoldTracklist()'s own opts.reorder builds -- seeding
// S.albumOrder/S.albumSort through albumTracks()'s own lazy, id-based
// seeding (library/model.js) rather than re-implementing that here, the
// same bug-prone shortcut library/view.js's retired sortBar() took.
// PRESSING_DRAW (docs/31_PRESSINGS_AND_LOOKS.md, PR B.3.3 point 2): the
// gatefold's own way into the look picker, for this album rather than
// whatever's on the platter. Uses closeLayerThen(), not a bare
// closeLayer()-then-openLayer() two-step -- opening 'look' in the very
// same tick as closing 'gf-more-menu' would push its own history entry
// before 'gf-more-menu's own closing history.go(-1) actually lands
// (finishClose()'s own documented hazard, nav-stack.js), which pops the
// just-opened look sheet shut again moments later instead of the stale
// menu entry (confirmed live: the sheet built its options then closed
// itself within the same tick). closeLayerThen() waits for that real
// navigation to finish first. onPicked crossfades the pocket disc (and
// the platter, if this album happens to be loaded) the moment a choice is
// made, same "applies immediately, no confirmation" rule the picker has
// always followed.
export function gatefoldMoreMenuLook(){
  const item = GF && GF.item;
  closeLayerThen('gf-more-menu', () => {
    if(!item) return;
    const pressingTrack = albumPressingTrack(item.albumId) || S.tracks[item.idx[0]];
    openLookPicker(pressingTrack, { onPicked: () => GF && applyGatefoldDiscVariant(item, true) });
  });
}
export function gatefoldMoreMenuTrackOrder(){
  closeLayer('gf-more-menu');
  if(!GF) return;
  const album = GF.item.album;
  S.albumSort[album] = 'manual';
  albumTracks(album); // seeds S.albumOrder[album] with ids if unset
  touchBackupKey('albumSort', album);
  touchBackupKey('albumOrder', album);
  queueSave();
  GF.reordering = true;
  refreshGatefoldTracklist();
}
export function gatefoldExitReorderMode(){
  if(!GF) return;
  GF.reordering = false;
  refreshGatefoldTracklist();
}
// GF15: "Select" re-homed from the retired renderAlbumDetail() (which
// read the library header's own global S.view.editSelecting/
// S.editSelection) into its own, album-scoped state on GF -- picking a
// track here never touches the library screen's own select mode
// underneath. Edit/Remove hand the picked ids straight to the existing
// batch paths (library/edit.js's openEditSheet(), library/delete.js's
// deleteTracks()) -- the same two things the old select bar's own
// Edit/Remove buttons called.
export function gatefoldMoreMenuSelect(){
  closeLayer('gf-more-menu');
  if(!GF) return;
  GF.selecting = true;
  GF.selection.clear();
  refreshGatefoldTracklist();
}
export function gatefoldExitSelectMode(){
  if(!GF) return;
  GF.selecting = false;
  GF.selection.clear();
  refreshGatefoldTracklist();
}
function gatefoldToggleTrackSelect(id){
  if(!GF) return;
  if(GF.selection.has(id)) GF.selection.delete(id); else GF.selection.add(id);
  refreshGatefoldTracklist();
}
// GF16: Select all/Select none, the same toggle-the-whole-list shape
// library/view.js's own selectAllVisible() already uses -- a second tap
// undoes the first. Scoped to this album's own trackIdx (every track the
// select bar is currently showing), not the library's visible tracks.
function gatefoldToggleSelectAll(trackIdx){
  if(!GF || !trackIdx.length) return;
  const allPicked = trackIdx.every(i => GF.selection.has(S.tracks[i].id));
  if(allPicked) trackIdx.forEach(i => GF.selection.delete(S.tracks[i].id));
  else trackIdx.forEach(i => GF.selection.add(S.tracks[i].id));
  refreshGatefoldTracklist();
}
export function gatefoldSelectEdit(){
  if(!GF) return;
  const ids = Array.from(GF.selection);
  if(!ids.length) return;
  gatefoldExitSelectMode();
  openEditSheet(ids);
}
export function gatefoldSelectDelete(){
  if(!GF) return;
  const ids = Array.from(GF.selection);
  if(!ids.length) return;
  const album = GF.item.album;
  openConfirmDelete('batch', ids.length, null, async () => {
    await deleteTracks(ids);
    if(countForAlbum(album) === 0){ forceCloseLayer('gatefold'); renderTracks(); return; }
    gatefoldExitSelectMode();
  });
}
// GF12 point 4: "Remove Album" re-homed here now that the Albums-tab/
// artist album-detail screens it used to live on (library/view.js) no
// longer exist -- same openConfirmDelete()/countForAlbum()/deleteAlbum()
// calls that crumb button made.
export function gatefoldMoreMenuRemoveAlbum(){
  closeLayer('gf-more-menu');
  if(!GF) return;
  const album = GF.item.album;
  openConfirmDelete('album', countForAlbum(album), album, async () => {
    deleteAlbum(album);
    forceCloseLayer('gatefold');
    renderTracks();
  });
}

// GF12 point 2: rebuilds the tracklist in place -- #gfTracklist always,
// plus #gfFlatBody when the short layout's flat tab is the tracklist
// (not the left panel) -- after a reorder move or a Track order/Done
// toggle. GF.trackIdx is re-read from gatefoldTrackIndices() since a
// manual move (or entering manual mode fresh) changes the order itself.
// GF15: also re-read after a select-mode pick or a batch delete, so a
// shrunk album (or a picked/unpicked row) repaints from the real list.
function refreshGatefoldTracklist(){
  if(!GF) return;
  GF.trackIdx = gatefoldTrackIndices(GF.item);
  const opts = { reorder: GF.reordering, select: GF.selecting };
  $('#gfTracklist').innerHTML = '';
  $('#gfTracklist').appendChild(buildGatefoldTracklist(GF.item, GF.trackIdx, undefined, opts));
  if(GF.mode === 'short' && GF.panel === 'right'){
    $('#gfFlatBody').innerHTML = '';
    $('#gfFlatBody').appendChild(buildGatefoldTracklist(GF.item, GF.trackIdx, undefined, opts));
  }
}

function gatefoldInfoAndSleeveHTML(item){
  const info = $('#gfInfo'); info.innerHTML = '';
  const night = !!(GF && GF.night);
  // GF14: "record options" (Share, Pin, Keep for…, Track order, Remove
  // album) is now a fixed top-corner button (#gfMoreBtn, miziki.html),
  // wired once in src/wiring/gatefold.js -- not rebuilt into this title
  // row every open the way it used to be.
  info.appendChild(el('h3','gf-info-title', item.album));
  info.appendChild(el('p','gf-info-sub', item.artist + (item.year ? ' · ' + item.year : '')));
  // GF11 point 1: "hides ... the format line and the wear line" after
  // sunset -- "fewer lines under the panel: just the record" (the design
  // mock's own wording). GF.night is computed once when the gatefold
  // opens (point 2), not read live here, so it can't change out from
  // under someone already looking at it.
  if(night) return;
  // QC4 (docs/24_QUIET_COUNTS.md): "Worn · since Month YYYY" / "Well loved ·
  // since Month YYYY" under the artist line -- no play count, and nothing
  // at all for new/light (wearCopy returns null for those stages). GF1
  // point 7: the phase this record has been played in most, from
  // S.albumPhaseCounts, once it has at least five counted plays.
  if(S.showWear !== false){
    const stage = wearStage(S.sessionCounts[item.albumId], S.albumFirstPlayed[item.albumId], Date.now());
    const phraseWord = wearPhaseWord(S.albumPhaseCounts[item.albumId]);
    const copy = wearCopy(stage, S.albumFirstPlayed[item.albumId], phraseWord);
    if(copy) info.appendChild(el('p','gf-info-wear', copy));
  }
  info.appendChild(el('p','gf-info-meta', gatefoldFormatLine(item)));
}

// The gatefold's own disc, pulled from the sleeve pocket, shows the same
// pressing (color/pattern/rare/metal) the platter will once the record
// rises into the full player — see record-art/looks.js's discLook() for
// the shared precedence. Resolved off the album's own pressing, not
// whichever side happens to be loaded — see albumPressingTrack()'s own
// comment (record-art/tiers.js), same as discLook()'s other callers.
// GF4 point 1: "the same pressing for every disc of one album" -- every
// pocket (gatefoldSleevePocketEls()) gets the identical look, not just
// the first disc's own.
// `crossfade` (PRESSING_DRAW, PR B.3.3 point 3): true only when a look is
// actually being switched by the user (gatefoldMoreMenuLook()'s onPicked,
// above) -- every other caller (initial open, cover-art resolving) wants
// the instant paint it's always had, since there's nothing yet for a
// crossfade to cover. A plain opacity fade on each pocket's own disc, not
// setDiscBackground()'s #discFade (that element is the platter's alone,
// and a multi-disc album has more than one pocket to fade at once).
function applyGatefoldDiscVariant(item, crossfade){
  const t = albumPressingTrack(item.albumId) || S.tracks[item.idx[0]];
  const d = t ? discLook(t) : null;
  gatefoldSleevePocketEls().forEach(wrap => {
    const disc = wrap.querySelector('.disc'), label = wrap.querySelector('.label');
    if(!disc || !label) return;
    const paint = () => {
      if(!d){
        disc.classList.remove('rare');
        label.classList.remove('rare', 'paper-label', 'metal-invert', 'metal-silver');
        disc.style.background = '';
        return;
      }
      paintDiscLook(disc, label, d);
      disc.style.background = d.bg || '';
    };
    const bg = d ? (d.bg || '') : '';
    if(crossfade && !REDUCED && disc.style.background && disc.style.background !== bg){
      disc.style.transition = 'opacity .18s ease';
      disc.style.opacity = '0';
      setTimeout(() => { paint(); disc.style.opacity = '1'; }, 180);
    } else {
      disc.style.transition = '';
      paint();
    }
  });
}

// GF3 point 3: "when the disc is out ... draw its run-out etching from
// etchingFor(releaseId, side) along the dead-wax ring, in var(--data) at
// the 11px physical-detail size." The pocket disc isn't committed to one
// playing side the way the platter is (applyDeadWaxEtching's own caller,
// player/transport.js's load(), reads whichever side is actually loaded)
// -- it's the sleeve's generic look at the record, so side 'A' always,
// same "every copy of an album shows the same etching" determinism
// etchingFor() already gives. Shown only via CSS, keyed off
// .gf-sleeve-disc-wrap.gf-disc-out -- this just needs the text in place
// once per open, not re-applied on every flourish.
// GF4: every pocket shows the same etching (same pressing, same record) --
// one lookup, copied into each pocket's own text spans.
function gatefoldApplyPocketDeadWax(item){
  const t = albumPressingTrack(item.albumId) || S.tracks[item.idx[0]];
  const text = t ? etchingFor(albumKey(t), 'A') : { matrix: '', message: '' };
  gatefoldSleevePocketEls().forEach(wrap => {
    const matrixEl = wrap.querySelector('.gf-deadwax-matrix'), messageEl = wrap.querySelector('.gf-deadwax-message');
    if(matrixEl) matrixEl.textContent = text.matrix;
    if(messageEl) messageEl.textContent = text.message;
  });
}

async function gatefoldSetCoverArt(item){
  const img = $('#gfCoverArt');
  const fallback = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art) || '';
  const setDiscArt = src => gatefoldSleevePocketEls().forEach(wrap => {
    const discArt = wrap.querySelector('.art');
    if(discArt) discArt.src = src;
  });
  if(fallback){ img.src = fallback; setDiscArt(fallback); }
  applyGatefoldDiscVariant(item);
  const url = await getCrateArtURL(item.albumId, 'L');
  if(url && GF && GF.item === item){ img.src = url; setDiscArt(url); }
}

// GF5 point 2 / GF6: the back cover, built fresh per open off the album's
// own data (trackIdx/format) -- or, once the user's set one, their own
// stored photo instead (GF6 point 4: "a user back image replaces the
// default everywhere the back shows"). Async (the artwork-store read),
// same "fire from openGatefold(), re-check GF is still this open" guard
// gatefoldSetCoverArt() already uses, since the gatefold can close (or
// reopen on a different album) while this is still in flight.
async function gatefoldSetBackCover(item, trackIdx, format){
  const host = $('#gfBackCover');
  if(!host) return;
  const blob = await getAlbumBackCoverBlob(item.albumId).catch(() => null);
  if(!GF || GF.item !== item) return;
  host.innerHTML = '';
  host.appendChild(blob ? buildBackCoverImageEl(blob, item) : buildBackCoverEl(item, trackIdx, format));
  updateBackCoverMenuState(!!blob);
}
// GF6: re-draws the currently-open gatefold's back cover -- called after
// the "···" menu/edit-sheet row actually changes the stored image, so the
// turned-over face updates in place without a full re-open.
export function refreshGatefoldBackCover(){
  if(!GF) return;
  gatefoldSetBackCover(GF.item, GF.trackIdx, gatefoldItemFormat(GF.item)).catch(() => {});
}
// GF6: which album the open gatefold's back-cover menu/edit-sheet row acts
// on -- null when no gatefold is open, so wiring/gatefold.js's handlers can
// no-op cleanly instead of guessing.
export function currentGatefoldAlbumId(){
  return GF ? GF.item.albumId : null;
}

// GF7 (docs/29_GATEFOLD.md): the liner-notes editing sheet. `item` comes
// straight from whichever buildLinerNotesHeading() Edit button was
// tapped (the gatefold, its short-mode flat body, or a picture sleeve --
// buildGatefoldLeftPanel() is shared by all three), not from GF, so this
// works from any of them, not just the gatefold proper.
let linerEditItem = null;
export function openLinerEditSheet(item){
  linerEditItem = item;
  $('#linerEditArtist').textContent = item.artist;
  $('#linerEditAlbum').textContent = item.album;
  $('#linerEditText').value = albumLinerNotes(item.album);
  const source = albumLinerNotesSource(item.album);
  const box = $('#linerEditSourceBox');
  if(source){
    box.style.display = '';
    $('#linerEditSourceText').textContent = source.text;
    $('#linerEditSourceFile').textContent = 'COMMENT · ' + source.fileName;
  } else {
    box.style.display = 'none';
  }
  $('#linerEditRevert').style.display = albumLinerNoteIsOverride(item.album) ? '' : 'none';
  const overlay = $('#linerEditOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  openLayer('liner-edit', closeLinerEditSheet, { container: overlay });
}
export function closeLinerEditSheet(){
  $('#linerEditOverlay').classList.remove('open');
  $('#linerEditOverlay').setAttribute('aria-hidden', 'true');
  linerEditItem = null;
}
// re-draws whichever host currently shows the panel (#gfLeft, the short-
// mode flat body, or a picture sleeve) by replacing its .gf-left-panel
// wrapper wholesale -- a DOM swap, not a rebuild of the host itself,
// since #pictureSleeveBody has its own play-row sibling to leave alone.
// Also used by gatefold/booklet.js's openAddBookletPagesPicker() after a
// page is added, same "rebuild-and-swap" refresh liner notes already use.
export function refreshLinerPanel(item){
  const panelEl = document.querySelector('.gf-left-panel');
  if(panelEl) panelEl.replaceWith(buildGatefoldLeftPanel(item));
}
export function saveLinerEditSheet(){
  if(!linerEditItem) return;
  const item = linerEditItem;
  setAlbumLinerNoteOverride(item.album, $('#linerEditText').value);
  refreshLinerPanel(item);
  closeLayer('liner-edit');
}
export function revertLinerEditSheet(){
  if(!linerEditItem) return;
  const item = linerEditItem;
  clearAlbumLinerNoteOverride(item.album);
  refreshLinerPanel(item);
  closeLayer('liner-edit');
}
function updateBackCoverMenuState(usingCustomImage){
  const btn = $('#gfBackCoverDefaultBtn');
  if(btn) btn.setAttribute('aria-checked', String(!usingCustomImage));
}

// GF5 point 1: "a horizontal swipe on the closed sleeve... turns it over
// with a short Y-axis flip; two dots under the sleeve show Front/Back."
// turnedOver lives on GF (reset on every open) since it's purely this
// open's own transient view state, same lifetime as GF.panel.
function gatefoldSetTurnedOver(on){
  if(!GF) return;
  GF.turnedOver = !!on;
  $('#gatefold').classList.toggle('gf-turned-over', GF.turnedOver);
  document.querySelectorAll('#gfFlipDots span').forEach((dot, i) =>
    dot.classList.toggle('active', (i === 1) === GF.turnedOver));
  const btn = $('#gfTurnOver');
  if(btn) btn.setAttribute('aria-pressed', String(GF.turnedOver));
}

export function gatefoldToggleTurnedOver(){
  if(GF) gatefoldSetTurnedOver(!GF.turnedOver);
}

export function gatefoldSwitchPanel(panel){
  if(!GF) return;
  GF.panel = panel;
  const overlay = $('#gatefold');
  overlay.classList.toggle('gf-panel-left', panel === 'left');
  overlay.classList.toggle('gf-panel-right', panel === 'right');
  overlay.classList.remove('gf-panel-dragging');
  const camera = $('#gfCamera');
  if(GF.mode !== 'wide'){
    camera.style.transition = 'transform ' + GATEFOLD_ANIM.leftPanelMs + 'ms ease';
    camera.style.setProperty('--gf-cx', (panel === 'left' ? -GF.geom.panDistance : GF.geom.panDistance) + 'px');
  }
  document.querySelectorAll('#gfPanelToggle [data-panel], #gfFlatSeg [data-panel]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.panel === panel)));
  if(GF.mode === 'short'){
    $('#gfFlatBody').innerHTML = '';
    if(panel === 'left') $('#gfFlatBody').appendChild(buildGatefoldLeftPanel(GF.item));
    else $('#gfFlatBody').appendChild(buildGatefoldTracklist(GF.item, GF.trackIdx));
  } else {
    // GF13 fix 2: preventScroll -- #gfLeft/#gfTracklist sit inside
    // #gfCamera's live 3D perspective transform (translate+scale, this
    // function's own --gf-cx write above), so a plain .focus() has the
    // browser try to scroll the focused element into view using its
    // static (pre-transform) layout box, which it judges off-screen --
    // that permanently sets #gatefold's own scrollLeft (it's
    // overflow:hidden, not overflow:visible, so it's still a real
    // scroll container) and visibly shifts every sibling positioned off
    // #gatefold itself (#gfSleeve, #gfBack, ...), not just the camera's
    // own contents. This was Ken's "the paper sleeve still shifts
    // position" report: the camera pan itself was never the bug.
    (panel === 'left' ? $('#gfLeft') : $('#gfTracklist')).focus({ preventScroll: true });
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
      $('#gatefold').classList.add('gf-panel-dragging');
      const base = GF.panel === 'left' ? -GF.geom.panDistance : GF.geom.panDistance;
      const next = clamp(base + dx * 0.5, -GF.geom.panDistance, GF.geom.panDistance);
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

  // GF2 point 1: drag the info strip down and the whole overlay follows the
  // finger live (translateY + a matching opacity fade), with pointer
  // capture so a fast drag that leaves #gfInfo's own bounds still delivers
  // its move/up events here. Release past GF_CLOSE_DRAG_DISTANCE *or*
  // GF_CLOSE_DRAG_VELOCITY (a flick, even a short one) commits: the drag
  // transform clears and closeLayer('gatefold') takes over with its own
  // close animation (the swing/fade §A3 already plays). Short of either
  // threshold, it springs back to rest with a plain transition instead.
  // REDUCED skips the live follow (no transform writes while dragging) but
  // still decides commit-vs-spring-back on release from the same distance/
  // velocity the finger actually moved, so it isn't just the old flat
  // "any downward motion closes" check.
  let infoDrag = null;
  const onInfoDown = e => {
    infoDrag = { startY: e.clientY, lastY: e.clientY, lastT: performance.now(), dy: 0, v: 0 };
    info.setPointerCapture?.(e.pointerId);
  };
  const resetInfoDragTransform = () => {
    const overlay = $('#gatefold');
    overlay.style.transition = 'transform 200ms ease, opacity 200ms ease';
    overlay.style.transform = '';
    overlay.style.opacity = '';
  };
  const onInfoMove = e => {
    if(!infoDrag) return;
    const dy = Math.max(0, e.clientY - infoDrag.startY);
    const now = performance.now();
    const dt = now - infoDrag.lastT;
    if(dt > 0) infoDrag.v = (e.clientY - infoDrag.lastY) / dt;
    infoDrag.lastY = e.clientY; infoDrag.lastT = now; infoDrag.dy = dy;
    if(REDUCED || !dy) return;
    const overlay = $('#gatefold');
    overlay.style.transition = 'none';
    overlay.style.transform = 'translateY(' + dy + 'px)';
    overlay.style.opacity = String(Math.max(0.4, 1 - dy / 500));
  };
  const onInfoUp = e => {
    if(!infoDrag) return;
    const { dy, v } = infoDrag;
    infoDrag = null;
    info.releasePointerCapture?.(e.pointerId);
    if(dy > 0 && (dy > GF_CLOSE_DRAG_DISTANCE || v > GF_CLOSE_DRAG_VELOCITY)){
      $('#gatefold').style.transform = ''; $('#gatefold').style.opacity = '';
      closeLayer('gatefold');
    } else if(dy > 0){
      resetInfoDragTransform();
    }
  };
  const info = $('#gfInfo');
  info.addEventListener('pointerdown', onInfoDown);
  info.addEventListener('pointermove', onInfoMove);
  info.addEventListener('pointerup', onInfoUp);
  info.addEventListener('pointercancel', onInfoUp);

  // GF13 point 3: the back-cover flip is reachable only via the
  // "Flip cover" button (#gfTurnOver, wired in src/wiring/gatefold.js) --
  // a swipe here used to also trigger it, which collided with the
  // tracklist/inside-left panel swipe wired on #gfStage/#gfFlatBody
  // above. #gfCover sits inside #gfStage, so any drag starting there is
  // already handled (and correctly ignored while on the cover) by that
  // gesture; no separate listener is wired here anymore.

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
    info.removeEventListener('pointercancel', onInfoUp);
    const overlay = $('#gatefold');
    overlay.style.transform = ''; overlay.style.transition = ''; overlay.style.opacity = '';
  };
}

function gatefoldSettledState(mode){
  const camera = $('#gfCamera'), cover = $('#gfCover');
  camera.style.transition = 'none';
  camera.style.setProperty('--gf-s', mode === 'wide' ? '1' : '.55');
  camera.style.setProperty('--gf-cx', mode === 'wide' ? GF.geom.panDistance + 'px' : '0px');
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
  requestAnimationFrame(() => { $('#gfTracklist').focus({ preventScroll: true }); });
}

async function runGatefoldOpen(mode){
  const overlay = $('#gatefold'), camera = $('#gfCamera'), cover = $('#gfCover');
  const seq = GF.seq;
  // GF9 fix: no stopPropagation -- this only jumps the opening animation to
  // its settled state; the same tap must still reach the track row under it
  // so a long-press started during the opening swing still arms its timer
  // instead of silently eating that first touch.
  const skip = () => { gatefoldSkipToSettled(mode); };
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
    camera.style.setProperty('--gf-cx', GF.geom.panDistance + 'px');
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
      camera.style.setProperty('--gf-s', '1'); camera.style.setProperty('--gf-cx', GF.geom.panDistance + 'px');
    }
    overlay.classList.add('gf-chrome-in');
    await sleep(GATEFOLD_ANIM.pushMs);
    if(!GF || GF.seq !== seq) return;
  }
  overlay.removeEventListener('pointerdown', skip, {capture:true});
  gfSkipHandler = null;
  overlay.classList.add('gf-chrome-in');
  $('#gfTracklist').focus({ preventScroll: true });
}

let gfSeqCounter = 0;

export function openGatefold(item, opts){
  if(GF) return;
  const mode = gatefoldViewportMode();
  const trackIdx = gatefoldTrackIndices(item);
  if(!trackIdx.length) return;
  // GF3 point 1: the record's own format (12"/10"/7", through the
  // personal Auto/33/45 override, same as gatefoldFormatLine()/
  // gatherRecordShareData()) drives this open's own geometry -- panel/
  // pan/pocket/disc sizes, pushed as CSS vars below -- and the pocket
  // disc's own [data-size] label-inset scaling (point 2), the same
  // [data-size]-keyed convention SZ1 already uses for the platter.
  // isSingleRecord() routing to the picture sleeve instead of here is
  // unchanged, upstream in crate/view.js's openCrateAlbum().
  const format = gatefoldItemFormat(item);
  const geom = gatefoldGeometry(format);
  // GF4 point 1/3: the discs this album actually spans -- one sleeve
  // pocket each, built fresh below (gatefoldBuildSleevePockets()).
  // Stored on GF since several later functions (flourish, the empty-
  // pocket toggle, the handoff start rect) need it for as long as this
  // open lasts, the same lifetime GF.geom already has.
  const discGroups = discGroupsFor(trackIdx, S.tracks);
  // GF11 point 2: "changes apply when the gatefold opens; an open
  // gatefold doesn't change under the user mid-look" -- read once here,
  // off the real wall-clock sky (currentDayPosition() folds in only the
  // Sundown preview slider, never Pure/Vinyl or the playback rate --
  // point 2's own "this is about time of day, not playback speed").
  const night = isAfterSunset(currentDayPosition().phase);
  GF = {item, trackIdx, panel:'right', seq: ++gfSeqCounter, mode, returnFocus: document.activeElement, geom, discGroups, turnedOver: false, night, reordering: false, selecting: false, selection: new Set()};
  pushGatefoldGeometryVars(geom);

  const overlay = $('#gatefold');
  overlay.setAttribute('aria-label', item.album);
  overlay.classList.toggle('gf-wide', mode === 'wide');
  overlay.classList.toggle('gf-night', night);
  overlay.classList.remove('gf-chrome-in');
  overlay.classList.add('gf-panel-right');
  overlay.classList.remove('gf-panel-left', 'gf-panel-dragging');
  overlay.style.opacity = '';

  gatefoldBuildSleevePockets(discGroups);
  const sizeAttr = platterSizeAttr(format);
  gatefoldSleevePocketEls().forEach(wrap => wrap.setAttribute('data-size', sizeAttr));
  gatefoldApplyPocketDeadWax(item);

  $('#gfTracklist').innerHTML = ''; $('#gfTracklist').appendChild(buildGatefoldTracklist(item, trackIdx));
  $('#gfLeft').innerHTML = ''; $('#gfLeft').appendChild(buildGatefoldLeftPanel(item));
  gatefoldInfoAndSleeveHTML(item);
  gatefoldSetCoverArt(item).catch(() => {});
  gatefoldSetBackCover(item, trackIdx, format).catch(() => {});
  gatefoldSetTurnedOver(false);
  updateGatefoldSleeveState();
  // docs/13_CRATE.md's pull gesture: "the record slides out of the sleeve
  // ... then the gatefold opens with the disc already out" — a committed
  // crate pull (src/crate/view.js's commitPull()) passes {discAlreadyOut:true}
  // so the gatefold's own sleeve-disc icon continues straight from the
  // pull's own reveal instead of starting at rest, reusing the exact same
  // out-then-settle flourish a track play from inside the gatefold already
  // has (§A6).
  if(opts && opts.discAlreadyOut) gatefoldSleeveFlourish();

  if(mode === 'short'){
    $('#gfFlatTracks').classList.add('show');
    $('#gfFlatBody').innerHTML = ''; $('#gfFlatBody').appendChild(buildGatefoldTracklist(item, trackIdx));
    document.querySelectorAll('#gfFlatSeg [data-panel]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.panel === 'right')));
  } else {
    $('#gfFlatTracks').classList.remove('show');
  }
  // GF1 point 2: the inside-left cue always shows now (no liner-notes/
  // credits gate) -- it opens Your copy (rating, sleeve note, pin, share),
  // which every record has, not just one with notes in its files.

  updateGatefoldScale();
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  gatefoldWireGestures();
  runGatefoldOpen(mode);
  openLayer('gatefold', closeGatefold, { instantClose: closeGatefoldInstant, container: overlay });
}

export async function closeGatefold(){
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
  overlay.classList.remove('open','gf-wide','gf-night');
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
  overlay.classList.remove('open','gf-wide','gf-chrome-in','gf-night');
  $('#gfFlatTracks').classList.remove('show');
  overlay.style.opacity = ''; overlay.style.transition = '';
  overlay.setAttribute('aria-hidden','true');
}
