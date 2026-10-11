"use strict";
import { S, current, SOCIAL_SUPABASE_URL, SOCIAL_SUPABASE_ANON_KEY } from './state.js';
import { $, el } from './util/dom.js';
import { sleep } from './util/async.js';
import { normKey } from './util/text.js';
import { trackTier, albumKey, trackIdentityKey } from './record-art/tiers.js';
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
import { CRATE_ORIGIN_Y, CRATE_PALETTE, CRATE_VISIBLE_A, CRATE_DPR, CRATE_ALPHABET } from './crate/constants.js';
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
import { wireSpinToScrub } from './player/scrub.js';
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
import { isLibraryRouteVisible, showRoute } from './shell/routes.js';
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

/* ================= launch intro: crate riffle to a title screen =================
   Cold start only — see runLaunchSequence(). Fully independent of the
   sleeve pull/put-away: its own token (S.launchSeq), its own overlay,
   removed from the DOM once it finishes or is skipped. Never delays the
   app — restoreLibrary() runs underneath it from the first paint. */
// resolved by restoreLibrary() once S.tracks/sessions/thumbnails are in
// place — the launch intro races this against a timeout rather than ever
// blocking on it (see runLaunchSequence, "Never delay the app")
let libraryReadyResolve;
const libraryReadyPromise = new Promise(res => { libraryReadyResolve = res; });

const LAUNCH_ANIM = {
  fadeMs: 250, accelMs: 650, cruiseMs: 800, decelMs: 800,
  catchMs: 300, pullMs: 600, titleHoldMs: 300, crossfadeMs: 600,
  skipMs: 150, readyWaitMs: 700,
  // a 2-7 album library gets a shorter "riffle" instead of the full flick
  // (about 1.35s of scroll vs 2.25s), so the whole sequence comes in around
  // 3.4s rather than 4.3s — see LAUNCH spec §1/§3
  riffleAccelMs: 300, riffleCruiseMs: 650, riffleDecelMs: 400,
  // settling the pulled title sleeve into the crate view's centre slot —
  // the crate (or the list, if that's the saved layout) is already correct
  // underneath by the time this runs, so this is just how long the handoff
  // fade takes, not anything it has to build (LAUNCH spec §3, 3700-4300ms)
  intoCrateMs: 600,
  firstRunCount: 44, stackMax: 50,
  // distance share of the scroll each phase covers, by construction summing
  // to 1 so position lands exactly on the target at the end of decel — see
  // computeFlickPosition(). Proportions come from the reference timeline
  // (about 15:21:4 records for a 40-record flick).
  accelShare: 0.375, cruiseShare: 0.525, decelShare: 0.10,
  edgePalette: ['#B8452F','#6E8F5C','#4C5FA0','#C9A24A','#8E5C8F','#3F8C8A','#A8A29A']
};
document.documentElement.style.setProperty('--launch-fade-duration', LAUNCH_ANIM.fadeMs + 'ms');
document.documentElement.style.setProperty('--launch-pull-duration', LAUNCH_ANIM.pullMs + 'ms');
document.documentElement.style.setProperty('--launch-title-duration', LAUNCH_ANIM.titleHoldMs + 'ms');
document.documentElement.style.setProperty('--launch-wordmark-duration', (LAUNCH_ANIM.catchMs + LAUNCH_ANIM.pullMs) + 'ms');
document.documentElement.style.setProperty('--launch-skip-duration', LAUNCH_ANIM.skipMs + 'ms');

// the 390x740 design stage scales uniformly to fit the viewport rather than
// being redrawn per size — CSS alone can't turn a viewport length into a
// unitless scale() factor, so this is computed and written as a variable
function updateLaunchScale(){
  const s = Math.min(window.innerWidth / 390, window.innerHeight / 740);
  document.documentElement.style.setProperty('--launch-scale', s);
}

// the key in S.albumLastPlayed with the largest timestamp; a library that
// has never been played falls back to the most recently added album
function resolveLastPlayedAlbum(){
  const played = Object.keys(S.albumLastPlayed).filter(id => S.tracks.some(t => albumKey(t) === id));
  if(played.length) return played.reduce((best,id) => S.albumLastPlayed[id] > S.albumLastPlayed[best] ? id : best, played[0]);
  const addedByAlbum = {};
  S.tracks.forEach(t => { const id = albumKey(t); const a = t.addedAt || 0; if(!(id in addedByAlbum) || a > addedByAlbum[id]) addedByAlbum[id] = a; });
  const addedIds = Object.keys(addedByAlbum);
  if(!addedIds.length) return null;
  return addedIds.reduce((best,id) => addedByAlbum[id] > addedByAlbum[best] ? id : best, addedIds[0]);
}

// within that album, the track key with the largest S.trackLastPlayed value;
// falls back to the album's first track (by the same order the Albums tab uses)
function resolveLastPlayedTrackIndex(albumId){
  const sample = S.tracks.find(t => albumKey(t) === albumId);
  if(!sample) return -1;
  const idx = albumTracks(sample.tags.album);
  if(!idx.length) return -1;
  let best = idx[0], bestTime = -1;
  idx.forEach(i => {
    const last = S.trackLastPlayed[trackIdentityKey(S.tracks[i])] || 0;
    if(last > bestTime){ bestTime = last; best = i; }
  });
  return best;
}

// Evenly samples down to `cap` entries, always keeping mustIncludeId among
// them (see LAUNCH spec §1, flick-length rule, A > 50 case).
function sampleStackAlbums(allIds, cap, mustIncludeId){
  const picked = [];
  const step = allIds.length / cap;
  for(let i=0;i<cap;i++) picked.push(allIds[Math.floor(i*step)]);
  if(mustIncludeId && !picked.includes(mustIncludeId)) picked[Math.floor(picked.length/2)] = mustIncludeId;
  return picked;
}

function shuffledCopy(arr){
  const out = arr.slice();
  for(let i = out.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

// Resolves which variant to show and everything it needs, without touching
// any DOM — kept separate from rendering so it's independently testable.
// Flick-length rule: N = min(A, 50), no repeats and no padding — a small
// library just flicks through exactly its own albums. A > 50 samples 50
// evenly, always keeping the last-played one. The whole stack is shuffled
// (it should feel like digging, not a sorted list) and the last-played
// album always ends up at about index N-4, the record that gets caught
// (see LAUNCH spec §1).
function buildLaunchStack(){
  const firstRun = {variant:'first-run', count: LAUNCH_ANIM.firstRunCount, targetIndex: LAUNCH_ANIM.firstRunCount - 4};
  if(!S.tracks.length) return firstRun;
  const targetAlbumId = resolveLastPlayedAlbum();
  if(!targetAlbumId) return firstRun;
  const allAlbumIds = groupBy('album').map(([,idx]) => albumKey(S.tracks[idx[0]]));
  const A = allAlbumIds.length;
  const N = Math.min(A, LAUNCH_ANIM.stackMax);
  const picked = A > LAUNCH_ANIM.stackMax ? sampleStackAlbums(allAlbumIds, N, targetAlbumId) : allAlbumIds.slice();
  const albumIds = shuffledCopy(picked);
  const targetIndex = Math.max(0, N - 4);
  const curPos = albumIds.indexOf(targetAlbumId);
  if(curPos >= 0 && curPos !== targetIndex){
    const tmp = albumIds[targetIndex]; albumIds[targetIndex] = albumIds[curPos]; albumIds[curPos] = tmp;
  } else if(curPos < 0){
    albumIds[targetIndex] = targetAlbumId;   // the caught record is always the real last-played album
  }
  const sampleTrack = S.tracks.find(t => albumKey(t) === targetAlbumId);
  return {
    variant:'library', albumIds, targetIndex, targetAlbumId, count: N,
    targetArt: thumbURL['album:' + targetAlbumId] || null,
    targetTitle: sampleTrack ? sampleTrack.tags.album : '',
    targetArtist: sampleTrack ? (sampleTrack.tags.albumArtist || sampleTrack.tags.artist) : ''
  };
}

// one scalar drives the whole flick: ease-in over accelMs, linear cruise,
// ease-out over decelMs, landing exactly on `target` (see LAUNCH spec §3).
// `timing` is {accelMs,cruiseMs,decelMs} — the standard flick for 8+ albums
// (and the first-run variant) or the shorter riffle for a 2-7 album library.
function computeFlickPosition(elapsedMs, target, timing){
  const { accelMs, cruiseMs, decelMs } = timing;
  const { accelShare, cruiseShare } = LAUNCH_ANIM;
  const accelDist = target * accelShare, cruiseDist = target * cruiseShare;
  const decelDist = target - accelDist - cruiseDist;
  if(elapsedMs <= accelMs){
    const u = elapsedMs / accelMs;
    return accelDist * u*u*u;
  }
  if(elapsedMs <= accelMs + cruiseMs){
    const u = (elapsedMs - accelMs) / cruiseMs;
    return accelDist + cruiseDist * u;
  }
  const u = clamp((elapsedMs - accelMs - cruiseMs) / decelMs, 0, 1);
  return accelDist + cruiseDist + decelDist * (1 - Math.pow(1 - u, 3));
}
// trapezoidal 0->1->0 matching the accel/cruise/decel phases, used only to
// scale the speed-stretch cosmetics — not position itself
function flickSpeed(elapsedMs, timing){
  const { accelMs, cruiseMs, decelMs } = timing;
  if(elapsedMs < accelMs) return elapsedMs / accelMs;
  if(elapsedMs < accelMs + cruiseMs) return 1;
  if(elapsedMs < accelMs + cruiseMs + decelMs) return 1 - (elapsedMs - accelMs - cruiseMs) / decelMs;
  return 0;
}

// The 3D pose for a card at fractional distance `d` from the current
// position (negative = above/earlier, positive = below/later). Shared by
// the launch overlay and the crate (see CRATE spec §3) — one geometry
// implementation so the two views can never drift apart. `opts.originY`
// is where the stack's centre sits (launch: baked into its own CSS `top`,
// so it passes 0 here; crate: 170px, passed explicitly since the crate
// card sits at `top:0` and reads its vertical position from `pose.y`).
function flowPose(a, d, speed, opts){
  opts = opts || {};
  const originY = opts.originY || 0, spread = opts.spread == null ? 1 : opts.spread;
  const dir = d < 0 ? -1 : (d > 0 ? 1 : 0);
  const nearFactor = 1 + 0.3*speed, farFactor = 1 + 0.9*speed;
  const baseOffset = a < 1 ? 170*a*nearFactor : 170*nearFactor + (a-1)*34*farFactor;
  const offset = baseOffset * dir * spread;
  const tiltMag = 62 * Math.min(a,1);
  const rotX = dir < 0 ? -tiltMag : tiltMag;
  const scale = 0.86 - 0.06*Math.min(a,1) - 0.02*Math.max(0, Math.min(a,8)-1);
  const z = -70*Math.min(a,1) - 6*Math.max(0, a-1);
  const opacity = a <= 3 ? 1 : Math.max(0, 1 - 0.25*(a-3));
  return { y: originY + offset, rotX, scale, z, opacity };
}
// stacking order for a card at |offset| `a` from the centre — nearest on top
function flowZIndex(a){ return Math.round((9 - Math.min(a,9)) * 10); }

// thin adapter kept so every existing launch call site/shape is untouched —
// the actual geometry now lives in flowPose() alone (LAUNCH spec §3).
function launchCardPose(d, speed, spread){
  const a = Math.abs(d);
  const p = flowPose(a, d, speed, {spread});
  return { offset: p.y, tilt: p.rotX, scale: p.scale, depth: p.z, opacity: p.opacity,
    z: flowZIndex(a) };
}
function applyLaunchCardPose(el, pose, extraScale){
  const scale = pose.scale * (extraScale == null ? 1 : extraScale);
  el.style.transform = 'translateY(' + pose.offset.toFixed(1) + 'px) translateZ(' + pose.depth.toFixed(1) + 'px) '
    + 'rotateX(' + pose.tilt.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')';
  el.style.opacity = pose.opacity;
  el.style.zIndex = pose.z;
}

// Builds one card's DOM (cover art for the library variant, the default
// cover otherwise) — only ever called for indices inside the visible
// window, never all N up front (see LAUNCH spec §3 implementation note).
function makeLaunchCard(stack, index){
  const el = document.createElement('div');
  el.className = 'launch-card';
  if(index === stack.targetIndex) el.classList.add('launch-target');
  const face = document.createElement('div');
  face.className = 'launch-card-face';
  let art = null;
  if(stack.variant === 'library'){
    const albumId = stack.albumIds[index];
    // an already-warmed crate tier (S for the flying stack, L for the
    // caught record) is sharper than the 800px thumbnail — but this never
    // waits on a build, only a synchronous cache hit (spec §B5)
    const tier = index === stack.targetIndex ? 'L' : 'S';
    art = crateArtCache[tier].get(albumId) || thumbURL['album:' + albumId];
  }
  if(art){
    const img = document.createElement('img');
    img.src = art; img.alt = '';
    img.decode().catch(() => {});
    face.appendChild(img);
  } else if(index === stack.targetIndex){
    // the caught record becomes the title screen, so it always gets a
    // presentable cover even with no thumbnail yet (see LAUNCH spec §5)
    const mark = document.createElement('div');
    mark.className = 'launch-card-mark';
    mark.innerHTML = 'Mi<span>zi</span>ki';
    face.appendChild(mark);
  } else if(stack.variant === 'library'){
    face.style.background = S.albumEdge[stack.albumIds[index]] || LAUNCH_ANIM.edgePalette[index % LAUNCH_ANIM.edgePalette.length];
  } else {
    face.style.background = LAUNCH_ANIM.edgePalette[index % LAUNCH_ANIM.edgePalette.length];
  }
  el.appendChild(face);
  return el;
}

// a plain mono "N RECORDS" label, bottom centre — no rail or position
// counter in the intro any more (the crate view has its own rail)
function updateLaunchRecordsLabel(stack){
  $('#launchRecords').textContent = stack.variant === 'library' ? (stack.count + ' RECORDS') : '';
}

async function runLaunchSequence(){
  const token = ++S.launchSeq;
  const cancelled = () => token !== S.launchSeq;
  const overlay = $('#launchOverlay');

  updateLaunchScale();
  window.addEventListener('resize', updateLaunchScale);

  // the variant choice depends on whether restoreLibrary() actually finished
  // in time, not on whatever S.tracks happens to hold at this instant — data
  // that arrives mid-way (tracks populated but sessions/thumbnails still
  // loading) is exactly the "not ready" case the 700ms cap exists for
  const ready = await Promise.race([
    libraryReadyPromise.then(() => true),
    sleep(LAUNCH_ANIM.readyWaitMs).then(() => false)
  ]);
  if(cancelled()) return;
  const stack = ready ? buildLaunchStack() : {variant:'first-run', count: LAUNCH_ANIM.firstRunCount, targetIndex: LAUNCH_ANIM.firstRunCount - 4};
  if(cancelled()) return;
  // S.launchIntro's persisted value loads inside restoreLibrary(), which by
  // now has had at least this long to resolve it — now it's known for sure
  if(!S.launchIntro){ overlay.remove(); window.removeEventListener('resize', updateLaunchScale); return; }

  const stackEl = $('#launchStack'), recordsEl = $('#launchRecords');
  updateLaunchRecordsLabel(stack);
  const cards = new Map();   // index -> element, only for the currently-visible window
  function syncCards(position, speed, spread){
    const lo = Math.max(0, Math.floor(position) - 8), hi = Math.min(stack.count - 1, Math.ceil(position) + 8);
    for(const i of Array.from(cards.keys())) if(i < lo || i > hi){ cards.get(i).remove(); cards.delete(i); }
    for(let i=lo;i<=hi;i++) if(!cards.has(i)){ const el = makeLaunchCard(stack, i); stackEl.appendChild(el); cards.set(i, el); }
    cards.forEach((el, i) => applyLaunchCardPose(el, launchCardPose(i - position, speed, spread)));
  }
  syncCards(0, 0, 1);

  // swallow the first tap anywhere on the overlay: snap to the end instantly
  // rather than letting it also press whatever is underneath
  const skip = e => {
    e.stopPropagation(); e.preventDefault();
    S.launchSeq++;   // cancel the running sequence
    finishLaunch();
  };
  overlay.addEventListener('pointerdown', skip, {capture:true});

  function finishLaunch(fadeMs){
    overlay.removeEventListener('pointerdown', skip, {capture:true});
    window.removeEventListener('resize', updateLaunchScale);
    overlay.style.transition = 'opacity ' + (fadeMs || LAUNCH_ANIM.skipMs) + 'ms linear';
    overlay.classList.add('launch-hidden');
    setTimeout(() => { if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }, fadeMs || LAUNCH_ANIM.skipMs);
  }

  // STACK fades up, resting on record 0
  void stackEl.offsetWidth;
  stackEl.classList.add('launch-settled');
  await sleep(LAUNCH_ANIM.fadeMs);
  if(cancelled()) return;

  // FLICK: accelerate, cruise, decelerate — one position, driven by rAF.
  // A single record never scrolls at all ("no flick: the sleeve pulls
  // straight to the title screen"); 2-7 albums get the shorter riffle
  // timing; everything else (8+, and the first-run variant) gets the
  // standard flick (LAUNCH spec §1/§3).
  if(stack.count > 1){
    const timing = (stack.variant === 'library' && stack.count <= 7)
      ? {accelMs: LAUNCH_ANIM.riffleAccelMs, cruiseMs: LAUNCH_ANIM.riffleCruiseMs, decelMs: LAUNCH_ANIM.riffleDecelMs}
      : {accelMs: LAUNCH_ANIM.accelMs, cruiseMs: LAUNCH_ANIM.cruiseMs, decelMs: LAUNCH_ANIM.decelMs};
    const scrollMs = timing.accelMs + timing.cruiseMs + timing.decelMs;
    const flickStart = performance.now();
    await new Promise(resolve => {
      function step(now){
        if(cancelled()){ resolve(); return; }
        const elapsed = now - flickStart;
        const position = computeFlickPosition(Math.min(elapsed, scrollMs), stack.targetIndex, timing);
        const speed = flickSpeed(elapsed, timing);
        syncCards(position, speed, 1);
        if(elapsed >= scrollMs){ resolve(); return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    if(cancelled()) return;
    syncCards(stack.targetIndex, 0, 1);   // land exactly on the target, no residual speed-stretch
  }

  // CATCH: amber outline (already on the target card's class), small settle
  const targetCard = cards.get(stack.targetIndex);
  if(targetCard){
    targetCard.style.transition = 'transform ' + LAUNCH_ANIM.catchMs + 'ms ease-out';
    void targetCard.offsetWidth;
    targetCard.style.transform += ' scale(1.015)';
    await sleep(LAUNCH_ANIM.catchMs / 2);
    if(cancelled()) return;
    applyLaunchCardPose(targetCard, launchCardPose(0, 0, 1));
  }
  await sleep(LAUNCH_ANIM.catchMs / 2);
  if(cancelled()) return;

  // PULL TO CAMERA: the target scales up to face-on (it's already sitting at
  // the title's position/size — only its scale/tilt/depth are non-identity);
  // neighbours spread apart, dim and fade (opacity only, no blur); the
  // records label fades out
  recordsEl.classList.add('launch-fading');
  const wordmarkEl = $('#launchWordmark');
  wordmarkEl.classList.add('launch-grown');
  const pullStart = performance.now();
  await new Promise(resolve => {
    function step(now){
      if(cancelled()){ resolve(); return; }
      const p = clamp((now - pullStart) / LAUNCH_ANIM.pullMs, 0, 1);
      const eased = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2;   // ease-in-out
      const spread = 1 + 1.2*eased;   // neighbours spread ~1.7x-2.2x by the end
      cards.forEach((el, i) => {
        if(i === stack.targetIndex){ applyLaunchCardPose(el, launchCardPose(0, 0, 1), 0.86 + 0.14*eased); return; }
        const pose = launchCardPose(i - stack.targetIndex, 0, spread);
        pose.opacity = Math.max(0, pose.opacity) * (1 - 0.9*eased);
        applyLaunchCardPose(el, pose);
      });
      if(p >= 1){ resolve(); return; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
  if(cancelled()) return;

  // TITLE: holds as the title screen
  const nameEl = $('#launchTitleName'), subEl = $('#launchTitleSub'), titleEl = $('#launchTitle');
  if(stack.variant === 'library'){
    nameEl.textContent = stack.targetTitle;
    subEl.innerHTML = (stack.targetArtist || '') + '<br><span style="color:var(--accent)">LAST PLAYED</span>';
  } else {
    nameEl.innerHTML = 'Mi<span>zi</span>ki';
    subEl.textContent = 'LOCAL · LOSSLESS';
  }
  titleEl.classList.add('launch-shown');
  await sleep(LAUNCH_ANIM.titleHoldMs);
  if(cancelled()) return;

  // INTO THE CRATE: the library route (crate or list, whichever is saved —
  // restoreLibrary() already rendered it underneath, anchored on this same
  // last-played album, so there is nothing left to build) is already
  // correct behind this opaque overlay. Landing in the crate gets the
  // slower "settle" fade (LAUNCH spec §3, 3700-4300ms); a saved list layout,
  // or the first-run/empty-library variant, just crossfades the plain way.
  if(stack.variant === 'library' && S.libraryLayout !== 'list') finishLaunch(LAUNCH_ANIM.intoCrateMs);
  else finishLaunch();
}

export function attachLaunchSettingRow(){
  const b = $('#launchIntroBtn');
  if(!b) return;
  b.textContent = S.launchIntro ? 'On' : 'Off';
  b.setAttribute('aria-pressed', String(S.launchIntro));
}
function toggleLaunchIntro(){
  S.launchIntro = !S.launchIntro;
  attachLaunchSettingRow();
  queueSave();
}
// F2: real scratch audio in spin-to-scrub, Vinyl only — see src/player/scrub.js.
// Lives in S.char alongside the sliders (not its own top-level S field) since
// it's saved the same way, as part of the same prefs.char object.
function toggleScratch(){
  S.char.scratch = !S.char.scratch;
  const b = $('#scratchBtn');
  b.textContent = S.char.scratch ? 'On' : 'Off';
  b.setAttribute('aria-pressed', String(S.char.scratch));
  queueSave();
}

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

/* ================= S4: crate image tiers (640px "S", 1200px "L") =========
   Stored in the existing `artwork` store (keyed by id, never `meta` — that
   would read hundreds of MB into memory on every launch) under prefixed
   ids `crate640:<albumId>` / `crate1200:<albumId>`, built lazily and
   fetched through a small LRU of object URLs. See the image-quality
   spec §B1-B3. No DB version bump — the store already exists. */
const CRATE_TIER_S_PX = 640, CRATE_TIER_L_PX = 1200;
const CRATE_TIER_S_Q = 0.88, CRATE_TIER_L_Q = 0.92;
const CRATE_TIER_S_CAP = 40, CRATE_TIER_L_CAP = 4;
const crateArtCache = { S: new Map(), L: new Map() };   // albumId -> object URL; Map insertion order is LRU recency
const crateArtBuilding = new Set();                      // 'tier:albumId' in flight, so concurrent askers don't double-build

function crateTierKey(tier, albumId){ return (tier === 'L' ? 'crate1200:' : 'crate640:') + albumId; }

// like cropSquareImage (left untouched for the existing 800/300px thumbs),
// but halves repeatedly so a big reduction doesn't alias the way a single
// drawImage step does (spec §B3)
function cropSquareImageStepped(file, maxDim, quality){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      const out = Math.min(maxDim, side);   // never upscale
      let canvas = document.createElement('canvas');
      canvas.width = side; canvas.height = side;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, side, side);
      URL.revokeObjectURL(img.src);
      let curSize = side;
      while(curSize > out * 2){
        const next = Math.max(out, Math.round(curSize / 2));
        const nextCanvas = document.createElement('canvas');
        nextCanvas.width = next; nextCanvas.height = next;
        const nextCx = nextCanvas.getContext('2d');
        nextCx.imageSmoothingEnabled = true; nextCx.imageSmoothingQuality = 'high';
        nextCx.drawImage(canvas, 0, 0, curSize, curSize, 0, 0, next, next);
        canvas = nextCanvas; curSize = next;
      }
      if(curSize !== out){
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = out; finalCanvas.height = out;
        const finalCx = finalCanvas.getContext('2d');
        finalCx.imageSmoothingEnabled = true; finalCx.imageSmoothingQuality = 'high';
        finalCx.drawImage(canvas, 0, 0, curSize, curSize, 0, 0, out, out);
        canvas = finalCanvas;
      }
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('could not read image'));
    img.src = URL.createObjectURL(file);
  });
}

// the album's best available source art — first track with art wins (a
// user edit already wins inside t.art itself, see applyEdit()); always cut
// from this original, never from an existing 800px thumbnail (spec §B3)
function crateArtSourceFor(albumId){
  for(const t of S.tracks) if(albumKey(t) === albumId && t.art) return t.art;
  return null;
}

export async function buildCrateTier(albumId, tier){
  const buildKey = tier + ':' + albumId;
  if(crateArtBuilding.has(buildKey)) return false;
  crateArtBuilding.add(buildKey);
  try{
    const key = crateTierKey(tier, albumId);
    const existing = await artwork.get(key);
    if(existing) return true;   // resumable: a heal pass just skips what's already built
    const srcUrl = crateArtSourceFor(albumId);
    if(!srcUrl) return false;
    const blob = await (await fetch(srcUrl)).blob();
    const px = tier === 'L' ? CRATE_TIER_L_PX : CRATE_TIER_S_PX;
    const q = tier === 'L' ? CRATE_TIER_L_Q : CRATE_TIER_S_Q;
    const out = await cropSquareImageStepped(blob, px, q);
    await artwork.put({id: key, blob: out});
    return true;
  }catch(e){ return false; }
  finally{ crateArtBuilding.delete(buildKey); }
}

function crateArtCacheSet(tier, albumId, url){
  const cache = crateArtCache[tier], cap = tier === 'L' ? CRATE_TIER_L_CAP : CRATE_TIER_S_CAP;
  cache.delete(albumId);
  cache.set(albumId, url);
  while(cache.size > cap){
    const oldestId = cache.keys().next().value;
    try{ URL.revokeObjectURL(cache.get(oldestId)); }catch(e){}
    cache.delete(oldestId);
  }
}

// looks up (building on demand) an album's crate-tier object URL, through
// a small LRU so a long flick never accumulates hundreds of live object
// URLs (spec §B2)
async function getCrateArtURL(albumId, tier){
  const cache = crateArtCache[tier];
  if(cache.has(albumId)){
    const url = cache.get(albumId);
    crateArtCacheSet(tier, albumId, url);   // bump recency
    return url;
  }
  const key = crateTierKey(tier, albumId);
  let rec = await artwork.get(key);
  if(!rec){
    if(!(await buildCrateTier(albumId, tier))) return null;
    rec = await artwork.get(key);
    if(!rec) return null;
  }
  const url = URL.createObjectURL(rec.blob);
  crateArtCacheSet(tier, albumId, url);
  return url;
}

function revokeCrateArtTier(albumId, tier){
  const cache = crateArtCache[tier];
  if(cache.has(albumId)){ try{ URL.revokeObjectURL(cache.get(albumId)); }catch(e){} cache.delete(albumId); }
}

export async function deleteCrateArtTiers(albumId){
  revokeCrateArtTier(albumId, 'S'); revokeCrateArtTier(albumId, 'L');
  await artwork.del(crateTierKey('S', albumId));
  await artwork.del(crateTierKey('L', albumId));
}

// background S-tier pass for the whole library, starting at the crate
// anchor and working outward, yielding between albums so it never blocks a
// frame, and resumable (buildCrateTier skips anything already built) —
// spec §B3. Triggered from restoreLibrary() and after imports/art edits.
let healCrateArtToken = 0;
export async function healCrateArt(){
  const token = ++healCrateArtToken;
  const seen = new Set(), ids = [];
  S.tracks.forEach(t => { const id = albumKey(t); if(!seen.has(id)){ seen.add(id); ids.push(id); } });
  if(!ids.length) return;
  const anchorPos = Math.max(0, S.crateAnchor ? ids.indexOf(S.crateAnchor) : 0);
  const ordered = [];
  for(let d = 0; d < ids.length; d++){
    if(anchorPos + d < ids.length) ordered.push(ids[anchorPos + d]);
    if(d > 0 && anchorPos - d >= 0) ordered.push(ids[anchorPos - d]);
  }
  for(const albumId of ordered){
    if(token !== healCrateArtToken) return;   // superseded by a newer pass
    await buildCrateTier(albumId, 'S');
    await sleep(0);
  }
}

// a quiet pre-warm of the L tier around the crate anchor, so the centre
// record (and a quick flick either way) is usually already sharp the first
// time it's looked at (spec §B2, "plus a quiet pre-warm")
async function prewarmCrateAnchorL(){
  if(!S.crate || !S.crate.model || !S.crate.model.items.length) return;
  const items = S.crate.model.items;
  const pos = Math.round(S.crate.pos != null ? S.crate.pos : 0);
  const ids = [];
  for(let d = -3; d <= 3; d++){
    const item = items[pos + d];
    if(item && item.type === 'rec' && !ids.includes(item.albumId)) ids.push(item.albumId);
  }
  for(const albumId of ids) await buildCrateTier(albumId, 'L');
}

function titleCaseGenre(s){
  return s.split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
function firstGenreValue(raw){ return raw ? raw.split(/[;,]/)[0].trim() : ''; }
// normKey() already lowercases/strips diacritics/collapses to [a-z0-9 ]+;
// stripping a leading article on top of that gives the brief's sort key
function crateSortKey(name){ return normKey(name).replace(/^(the|a|an)\s+/, ''); }
function crateCompareNames(a, b){
  return crateSortKey(a).localeCompare(crateSortKey(b), undefined, {numeric:true, sensitivity:'base'});
}
function crateArtistPriority(artist){ return artist === 'Unknown Artist' ? 1 : 0; }
function compareCrateArtists(a, b){
  const pa = crateArtistPriority(a), pb = crateArtistPriority(b);
  return pa !== pb ? pa - pb : crateCompareNames(a, b);
}
function crateLetterFor(artist){
  if(artist === 'Unknown Artist') return '?';
  const c = crateSortKey(artist).charAt(0);
  return /[a-z]/.test(c) ? c.toUpperCase() : '#';
}
function crateLooseArtistId(artist){ return 'loose:' + normKey(artist); }
// oldest first, the way a record store files an artist's albums; 0 (no
// year) sorts after every dated album, alphabetically among themselves —
// so an untagged library just behaves like the plain alphabetical order
function compareCrateYear(a, b){
  const ay = a.year || 0, by = b.year || 0;
  if(!ay && !by) return 0;
  if(!ay) return 1;
  if(!by) return -1;
  return ay - by;
}
export function libraryHasGenres(){ return S.tracks.some(t => t.details && firstGenreValue(t.details.genre)); }

function albumGenreFor(idx){
  const counts = new Map();
  idx.forEach((i, pos) => {
    const g = firstGenreValue(S.tracks[i].details && S.tracks[i].details.genre);
    if(!g) return;
    const key = g.toLowerCase();
    if(!counts.has(key)) counts.set(key, {count:0, display:titleCaseGenre(g), firstPos:pos});
    counts.get(key).count++;
  });
  if(!counts.size) return '';
  let best = null;
  counts.forEach(v => { if(!best || v.count > best.count || (v.count === best.count && v.firstPos < best.firstPos)) best = v; });
  return best.display;
}

// an album's year is the most common non-zero t.details.year among its
// tracks, ties going to the earliest (CRATE spec §2) — 0 means unknown
function albumYearFor(idx){
  const counts = new Map();
  idx.forEach(i => {
    const y = S.tracks[i].details && S.tracks[i].details.year;
    if(!y) return;
    counts.set(y, (counts.get(y) || 0) + 1);
  });
  if(!counts.size) return 0;
  let best = 0, bestCount = -1;
  counts.forEach((count, year) => {
    if(count > bestCount || (count === bestCount && year < best)) { best = year; bestCount = count; }
  });
  return best;
}

// one crate record per album id; loose ("Unknown Album") tracks collapse
// into one pseudo-record per artist instead of one per track (CRATE spec §2)
function buildCrateRecords(){
  const byAlbum = new Map(), looseByArtist = new Map();
  S.tracks.forEach((t, i) => {
    if(t.tags.album === 'Unknown Album'){
      const artistName = t.tags.artist || 'Unknown Artist';
      const key = normKey(artistName) || 'unknown';
      if(!looseByArtist.has(key)) looseByArtist.set(key, {artist:artistName, idx:[]});
      looseByArtist.get(key).idx.push(i);
      return;
    }
    const id = albumKey(t);
    if(!byAlbum.has(id)) byAlbum.set(id, []);
    byAlbum.get(id).push(i);
  });

  const records = [];
  byAlbum.forEach((idx, albumId) => {
    const tracks = idx.map(i => S.tracks[i]);
    const artistSet = new Set(tracks.map(t => t.tags.artist));
    const albumArtistSet = new Set(tracks.map(t => t.tags.albumArtist));
    let artist;
    if(albumArtistSet.size === 1) artist = [...albumArtistSet][0];
    else if(artistSet.size > 1) artist = 'Various Artists';   // different artists, no consistent albumArtist
    else artist = tracks[0].tags.artist || 'Unknown Artist';
    records.push({type:'rec', kind:'album', albumId, idx, artist, album: tracks[0].tags.album,
      year: albumYearFor(idx), trackCount: idx.length, genre: albumGenreFor(idx)});
  });
  looseByArtist.forEach(({artist, idx}) => {
    records.push({type:'rec', kind:'loose', albumId: crateLooseArtistId(artist), idx, artist,
      album:'Singles & loose tracks', year:0, trackCount: idx.length, genre:''});
  });
  return records;
}

function groupSortedRecords(records, keyFn){
  const groups = [];
  let cur = null;
  records.forEach(r => {
    const k = keyFn(r);
    if(!cur || cur.key !== k){ cur = {key:k, records:[]}; groups.push(cur); }
    cur.records.push(r);
  });
  return groups;
}

// builds the ordered {type:'div'|'rec', ...} array once, plus lookup maps
// for jumping by album id or by letter/genre (CRATE spec §2)
function buildCrateModel(group){
  const records = buildCrateRecords();
  const items = [], byAlbumId = new Map(), jumpIndex = new Map();
  let railEntries = [];

  if(group === 'genre'){
    records.forEach(r => { r.genreGroup = r.genre || 'Unsorted'; });
    const counts = new Map();
    records.forEach(r => { if(r.genreGroup !== 'Unsorted') counts.set(r.genreGroup, (counts.get(r.genreGroup)||0) + 1); });
    if(counts.size > 25) records.forEach(r => { if(r.genreGroup !== 'Unsorted' && counts.get(r.genreGroup) < 3) r.genreGroup = 'Other'; });
    records.sort((a,b) => {
      const pa = a.genreGroup === 'Unsorted' ? 1 : 0, pb = b.genreGroup === 'Unsorted' ? 1 : 0;
      if(pa !== pb) return pa - pb;
      return crateCompareNames(a.genreGroup, b.genreGroup) || compareCrateArtists(a.artist, b.artist)
        || compareCrateYear(a, b) || crateCompareNames(a.album, b.album);
    });
    const groups = groupSortedRecords(records, r => r.genreGroup);
    const showDividers = groups.length >= 2;
    groups.forEach(g => {
      if(showDividers){
        const artistCount = new Set(g.records.map(r => r.artist)).size;
        jumpIndex.set('key:' + g.key, items.length);
        railEntries.push({key:g.key, label: g.key.slice(0,3).toUpperCase(), itemIndex: items.length, present:true});
        items.push({type:'div', label:g.key, meta: artistCount + ' ARTISTS · ' + g.records.length + ' ALBUMS',
          panelSub:'Genre', key:g.key});
      }
      g.records.forEach(r => { byAlbumId.set(r.albumId, items.length); items.push(r); });
    });
  } else {
    records.sort((a,b) => compareCrateArtists(a.artist, b.artist) || compareCrateYear(a, b) || crateCompareNames(a.album, b.album));
    const groups = groupSortedRecords(records, r => crateLetterFor(r.artist));
    const showDividers = records.length >= 20;
    const present = new Set(groups.map(g => g.key));
    groups.forEach(g => {
      if(showDividers){
        const artistCount = new Set(g.records.map(r => r.artist)).size;
        jumpIndex.set('key:' + g.key, items.length);
        items.push({type:'div', label:g.key,
          meta: artistCount + ' ARTISTS · ' + g.records.length + ' ALBUMS',
          panelSub: g.key === '?' ? 'Unknown artist' : 'Artists beginning with ' + g.key, key:g.key});
      }
      g.records.forEach(r => { byAlbumId.set(r.albumId, items.length); items.push(r); });
    });
    if(showDividers){
      railEntries = CRATE_ALPHABET.concat(present.has('?') ? ['?'] : [])
        .map(letter => ({key:letter, label:letter, itemIndex: jumpIndex.get('key:'+letter), present: present.has(letter)}));
    }
  }
  return {items, byAlbumId, jumpIndex, railEntries, group};
}

function ensureCrateModel(){
  if(!S.crate.model || S.crate.modelGroup !== S.crateGroup || S.crate.modelDirty){
    S.crate.model = buildCrateModel(S.crateGroup);
    S.crate.modelGroup = S.crateGroup;
    S.crate.modelDirty = false;
    // item indices just shifted under whatever S.crate.pos used to mean —
    // re-resolve from the anchor (a stable album id) rather than trust a
    // now-possibly-unrelated numeric position into the rebuilt list
    S.crate.pos = null;
  }
  return S.crate.model;
}
export function invalidateCrateModel(){ S.crate.modelDirty = true; }

function isNowPlayingAlbum(item){ return item.type === 'rec' && S.index >= 0 && item.idx.includes(S.index); }

let crateAnchorSaveTimer = null;
function persistCrateAnchor(item){
  S.crateAnchor = item ? item.albumId : null;
  clearTimeout(crateAnchorSaveTimer);
  crateAnchorSaveTimer = setTimeout(queueSave, 500);
}

// the rail always lands on the first record after a letter/genre divider,
// not the divider itself, falling back to the divider if nothing follows
// it (CRATE spec §4, "Release to land on the first record")
function crateRailJumpTarget(model, key){
  const di = model.jumpIndex.get('key:' + key);
  if(di == null) return null;
  const next = di + 1;
  return (next < model.items.length && model.items[next].type === 'rec') ? next : di;
}

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
function sealedQuietPlay(trackIdx, i){
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

function openGatefold(item){
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

function openSealedSheet(item){
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

function openCrateAlbum(item){
  const v = S.view;
  if(item.kind === 'loose'){
    v.mode = 'crateLoose'; v.crateLooseArtist = item.artist; v.crateLooseIdx = item.idx.slice();
    v.group = null; v.playlist = null; v.person = null; v.artistAlbum = null;
    renderTracks();
    return;
  }
  // a sealed record can't be opened — the gatefold and its left panel only
  // unlock after the first play (SEALED spec §1, §5)
  if(isAlbumSealed(item.albumId)){ openSealedSheet(item); return; }
  // the gatefold is an overlay on top of the still-rendered crate (GATEFOLD
  // spec §A1) — nothing about S.view/S.crate changes, so closing it needs no
  // navigation back, it's simply still there
  openGatefold(item);
}

function updateCrateGroupToggleUI(){
  const hasGenres = libraryHasGenres();
  $('#crateGenreBtn').style.display = hasGenres ? '' : 'none';
  if(!hasGenres && S.crateGroup === 'genre'){ S.crateGroup = 'az'; invalidateCrateModel(); queueSave(); }
  document.querySelectorAll('#crateGroupToggle [data-group]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.group === S.crateGroup)));
}

// flat, non-3D fallback for prefers-reduced-motion: a plain scrollable list,
// snap-scroll instead of momentum, cross-fade instead of the pull-to-camera
// (CRATE spec §6)
function renderCrateFlat(host, model){
  updateCrateGroupToggleUI();
  const list = el('div','crate-flat-list');
  list.setAttribute('role','listbox');
  list.setAttribute('aria-label','Crate');
  model.items.forEach(item => {
    if(item.type === 'div'){
      list.appendChild(el('div','crate-flat-divider', item.label + ' — ' + item.meta));
      return;
    }
    const row = el('div','crate-flat-item');
    row.setAttribute('role','option');
    if(isNowPlayingAlbum(item)) row.classList.add('crate-flat-current');
    const sealed = isAlbumSealed(item.albumId);
    const art = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art);
    if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; row.appendChild(im); }
    else { const flat = el('span','crate-flat-flat'); flat.style.background = CRATE_PALETTE[row.childElementCount % CRATE_PALETTE.length]; row.appendChild(flat); }
    const text = el('span','t-name');
    const titleEl = el('b', null, item.album);
    if(sealed) titleEl.appendChild(el('span','new-tag','NEW'));
    text.appendChild(titleEl);
    text.appendChild(el('em', null, item.artist + ' · ' + item.trackCount + (item.trackCount===1?' track':' tracks')));
    row.appendChild(text);
    const playBtn = el('button','t-edit','▶');
    playBtn.setAttribute('aria-label','Play ' + item.album);
    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      if(sealed){ sealedQuietPlay(item.idx, item.idx[0]); } else setQueue(item.idx, 0, true);
    });
    row.appendChild(playBtn);
    row.addEventListener('click', () => {
      persistCrateAnchor(item);
      const host2 = $('#libBody');
      host2.style.transition = 'opacity 150ms ease'; host2.style.opacity = '0';
      setTimeout(() => { openCrateAlbum(item); $('#libBody').style.opacity = '1'; }, 150);
    });
    list.appendChild(row);
  });
  host.appendChild(list);
}

// the stage is a fixed height regardless of viewport, so on a short screen
// it (plus the info panel below it) can run into the (fixed-position) mini
// player — shrink the stage by however much the mini player + tabbar
// actually take up, rather than overlapping them (CRATE spec addendum,
// "Mini player"). Fewer distant neighbours show on a short screen; the
// centre record and info panel are unaffected. Called at mount time and
// again from updateChromeInset() whenever the mini player's own visibility
// changes later, since that happens after the crate has already rendered.
export function applyCrateMiniInset(){
  const stage = document.querySelector('.crate-stage'), info = document.querySelector('.crate-info');
  const wrap = document.querySelector('.crate-wrap');
  if(!stage || !wrap) return;
  const miniEl = $('#miniPlayer'), tabbarEl = $('#tabbar');
  const miniH = (miniEl && getComputedStyle(miniEl).display !== 'none') ? miniEl.getBoundingClientRect().height : 0;
  const tabbarH = tabbarEl ? tabbarEl.getBoundingClientRect().height : 0;
  const infoReserve = info ? info.getBoundingClientRect().height : 84;
  // the "now playing elsewhere" pill sits in normal flow above the stage
  // (shown/hidden as the user scrolls past the playing album) and isn't
  // fixed-height — when shown it has to come out of this same budget, same
  // as the info panel below, or the stage claims room it doesn't have
  const topbarEl = document.querySelector('.crate-topbar');
  const topbarVisible = topbarEl && getComputedStyle(topbarEl).display !== 'none';
  // include its own margin-bottom too — getBoundingClientRect only covers
  // the border box, and the margin is exactly what separates it from the
  // stage below
  const topbarReserve = topbarVisible
    ? topbarEl.getBoundingClientRect().height + (parseFloat(getComputedStyle(topbarEl).marginBottom) || 0)
    : 0;
  const wrapTop = wrap.getBoundingClientRect().top;
  // .wrap itself already reserves tabbarH + miniH + 16px as its own
  // bottom padding (--chrome-inset, set by updateChromeInset() for every
  // route so a normally-scrolling list's last item doesn't hide under the
  // fixed tabbar/mini player) — that padding lands right after this route's
  // content regardless of what's inside it, stacking on top of whatever
  // margin this function leaves. 28 here, not just the 16 that padding
  // already covers, so after .crate-info's own 12px margin-top cancels
  // part of it, the two reservations land flush with zero net overflow —
  // verified against the actual rendered page height, not just by eye.
  const available = window.innerHeight - wrapTop - miniH - tabbarH - infoReserve - topbarReserve - 28;
  // the stage always claims all available room instead of capping and
  // banking the rest as dead space below the info panel — the info panel
  // sits flush just above the mini player, and the crate itself (the thing
  // people are actually here to flip through) gets whatever room that frees up.
  // Crucially this must never be pushed ABOVE "available": on a short
  // screen that would make the stage (plus the info panel still sitting
  // right below it) taller than the room between the header and the fixed
  // mini player/tabbar, overflowing the route and forcing the whole PAGE
  // to scroll — the one thing this layout exists to prevent. A previous
  // version enforced a floor here so the focal card wouldn't clip too much
  // against the stage's own overflow:hidden; that floor could exceed
  // "available" and is exactly what caused the page-scroll regression, so
  // on a truly cramped screen the card clips a little more instead.
  const stageHeight = Math.max(0, available);
  stage.style.height = stageHeight + 'px';
  // the rail is a sibling of the stage, absolutely positioned against
  // .crate-wrap rather than sized to the stage — it used to be a hardcoded
  // 440px (left over from when the stage itself was a fixed height) and
  // didn't shrink along with a dynamic stage, so on a short screen it could
  // poke out well past the stage's own bottom edge and inflate the page's
  // scrollable height even once the stage/info math above was correct.
  // Keep it inset the same 10px top and bottom as the stage always has.
  const railEl = document.querySelector('.crate-rail');
  if(railEl) railEl.style.height = Math.max(0, stageHeight - 20) + 'px';
}

function renderCrate(host){
  const model = ensureCrateModel();
  if(!model.items.length){ host.appendChild(el('p','note','No albums to show yet.')); return; }
  updateCrateGroupToggleUI();
  if(REDUCED){ renderCrateFlat(host, model); return; }

  let startPos = S.crate.pos;
  if(startPos == null || isNaN(startPos) || startPos < 0 || startPos >= model.items.length){
    // cold start: the last-played album wins, falling back to the saved
    // anchor, then the first record. After this first resolution, the
    // (continuously updated) anchor takes over on any later rebuild
    // (CRATE spec addendum, "Cold-start anchor")
    const lastPlayedId = !S.crate.coldStartDone ? resolveLastPlayedAlbum() : null;
    if(lastPlayedId && model.byAlbumId.has(lastPlayedId)) startPos = model.byAlbumId.get(lastPlayedId);
    else if(S.crateAnchor && model.byAlbumId.has(S.crateAnchor)) startPos = model.byAlbumId.get(S.crateAnchor);
    else startPos = model.items.findIndex(it => it.type === 'rec');
    if(startPos < 0) startPos = 0;
    S.crate.coldStartDone = true;
  }
  S.crate.pos = startPos;

  // resolved once per render — the playing album can't change while the
  // user is actively scrubbing the stage, so this doesn't need to be
  // recomputed every frame (CRATE spec §4, "Now playing")
  const nowPlayingIdx = model.items.findIndex(isNowPlayingAlbum);

  const wrap = el('div','crate-wrap');
  const nowPlayingBtn = el('button','crate-topbar');
  nowPlayingBtn.setAttribute('aria-label','Scroll to the album that is now playing');
  nowPlayingBtn.addEventListener('click', () => { if(nowPlayingIdx >= 0) snapTo(nowPlayingIdx); });
  const stage = el('div','crate-stage');
  stage.tabIndex = 0;
  stage.setAttribute('role','listbox');
  stage.setAttribute('aria-label','Crate');
  const live = el('div','sr-only'); live.id = 'crateLive'; live.setAttribute('aria-live','polite');
  stage.appendChild(live);
  const rail = el('div','crate-rail');
  const info = el('div','crate-info');
  wrap.appendChild(nowPlayingBtn); wrap.appendChild(stage); wrap.appendChild(rail); wrap.appendChild(info);
  host.appendChild(wrap);

  applyCrateMiniInset();

  const pool = new Map();      // item index -> element, only the visible window
  let animToken = 0, rafHandle = null;
  const cancelAnim = () => { animToken++; if(rafHandle){ cancelAnimationFrame(rafHandle); rafHandle = null; } };

  function itemAt(i){ return model.items[i]; }

  function makeCardEl(i){
    const item = itemAt(i);
    const card = document.createElement('div');
    card.className = 'crate-card';
    if(item.type === 'div'){
      const d = document.createElement('div'); d.className = 'crate-divider';
      const tab = document.createElement('div'); tab.className = 'crate-divider-tab'; tab.textContent = item.label;
      const label = document.createElement('div'); label.className = 'crate-divider-label'; label.textContent = item.label;
      const meta = document.createElement('div'); meta.className = 'crate-divider-meta'; meta.textContent = item.meta;
      d.appendChild(tab); d.appendChild(label); d.appendChild(meta);
      card.appendChild(d);
    } else {
      const face = document.createElement('div'); face.className = 'crate-card-face';
      face.style.background = CRATE_PALETTE[i % CRATE_PALETTE.length];
      card.appendChild(face);
      if(isNowPlayingAlbum(item)){
        const dot = document.createElement('div'); dot.className = 'crate-now-dot'; card.appendChild(dot);
      }
      if(isAlbumSealed(item.albumId)) card.appendChild(buildSealOverlay(278));
    }
    return card;
  }
  // S tier for the pool (spec §B2); falls back to the existing album
  // thumbnail, then the first track's own art, while the tier builds
  function setCardImage(i, card){
    const item = itemAt(i);
    if(item.type !== 'rec') return;
    const face = card.querySelector('.crate-card-face');
    if(!face || face.querySelector('img') || card.dataset.artPending) return;
    card.dataset.artPending = '1';
    getCrateArtURL(item.albumId, 'S').then(tierUrl => {
      delete card.dataset.artPending;
      if(pool.get(i) !== card) return;        // recycled while the lookup was in flight
      if(face.querySelector('img')) return;
      const art = tierUrl || thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art);
      if(!art) return;
      const img = document.createElement('img');
      img.decoding = 'async'; img.alt = '';
      face.appendChild(img);
      img.src = art;
    });
  }
  function clearCardImage(card){ const img = card.querySelector('img'); if(img) img.remove(); delete card.dataset.artPending; }

  // 200ms after the stack settles, quietly decode and swap the centre
  // record's S image for the L tier — sharper at rest, nothing visibly
  // changes but the crispness (spec §B4, "swap S to L at rest")
  let largeSwapTimer = null;
  function scheduleLargeSwap(){
    clearTimeout(largeSwapTimer);
    largeSwapTimer = setTimeout(async () => {
      const idx = Math.round(S.crate.pos);
      const item = itemAt(idx);
      const card = pool.get(idx);
      if(!item || item.type !== 'rec' || !card) return;
      const url = await getCrateArtURL(item.albumId, 'L');
      if(!url || Math.round(S.crate.pos) !== idx || pool.get(idx) !== card) return;
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      try{ await img.decode(); }catch(e){ return; }
      if(Math.round(S.crate.pos) !== idx || pool.get(idx) !== card) return;
      const face = card.querySelector('.crate-card-face');
      const liveImg = face && face.querySelector('img');
      if(liveImg) liveImg.src = url; else if(face){ img.alt = ''; face.appendChild(img); }
    }, 200);
  }

  // the info panel's rendered height isn't constant while scrolling: a
  // divider item renders shorter (no play-button row) than a record, and a
  // long album/artist name can wrap to an extra line. applyCrateMiniInset
  // sized the stage against whatever the info panel measured at mount (or
  // the last topbar toggle) — if the real height grows past that while
  // scrolling, the stage doesn't shrink to compensate, and the taller info
  // panel gets pushed down behind the (fixed-position) mini player.
  // Re-measured after every updateInfoPanel call below, and only when it
  // actually changed, so this doesn't force a layout pass every frame.
  let lastInfoH = null;
  function syncInfoReserve(){
    const h = info.getBoundingClientRect().height;
    if(h !== lastInfoH){ lastInfoH = h; applyCrateMiniInset(); }
  }

  // a chip above the stage for when the playing album has been scrolled
  // away from — tapping it scrolls back (CRATE spec §4, "Now playing")
  let topbarShown = false;
  function updateNowPlayingTopBar(position){
    const shouldShow = nowPlayingIdx >= 0 && Math.round(position) !== nowPlayingIdx;
    const changed = shouldShow !== topbarShown;
    topbarShown = shouldShow;
    if(shouldShow){
      const item = itemAt(nowPlayingIdx);
      nowPlayingBtn.textContent = '● Now playing — ' + item.album;
      nowPlayingBtn.classList.add('show');
    } else {
      nowPlayingBtn.classList.remove('show');
    }
    // the pill takes up real flow space above the stage, so the stage's
    // own height budget (applyCrateMiniInset) has to be recomputed
    // whenever it appears or disappears — but only on that transition, not
    // every frame, since this runs continuously while scrubbing. This has
    // to run AFTER the show/hide class above, not before: measuring with
    // the old (stale) display state meant the stage never actually
    // reserved room for a pill that was about to pop in a moment later,
    // pushing the info panel down behind the mini player on that frame.
    if(changed) applyCrateMiniInset();
  }

  function updateInfoPanel(idx){
    const item = itemAt(idx);
    info.innerHTML = '';
    if(!item) return;
    if(item.type === 'div'){
      info.appendChild(el('h3', null, item.label));
      info.appendChild(el('p','crate-info-sub', item.panelSub || ''));
      info.appendChild(el('p','crate-info-meta', item.meta));
      return;
    }
    const sealed = isAlbumSealed(item.albumId);
    const row = el('div','crate-info-row');
    const text = el('div');
    const h3 = el('h3', null, item.album);
    if(isNowPlayingAlbum(item)) h3.appendChild(el('span','crate-now-chip','● Now playing'));
    text.appendChild(h3);
    text.appendChild(el('p','crate-info-sub', item.artist));
    const metaBits = [item.genre || null, item.year || null,
      item.trackCount + (item.trackCount === 1 ? ' track' : ' tracks')].filter(Boolean);
    text.appendChild(el('p','crate-info-meta', metaBits.join(' · ').toUpperCase()));
    if(sealed){
      text.appendChild(el('span','seal-tag','SEALED'));
      text.appendChild(el('span','sr-only','Sealed, not played yet'));
    }
    row.appendChild(text);
    const playBtn = el('button','tbtn play','▶');
    playBtn.setAttribute('aria-label','Play ' + item.album);
    // a sealed album plays quietly from track 1, same first-play rules as
    // the sealed sheet — no sheet/overlay opens from here either (§5)
    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      if(sealed){ sealedQuietPlay(item.idx, item.idx[0]); } else setQueue(item.idx, 0, true);
    });
    row.appendChild(playBtn);
    info.appendChild(row);
  }

  function updateRailUI(position){
    const entries = model.railEntries;
    rail.innerHTML = '';
    if(!entries.length) return;
    // ticks spread across the rail's own current height (kept in sync with
    // the dynamic stage by applyCrateMiniInset), not a number tuned to the
    // old fixed-height stage — otherwise they'd run off the bottom of a
    // shorter rail instead of spanning it
    const h = Math.max(0, rail.getBoundingClientRect().height - 20);
    entries.forEach((e_, k) => {
      const t = entries.length > 1 ? k / (entries.length - 1) : 0;
      const tick = el('button','crate-rail-item' + (e_.present ? '' : ' crate-rail-dim'), e_.label);
      tick.style.top = (t * h) + 'px';
      tick.disabled = !e_.present;
      if(e_.present){
        const target = crateRailJumpTarget(model, e_.key);
        if(target != null && Math.abs(position - target) < 2) tick.classList.add('crate-rail-current');
        tick.addEventListener('pointerdown', ev => { ev.stopPropagation(); });
        tick.addEventListener('click', ev => { ev.stopPropagation(); snapTo(target); });
      }
      rail.appendChild(tick);
    });
  }

  function announceCurrent(){
    const item = itemAt(Math.round(S.crate.pos));
    if(!item) return;
    live.textContent = item.type === 'div' ? ('Divider ' + item.label + ', ' + item.meta.toLowerCase())
      : (item.album + ', ' + item.artist + ', ' + item.trackCount + (item.trackCount===1?' track':' tracks'));
  }

  // will-change only while the stack is actually moving, dropped 150ms
  // after the last moving frame (spec §B4, "promote only while moving")
  let moveClassTimer = null;
  function applyMovingClass(speed){
    if(speed > 0.02){
      clearTimeout(moveClassTimer); moveClassTimer = null;
      pool.forEach(card => card.classList.add('crate-moving'));
    } else if(moveClassTimer == null){
      moveClassTimer = setTimeout(() => { pool.forEach(card => card.classList.remove('crate-moving')); moveClassTimer = null; }, 150);
    }
  }

  function syncCards(position, speed){
    const lo = Math.max(0, Math.floor(position) - CRATE_VISIBLE_A), hi = Math.min(model.items.length - 1, Math.ceil(position) + CRATE_VISIBLE_A);
    for(const i of Array.from(pool.keys())) if(i < lo || i > hi){ pool.get(i).remove(); pool.delete(i); }
    for(let i = lo; i <= hi; i++) if(!pool.has(i)){ const c = makeCardEl(i); stage.appendChild(c); pool.set(i, c); }
    pool.forEach((card, i) => {
      const d = i - position, a = Math.abs(d);
      const pose = flowPose(a, d, speed, {originY: CRATE_ORIGIN_Y});
      // integer device pixels so edges don't smear at rest (spec §B4)
      const y = Math.round(pose.y * CRATE_DPR) / CRATE_DPR;
      card.style.transform = 'translateY(' + y.toFixed(2) + 'px) translateZ(' + pose.z.toFixed(1) + 'px) '
        + 'rotateX(' + pose.rotX.toFixed(2) + 'deg) scale(' + pose.scale.toFixed(3) + ')';
      card.style.opacity = pose.opacity;
      card.style.zIndex = flowZIndex(a);
      card.classList.toggle('crate-current', a < 0.02);
      if(a <= 2 && speed < 0.5) setCardImage(i, card);
      else if(a > 2) clearCardImage(card);
    });
    applyMovingClass(speed);
    updateInfoPanel(Math.round(position));
    syncInfoReserve();
    updateRailUI(position);
    updateNowPlayingTopBar(position);
  }
  function draw(speed){ syncCards(S.crate.pos, speed); }

  function onSettled(){
    const item = itemAt(Math.round(S.crate.pos));
    if(item && item.type === 'rec') persistCrateAnchor(item);
    announceCurrent();
    scheduleLargeSwap();
  }

  // the animation loop is draw-on-demand: paused outright (not just slowed)
  // whenever the library route isn't visible or the page is hidden — the
  // next interaction (or a resize/visibility change) picks up normally,
  // so a stalled frame never leaves the pose stuck mid-animation
  function pausedNow(){ return document.hidden || !isLibraryRouteVisible(); }

  function snapTo(target, ms){
    cancelAnim();
    const token = ++animToken;
    target = clamp(Math.round(target), 0, model.items.length - 1);
    const start = S.crate.pos, startTime = performance.now(), dur = ms || 250;
    function step(now){
      if(token !== animToken) return;
      if(pausedNow()){ S.crate.pos = target; draw(0); onSettled(); return; }
      const p = clamp((now - startTime) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      S.crate.pos = start + (target - start) * eased;
      draw((1 - p) * 0.35);
      if(p < 1){ rafHandle = requestAnimationFrame(step); }
      else { S.crate.pos = target; draw(0); onSettled(); }
    }
    rafHandle = requestAnimationFrame(step);
  }

  function momentumThenSnap(velocity){
    cancelAnim();
    const token = ++animToken;
    let v = velocity, last = performance.now();
    function step(now){
      if(token !== animToken) return;
      if(pausedNow()){ snapTo(Math.round(S.crate.pos)); return; }
      const dt = Math.min(48, now - last); last = now;
      v *= Math.exp(-0.0022 * dt);
      let pos = clamp(S.crate.pos + v * dt, 0, model.items.length - 1);
      S.crate.pos = pos;
      draw(clamp(Math.abs(v) * 40, 0, 1));
      if(Math.abs(v) > 0.00025 && pos > 0 && pos < model.items.length - 1){ rafHandle = requestAnimationFrame(step); }
      else snapTo(Math.round(pos));
    }
    rafHandle = requestAnimationFrame(step);
  }

  // ---- pointer / touch drag ----
  let dragState = null;
  stage.addEventListener('pointerdown', e => {
    if(e.button != null && e.button !== 0) return;
    cancelAnim();
    try{ stage.setPointerCapture(e.pointerId); }catch(err){}
    dragState = {startY:e.clientY, lastY:e.clientY, lastT:performance.now(), v:0, moved:false};
  });
  stage.addEventListener('pointermove', e => {
    if(!dragState) return;
    const now = performance.now();
    const dy = e.clientY - dragState.lastY;
    if(Math.abs(e.clientY - dragState.startY) > 3) dragState.moved = true;
    const dt = Math.max(1, now - dragState.lastT);
    const deltaPos = -dy / 70;
    S.crate.pos = clamp(S.crate.pos + deltaPos, 0, model.items.length - 1);
    const instV = deltaPos / dt;
    dragState.v = dragState.v * 0.7 + instV * 0.3;
    dragState.lastY = e.clientY; dragState.lastT = now;
    draw(clamp(Math.abs(dragState.v) * 60, 0, 1));
    e.preventDefault();
  });
  function endDrag(){
    if(!dragState) return;
    const v = dragState.v, moved = dragState.moved;
    dragState = null;
    if(!moved) return;   // a plain tap — the click handler below deals with it
    if(Math.abs(v) > 0.00035) momentumThenSnap(v);
    else snapTo(Math.round(S.crate.pos));
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- wheel / trackpad ----
  let wheelSnapTimer = null;
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    cancelAnim();
    const deltaPos = e.deltaY / 70;
    S.crate.pos = clamp(S.crate.pos + deltaPos, 0, model.items.length - 1);
    draw(clamp(Math.abs(deltaPos) * 3, 0, 1));
    clearTimeout(wheelSnapTimer);
    wheelSnapTimer = setTimeout(() => snapTo(Math.round(S.crate.pos)), 120);
  }, {passive:false});

  // ---- keyboard ----
  stage.addEventListener('keydown', e => {
    const cur = Math.round(S.crate.pos);
    if(e.key === 'ArrowDown'){ snapTo(cur + 1); e.preventDefault(); }
    else if(e.key === 'ArrowUp'){ snapTo(cur - 1); e.preventDefault(); }
    else if(e.key === 'PageDown'){ snapTo(cur + 5); e.preventDefault(); }
    else if(e.key === 'PageUp'){ snapTo(cur - 5); e.preventDefault(); }
    else if(e.key === 'Home'){ snapTo(0); e.preventDefault(); }
    else if(e.key === 'End'){ snapTo(model.items.length - 1); e.preventDefault(); }
    else if(e.key === 'Enter'){ const item = itemAt(cur); if(item && item.type === 'rec') openCrateAlbum(item); e.preventDefault(); }
    else if(e.key === ' '){ const item = itemAt(cur); if(item && item.type === 'rec') setQueue(item.idx, 0, true); e.preventDefault(); }
    else if(model.group === 'az' && /^[a-zA-Z]$/.test(e.key)){
      const target = crateRailJumpTarget(model, e.key.toUpperCase());
      if(target != null){ snapTo(target); e.preventDefault(); }
    }
  });

  // ---- tap a card: centre one scrolls to it, the centred one opens ----
  stage.addEventListener('click', e => {
    const cardEl = e.target.closest('.crate-card');
    if(!cardEl) return;
    let idx = null;
    pool.forEach((elC, i) => { if(elC === cardEl) idx = i; });
    if(idx == null) return;
    if(idx === Math.round(S.crate.pos)){
      const item = itemAt(idx);
      if(item.type === 'rec') openCrateAlbum(item);
    } else snapTo(idx);
  });

  // ---- rail drag-to-scrub, with the amber bubble ----
  let bubbleEl = null, scrubbing = false;
  function railEntryAtClientY(clientY){
    const entries = model.railEntries;
    if(!entries.length) return null;
    const rect = rail.getBoundingClientRect();
    const t = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const k = Math.round(t * (entries.length - 1));
    return entries[k];
  }
  rail.addEventListener('pointerdown', e => {
    const entry = railEntryAtClientY(e.clientY);
    if(!entry) return;
    scrubbing = true;
    cancelAnim();
    try{ rail.setPointerCapture(e.pointerId); }catch(err){}
    bubbleEl = document.createElement('div');
    bubbleEl.className = 'crate-rail-bubble';
    document.body.appendChild(bubbleEl);
    scrubMove(e);
    e.preventDefault();
  });
  function scrubMove(e){
    if(!scrubbing) return;
    const entry = railEntryAtClientY(e.clientY);
    if(!entry) return;
    bubbleEl.textContent = entry.label;
    bubbleEl.style.left = (e.clientX - 34 - 60) + 'px';
    bubbleEl.style.top = (e.clientY - 34) + 'px';
    if(entry.present && entry.itemIndex != null){ S.crate.pos = clamp(entry.itemIndex, 0, model.items.length - 1); draw(0.9); }
    scrubMove.lastEntry = entry;
  }
  rail.addEventListener('pointermove', e => { if(scrubbing){ scrubMove(e); e.preventDefault(); } });
  function endScrub(){
    if(!scrubbing) return;
    scrubbing = false;
    if(bubbleEl){ bubbleEl.remove(); bubbleEl = null; }
    const entry = scrubMove.lastEntry;
    if(entry && entry.present){ const target = crateRailJumpTarget(model, entry.key); if(target != null) snapTo(target); }
  }
  rail.addEventListener('pointerup', endScrub);
  rail.addEventListener('pointercancel', endScrub);

  draw(0);
  // info started out empty when applyCrateMiniInset() first ran above, so
  // its height was measured at the CSS min-height floor rather than its
  // real content height (title + artist + meta, sometimes a wrapped "Now
  // playing" chip). Now that draw(0) has filled it in, remeasure so the
  // stage doesn't claim room the info panel actually needs — without this,
  // using all available space (rather than banking a safety margin of dead
  // space) let the info panel's true height push past the mini player.
  applyCrateMiniInset();
  announceCurrent();
  scheduleLargeSwap();
  prewarmCrateAnchorL().catch(() => {});
}

// vertically centres the empty-library placeholder in whatever room is left
// under the header and above the tab bar, rather than always hugging the
// top — a one-off static block, unlike the scrollable track lists
export function centerEmptyState(){
  const empty = $('#empty');
  empty.style.marginTop = '0px';
  const tabbarEl = $('#tabbar');
  const tabbarH = tabbarEl ? tabbarEl.getBoundingClientRect().height : 0;
  const top = empty.getBoundingClientRect().top;
  const available = window.innerHeight - top - tabbarH - 16;
  const slack = available - empty.getBoundingClientRect().height;
  if(slack > 0) empty.style.marginTop = Math.round(slack / 2) + 'px';
}

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
    libraryReadyResolve();
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
  libraryReadyResolve();   // from here on the launch intro's library variant has what it needs
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
