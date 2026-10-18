/* ================= S3: gatefold album view (opens from the crate) =========
   Three flat planes in one 3D stage (the cover, its own backface-hidden
   back face as the inside-left panel, and the tracklist sitting behind it
   at the same spot) — see GATEFOLD spec §A2. Entry point is the crate only;
   every other album entry point keeps renderAlbumDetail() untouched.

   Moved out of main.js (step 7e) — this header had sat above the gatefold,
   the sealed-record sheet, the crate-shelf rendering (moved to
   src/crate/view.js in step 7c) and renderTracks() (moved to
   src/library/view.js in step 7d) all at once, purely by physical accident
   (flagged by the step 7 prompt itself). Only the gatefold itself lives
   here now — the sealed-record sheet, which shares buildGatefoldTracklist/
   gatefoldTrackIndices with it, moved into the sibling module
   src/gatefold/sealed-sheet.js. */
import { S, current } from '../state.js';
import { $, el } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { clamp } from '../util/math.js';
import { REDUCED } from '../util/motion.js';
import { albumKey } from '../record-art/tiers.js';
import { albumTracks } from '../library/model.js';
import { albumLinerNotes, albumCreditRoll, openPersonOrArtist } from '../library/credits.js';
import { thumbURL } from '../library/thumbs.js';
import { getCrateArtURL } from '../crate/tiers.js';
import { fmt } from '../player/clock.js';
import { setQueue } from '../player/queue.js';
import { play } from '../player/transport.js';
import { runStartSequence } from '../shell/start-sequence.js';
import { openPlayerViaSheet } from '../shell/player-overlay.js';
import { runGatefoldHandoff } from '../shell/handoff.js';
import { splitSides } from '../shell/ceremony-timing.js';
import { openLayer, closeLayer, forceCloseLayer } from '../shell/nav-stack.js';

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
  const s = GF.mode === 'wide' ? 1 : Math.min(window.innerWidth / 390, window.innerHeight / 740);
  document.documentElement.style.setProperty('--gf-page-scale', s);
}

// same ordering as renderAlbumDetail()/albumTracks() (spec §A4)
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
export function buildGatefoldTracklist(item, trackIdx, playHandler){
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
  b.addEventListener('click', () => { forceCloseLayer('gatefold'); openPersonOrArtist(name); });
  return b;
}

// Rating stars, sleeve note and pin toggle for YOUR OWN copy of this record
// — local-first (MizikiSocial.setRating/setNote/pin work with no server
// configured at all), published by the sync engine once signed in. Lives at
// the end of the gatefold's "Inside" panel — today's closest thing to an
// album detail view — so it's reachable from both the normal left panel and
// the short-viewport flat "Inside" tab, which both call this same builder.
// Exported (design-layout polish pass, docs/DESKTOP_LAYOUT.md's own Library
// mockup) so the desktop crate's inline detail panel (src/crate/view.js)
// can reuse the exact same rating/sleeve-note/pin controls instead of a
// second implementation — the mockup's own "RATING" dots and "SLEEVE NOTE"
// field are this, not a new feature. src/styles/11-gatefold.css's
// .gf-left-scoped rules were widened to also match .crate-detail-panel so
// this renders with the same styling in its new home.
export function gatefoldSocialControlsHTML(item){
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

export function gatefoldSwitchPanel(panel){
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
    if(dy > 50) closeLayer('gatefold');
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
