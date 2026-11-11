/* ================= launch intro: a dig through your crate =================
   CEREMONY §5 replaced the original real-art riffle with a fixed stack of
   plain records caught on a "Miziki" sleeve; this pass (Ken, Oct 21 2026)
   brings it in line with the crate's own look and makes the catch mean
   something. Eighteen clean sleeves flick past: your own covers wherever
   their art is already in memory, the Miziki cover in every gap, so an
   empty library is all Miziki sleeves and a full one is all yours. The
   stack lands on the last-played album (the one main.js has already
   primed in the mini-player), which lifts out of the stack (no amber
   outline: CR1/CR8, amber never signals state) with a haptic tick where
   the platform allows one, then comes to camera with its record sliding
   out of the top in its own pressing (record-art/peek.js, the same peek
   the crate's pull-up draws) before cross-fading into the app.
   Never delays the app: restoreLibrary() (main.js) runs underneath it from
   the first paint, and no card ever waits for art — anything not already
   in memory gets the Miziki cover instead. Cold start only — see
   runLaunchSequence(). Fully independent of the sleeve pull/put-away: its
   own token (S.launchSeq), its own overlay, removed from the DOM once it
   finishes or is skipped. */
import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { clamp } from '../util/math.js';
import { albumKey, trackIdentityKey } from '../record-art/tiers.js';
import { albumTracks } from '../library/model.js';
import { queueSave } from '../storage/meta.js';
import { flowPose, flowZIndex } from '../crate/geometry.js';
import { crateArtCache, getCrateArtURL } from '../crate/tiers.js';
import { CRATE_PEEK_MAX_FRACTION } from '../crate/model.js';
import { CRATE_ORIGIN_Y, CRATE_DEPTH_SPREAD } from '../crate/constants.js';
import { thumbURL } from '../library/thumbs.js';
import { buildPeekDisc } from '../record-art/peek.js';
import { hapticTick } from '../ui/haptic.js';
import { wordmarkEl as buildWordmark } from '../ui/wordmark.js';
import { REDUCED } from '../util/motion.js';
import { isDesktopShell } from '../util/viewport.js';

// resolved by restoreLibrary() (main.js) once S.tracks/sessions/thumbnails
// are in place — the launch intro races this against a timeout rather than
// ever blocking on it (see runLaunchSequence, "Never delay the app")
let libraryReadyResolve;
const libraryReadyPromise = new Promise(res => { libraryReadyResolve = res; });
export function markLibraryReady(){ libraryReadyResolve(); }

const LAUNCH_ANIM = {
  fadeMs: 250, accelMs: 650, cruiseMs: 800, decelMs: 800,
  // LA3 (decision 18): crossfadeMs is the fallback-only hand-off now --
  // the crate card measured/not measured in time, respectively (see
  // runLaunchSequence's `landing` ? finishLaunch(0) : finishLaunch(crossfadeMs)).
  catchMs: 300, pullMs: 600, crossfadeMs: 600,
  liftPx: 28,
  skipMs: 150, readyWaitMs: 700,
  stackCount: 18,
  // distance share of the scroll each phase covers, by construction summing
  // to 1 so position lands exactly on the target at the end of decel — see
  // computeFlickPosition(). Proportions come from the reference timeline
  // (about 15:21:4 records for a 40-record flick).
  accelShare: 0.375, cruiseShare: 0.525, decelShare: 0.10
};
// LA1 (docs/36A_LIBRARY_AND_LAUNCH.md): the short variant's own dig
// timings, kept beside LAUNCH_ANIM rather than scattered -- a sixth the
// stack (6 records instead of 18, so the catch still lands four from the
// end, same as LAUNCH_STACK's own targetIndex formula) and the cruise
// phase cut hard (800ms -> 100ms) so the whole accel/cruise/decel flick
// comes in around 600ms. accel/decel are cut too (there's a lot less
// stack to cross), just not as drastically as cruise. The catch/pull/
// crossfade phases that follow the flick are unchanged -- they read
// LAUNCH_ANIM directly, not this block (decision 16: "the rest is the
// same as full").
const SHORT_LAUNCH_ANIM = {
  stackCount: 6,
  accelMs: 250, cruiseMs: 100, decelMs: 250,   // 600ms total
};
document.documentElement.style.setProperty('--launch-fade-duration', LAUNCH_ANIM.fadeMs + 'ms');
document.documentElement.style.setProperty('--launch-pull-duration', LAUNCH_ANIM.pullMs + 'ms');
document.documentElement.style.setProperty('--launch-skip-duration', LAUNCH_ANIM.skipMs + 'ms');

// TY4 (docs/22_TYPE.md): the launch header's wordmark is the drawn SVG now,
// not live text -- set once at module load, same as the CSS vars above.
$('#launchWordmark').replaceChildren(buildWordmark());

// the 390x740 design stage scales uniformly to fit the viewport rather than
// being redrawn per size — CSS alone can't turn a viewport length into a
// unitless scale() factor, so this is computed and written as a variable.
// LA3 (docs/36A_LIBRARY_AND_LAUNCH.md decision 21): on the desktop shell
// the stage fits the content area right of the sidebar, not the whole
// window — .launch-overlay itself is inset from the sidebar at that
// breakpoint (09-launch-intro.css/23-desktop.css), so the scale-to-fit
// math has to shrink its own available width by the same --sidebar-width
// or the stage would overflow past where the overlay is actually inset,
// landing short of (or on top of) the sidebar rather than centred in the
// space beside it.
function updateLaunchScale(){
  const sidebarWidth = isDesktopShell()
    ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 0)
    : 0;
  const s = Math.min((window.innerWidth - sidebarWidth) / 390, window.innerHeight / 740);
  document.documentElement.style.setProperty('--launch-scale', s);
}

// LA3 decision 18: the crate's own flowPose() params (CRATE_ORIGIN_Y, and
// the live --crate-card-size ratio CR/D5 already scales flowPose's spread
// by — see crate/view.js's own currentCardSize()/cardSpread, duplicated
// here rather than exported since it's three lines and crate/view.js
// can't be imported from here without a cycle (it already imports this
// file for resolveLastPlayedAlbum())
const BASE_CRATE_CARD_SIZE = 278;
function crateCardSpread(){
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--crate-card-size'));
  const size = (v > 0) ? v : BASE_CRATE_CARD_SIZE;
  return (size / BASE_CRATE_CARD_SIZE) * CRATE_DEPTH_SPREAD;
}

// The live crate's current card, measured and converted into the launch
// stage's own local (unscaled by --launch-scale) coordinate space — the
// same frame .launch-card's base box (left:56,top:128,278x278,
// 09-launch-intro.css) is defined in. Null when the crate isn't rendered
// yet (its card has no size), which is this step's documented fallback:
// the landing below then falls back to today's generic pull/cross-fade.
function measureCrateLanding(){
  const cardEl = document.querySelector('.crate-card.crate-current');
  const stage = document.querySelector('.launch-stage');
  if(!cardEl || !stage) return null;
  const cardRect = cardEl.getBoundingClientRect();
  if(!cardRect.width || !cardRect.height) return null;
  const stageRect = stage.getBoundingClientRect();
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--launch-scale')) || 1;
  return {
    left: (cardRect.left - stageRect.left) / scale,
    top: (cardRect.top - stageRect.top) / scale,
    width: cardRect.width / scale,
    height: cardRect.height / scale,
  };
}

// the key in S.albumLastPlayed with the largest timestamp; a library that
// has never been played falls back to the most recently added album.
// AU1 (docs/16_AUDIO.md §2.1): by the time either of this function's two
// callers (crate/view.js's cold-start anchor, and this file's own launch
// stack target below) run, main.js's restoreResume() has already loaded
// whatever record this device was paused on — "the launch intro and the
// crate already land on the last-played album; they should land on this
// same record." A resumed track may not have a qualifying S.albumLastPlayed
// entry at all (it was only ever loaded, never played to completion), so
// checking current() first is what keeps the two in step rather than
// recomputing a possibly different answer.
export function resolveLastPlayedAlbum(){
  const cur = current();
  if(cur) return albumKey(cur);
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
export function resolveLastPlayedTrackIndex(albumId){
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

// Eighteen sleeves, the last-played album caught four from the end. The
// count and target position never change with library size — only what's
// printed on each sleeve does (planLaunchStack()).
const LAUNCH_STACK = { count: LAUNCH_ANIM.stackCount, targetIndex: LAUNCH_ANIM.stackCount - 4 };
// LA1: the short variant's own (smaller) stack, same "caught four from the
// end" formula as LAUNCH_STACK above.
const SHORT_LAUNCH_STACK = { count: SHORT_LAUNCH_ANIM.stackCount, targetIndex: SHORT_LAUNCH_ANIM.stackCount - 4 };

// Which album goes on each of the stack's sleeves: the target album at
// targetIndex, and the other candidates (already ordered, best first)
// spread evenly through the remaining slots, so a small library reads as
// your covers with Miziki sleeves between rather than all at the front.
// null means the Miziki cover. Pure; exported for its unit test.
export function planLaunchStack(candidateIds, targetId, count, targetIndex){
  const plan = new Array(count).fill(null);
  if(targetId != null && targetIndex >= 0 && targetIndex < count) plan[targetIndex] = targetId;
  const others = [];
  for(let i = 0; i < count; i++) if(i !== targetIndex) others.push(i);
  const ids = candidateIds.filter(id => id != null && id !== targetId).slice(0, others.length);
  const k = ids.length;
  for(let j = 0; j < k; j++){
    plan[others[Math.floor(j * others.length / k)]] = ids[j];
  }
  return plan;
}

// An album's cover, but only if it's already sitting in memory right now —
// the crate's small tier, the persisted thumbnail, or the track's own
// embedded art. Never awaits anything: no art means the Miziki cover.
function launchArtNow(albumId){
  if(albumId == null) return null;
  const cached = crateArtCache.S.get(albumId);
  if(cached) return cached;
  if(thumbURL['album:' + albumId]) return thumbURL['album:' + albumId];
  const t = S.tracks.find(x => albumKey(x) === albumId);
  return (t && t.art) || null;
}

// The albums worth printing on the stack, best first: most recently
// played, then most recently added, and only ones with art in memory —
// an album with no cover to show adds nothing a Miziki sleeve doesn't.
function launchCandidates(){
  const seen = new Map();
  S.tracks.forEach(t => {
    const id = albumKey(t);
    const added = t.addedAt || 0;
    const prev = seen.get(id);
    if(!prev || added > prev.added) seen.set(id, {id, added});
  });
  const played = S.albumLastPlayed || {};
  return Array.from(seen.values())
    .filter(a => launchArtNow(a.id))
    .sort((a, b) => ((played[b.id] || 0) - (played[a.id] || 0)) || (b.added - a.added))
    .map(a => a.id);
}

// one scalar drives the whole flick: ease-in over accelMs, linear cruise,
// ease-out over decelMs, landing exactly on `target` (see LAUNCH spec §3).
// `timing` is {accelMs,cruiseMs,decelMs}.
// exported for its unit test, same as angleDelta in scrub.js (step 3c)
export function computeFlickPosition(elapsedMs, target, timing){
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
export function flickSpeed(elapsedMs, timing){
  const { accelMs, cruiseMs, decelMs } = timing;
  if(elapsedMs < accelMs) return elapsedMs / accelMs;
  if(elapsedMs < accelMs + cruiseMs) return 1;
  if(elapsedMs < accelMs + cruiseMs + decelMs) return 1 - (elapsedMs - accelMs - cruiseMs) / decelMs;
  return 0;
}

// thin adapter kept so every existing launch call site/shape is untouched —
// the actual geometry now lives in flowPose() alone (LAUNCH spec §3).
function launchCardPose(d, speed, spread){
  const a = Math.abs(d);
  const p = flowPose(a, d, speed, {spread});
  return { offset: p.y, tilt: p.rotX, scale: p.scale, depth: p.z, opacity: p.opacity,
    z: flowZIndex(a) };
}
function applyLaunchCardPose(el, pose, extraScale, liftPx){
  const scale = pose.scale * (extraScale == null ? 1 : extraScale);
  const y = pose.offset - (liftPx || 0);
  el.style.transform = 'translateY(' + y.toFixed(1) + 'px) translateZ(' + pose.depth.toFixed(1) + 'px) '
    + 'rotateX(' + pose.tilt.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')';
  el.style.opacity = pose.opacity;
  el.style.zIndex = pose.z;
}

// The Miziki cover: the wordmark's "F" cut, tilted -12deg (09-launch-intro.css
// rotates it; the SVG itself is always drawn upright) on a plain sleeve.
// Colour comes from --rec1/--rec2/--recink (09-launch-intro.css), keyed off
// the resolved data-theme, so it matches the app before first paint.
function launchMizikiMark(){
  const mark = document.createElement('div');
  mark.className = 'launch-card-mark';
  mark.appendChild(buildWordmark());
  return mark;
}

// One card's DOM: a clean sleeve showing either an album's cover or the
// Miziki cover. Only built for indices inside the visible window, never
// all at once.
function makeLaunchCard(index, plan, targetIndex){
  const el = document.createElement('div');
  el.className = 'launch-card';
  const face = document.createElement('div');
  face.className = 'launch-card-face';
  const art = launchArtNow(plan[index]);
  if(art){
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = art;
    face.appendChild(img);
  } else {
    face.classList.add('launch-card-miziki');
    face.appendChild(launchMizikiMark());
  }
  if(index === targetIndex) el.classList.add('launch-target');
  el.appendChild(face);
  return el;
}

// LA1 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 16): which variant plays --
// pure, so it's testable without a DOM. `reducedMotion` wins outright
// (`fade`): a dig, however short, is still more motion than Reduce Motion
// should ever show. Otherwise: `full` when no launch has played today yet
// (`lastLaunchAt` null, or from a different calendar day than `now`), or
// when the last launch was before today's sunset and `now` is at or past
// it (the first cold start after the day turns); every other cold start is
// `short`. `sunset` is a Date (or epoch ms) from Sundown's own day model
// (S.sun.set, real or the seasonal stand-in -- see sundown/day.js);
// `lastLaunchAt`/`now` are epoch ms.
export function chooseLaunchVariant({ lastLaunchAt, now, sunset, reducedMotion }){
  if(reducedMotion) return 'fade';
  if(lastLaunchAt == null) return 'full';
  const last = new Date(lastLaunchAt);
  const current = new Date(now);
  if(last.toDateString() !== current.toDateString()) return 'full';
  if(sunset != null){
    const sunsetMs = sunset instanceof Date ? sunset.getTime() : sunset;
    if(last.getTime() < sunsetMs && current.getTime() >= sunsetMs) return 'full';
  }
  return 'short';
}

// LA4 (docs/36A_LIBRARY_AND_LAUNCH.md decision 20): whether the dig plays
// at the short variant's own timing (stack count + accel/cruise/decel) --
// true for `short` itself, and also true for an empty library regardless
// of what `variant` otherwise is (an empty library's very first cold
// start would otherwise be `full`, per chooseLaunchVariant() above, but
// decision 20 asks for "the short length" specifically). Pure, exported
// for its unit test the same reason chooseLaunchVariant() is.
export function usesShortDig(variant, tracksEmpty){
  return variant === 'short' || !!tracksEmpty;
}

// LA3: applies an exact-landing pose (tx/ty/z/rot/scale/opacity, in the
// same local units as the launch card's base box) directly as a
// transform/opacity pair -- pulled out to module scope (no closure over
// runLaunchSequence's own `cards`/`stack`) purely to keep that already-
// long sequence function from growing further; see its own comment.
function applyExactPose(el, pose){
  el.style.transform = 'translateX(' + pose.tx.toFixed(1) + 'px) translateY(' + pose.ty.toFixed(1) + 'px) translateZ(' + pose.z.toFixed(1) + 'px) '
    + 'rotateX(' + pose.rot.toFixed(2) + 'deg) scale(' + Math.max(0.001, pose.scale).toFixed(3) + ')';
  el.style.opacity = pose.opacity;
}
function lerp(a, b, t){ return a + (b - a) * t; }

// LA3 (docs/36A_LIBRARY_AND_LAUNCH.md decision 19/21): the room the
// overlay hands off to starts dim and 8px low (09-launch-intro.css's own
// .launch-room rules) and fills back in top-down rather than all at once.
// `.launch-room` itself goes on well before the hand-off, while the
// overlay still covers the whole screen (see runLaunchSequence below), so
// there's nothing to see yet; these four steps only run once the overlay
// is actually hiding (from finishLaunch()). Reduced motion shows every
// room element at rest regardless of these classes (same media query,
//09-launch-intro.css) so no branch is needed here for that case.
const ROOM_STEPS = ['room-info-in', 'room-bars-in', 'room-header-in', 'room-neighbour-in'];
const ROOM_STEP_DELAYS = [0, 100, 200, 300];
function revealRoom(root){
  if(!root) return;
  ROOM_STEPS.forEach((cls, i) => setTimeout(() => root.classList.add(cls), ROOM_STEP_DELAYS[i]));
  const cleanupAt = ROOM_STEP_DELAYS[ROOM_STEP_DELAYS.length - 1] + 200;   // last step's own 200ms ease-out
  setTimeout(() => root.classList.remove('launch-room', ...ROOM_STEPS), cleanupAt);
}

// Rule 13 (CLAUDE.md): already well over ~80 lines before LA3, and grown
// further here (the exact-landing math, decision 18) -- kept as one
// function because it's a single linear ceremony (fade -> flick -> catch
// -> land -> hand-off) sharing one `cancelled()`/`token` closure the same
// way src/shell/player-overlay.js's/put-away.js's own open/close
// ceremonies do; splitting it across files would scatter that shared
// cancellation state rather than shrink it. Every piece of real math
// (measureCrateLanding/crateCardSpread/applyExactPose/startPoseFor/
// endPoseFor/revealRoom) is already pulled out above/inline where it
// doesn't need this function's own closure.
export async function runLaunchSequence(){
  const token = ++S.launchSeq;
  const cancelled = () => token !== S.launchSeq;
  const overlay = $('#launchOverlay');

  updateLaunchScale();
  window.addEventListener('resize', updateLaunchScale);

  // wait for restoreLibrary() (so S.launchIntro is known), capped at 700ms
  await Promise.race([libraryReadyPromise, sleep(LAUNCH_ANIM.readyWaitMs)]);
  if(cancelled()) return;
  // S.launchIntro's persisted value loads inside restoreLibrary(), which by
  // now has had at least this long to resolve it — now it's known for sure
  if(!S.launchIntro){ overlay.remove(); window.removeEventListener('resize', updateLaunchScale); return; }

  // LA1: the variant, decided once S.lastLaunchAt (also loaded inside
  // restoreLibrary(), same race as S.launchIntro above) and S.sun (set
  // synchronously at boot by main.js's fallbackSun(), before this ever
  // runs) are both known. Recorded regardless of which variant plays, so
  // the *next* cold start's own decision is correct.
  const launchNow = Date.now();
  const variant = chooseLaunchVariant({
    lastLaunchAt: S.lastLaunchAt,
    now: launchNow,
    sunset: (S.sun && S.sun.ok) ? S.sun.set : null,
    reducedMotion: REDUCED,
  });
  S.lastLaunchAt = launchNow;
  queueSave();

  // LA4 (docs/36A_LIBRARY_AND_LAUNCH.md decision 20): "the dig uses Miziki
  // sleeves only, at the short length" -- an empty library always gets the
  // short variant's own dig timing (stack count, accel/cruise/decel), even
  // on the very first cold start ever, when chooseLaunchVariant() above
  // would otherwise say `full` (no S.lastLaunchAt yet). Not a fourth
  // variant of its own: `fade` (Reduce Motion) still wins outright, same
  // as any other cold start, and every phase after the dig (catch/pull/
  // room) is already unchanged by variant -- only the two blocks below
  // that branch on `variant === 'short'` need this folded in. The stack
  // itself needs no special-casing to come out "Miziki sleeves only": with
  // S.tracks empty, launchCandidates() is already `[]` and
  // resolveLastPlayedAlbum() is already `null` (see its own test), so
  // planLaunchStack() already fills every sleeve with the Miziki cover.
  const shortDig = usesShortDig(variant, S.tracks.length === 0);

  // fade: Reduce Motion. No card stack, no flick -- just the app, same as
  // this call site's own behavior before LA1 (the overlay is also
  // `display:none` under this same media query, 09-launch-intro.css, so
  // this is belt-and-suspenders consistent with every other REDUCED check
  // in this codebase rather than a visible behavior change).
  if(variant === 'fade'){
    overlay.remove();
    window.removeEventListener('resize', updateLaunchScale);
    return;
  }

  // LA3: the room underneath goes dim/8px-low right away -- harmless since
  // the overlay still covers the whole screen at this point -- so there's
  // no race between the overlay hiding and the room's own starting state
  // further down (finishLaunch() only starts revealing it back in).
  const appRoot = document.getElementById('app') || document.body;
  appRoot.classList.add('launch-room');

  const stack = shortDig ? SHORT_LAUNCH_STACK : LAUNCH_STACK;

  // What's printed on each sleeve, decided once, from whatever the library
  // has restored by now (the same ready race above — never waited on
  // further). The target is the album main.js primes in the mini-player.
  const targetId = resolveLastPlayedAlbum();
  const plan = planLaunchStack(launchCandidates(), targetId, stack.count, stack.targetIndex);

  const stackEl = $('#launchStack');
  const cards = new Map();   // index -> element, only for the currently-visible window
  function syncCards(position, speed, spread){
    const lo = Math.max(0, Math.floor(position) - 8), hi = Math.min(stack.count - 1, Math.ceil(position) + 8);
    for(const i of Array.from(cards.keys())) if(i < lo || i > hi){ cards.get(i).remove(); cards.delete(i); }
    for(let i=lo;i<=hi;i++) if(!cards.has(i)){ const el = makeLaunchCard(i, plan, stack.targetIndex); stackEl.appendChild(el); cards.set(i, el); }
    cards.forEach((el, i) => applyLaunchCardPose(el, launchCardPose(i - position, speed, spread)));
  }
  syncCards(0, 0, 1);

  // The one sleeve worth asking for: if the last-played album's cover isn't
  // in memory yet, build its crate tier in the background. It nearly always
  // arrives during the ~2.25s flick; if it doesn't, the catch simply shows
  // the Miziki cover. Nothing ever waits on this.
  if(targetId != null && !launchArtNow(targetId)){
    getCrateArtURL(targetId, 'S').then(url => {
      if(!url || cancelled()) return;
      const card = cards.get(stack.targetIndex);
      const face = card && card.querySelector('.launch-card-miziki');
      if(face){
        face.classList.remove('launch-card-miziki');
        face.textContent = '';
        const img = document.createElement('img');
        img.alt = ''; img.decoding = 'async'; img.src = url;
        face.appendChild(img);
      }
    }).catch(() => {});
  }

  // swallow the first tap anywhere on the overlay: snap to the end instantly
  // rather than letting it also press whatever is underneath
  const skip = e => {
    e.stopPropagation(); e.preventDefault();
    S.launchSeq++;   // cancel the running sequence
    finishLaunch();
  };
  overlay.addEventListener('pointerdown', skip, {capture:true});

  function finishLaunch(fadeMs){
    // LA3: fadeMs===0 (the exact-landing case) means hide in one frame, not
    // "no fadeMs given" -- `0 || skipMs` would wrongly fall back to the
    // 150ms skip fade, so an explicit null/undefined check is needed here
    // now that 0 is itself a meaningful value this function is called with.
    const fade = (fadeMs == null) ? LAUNCH_ANIM.skipMs : fadeMs;
    overlay.removeEventListener('pointerdown', skip, {capture:true});
    window.removeEventListener('resize', updateLaunchScale);
    overlay.style.transition = 'opacity ' + fade + 'ms linear';
    overlay.classList.add('launch-hidden');
    setTimeout(() => { if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }, fade);
    // LA3 (decision 19/21): the room underneath starts filling back in the
    // moment the overlay actually starts hiding, whichever way this
    // sequence ended (exact landing, the readyWaitMs fallback, or a tap
    // to skip) -- revealRoom() itself owns the top-down timing/cleanup.
    revealRoom(appRoot);
  }

  // STACK fades up, resting on record 0
  void stackEl.offsetWidth;
  stackEl.classList.add('launch-settled');
  await sleep(LAUNCH_ANIM.fadeMs);
  if(cancelled()) return;

  // FLICK: accelerate, cruise, decelerate — one position, driven by rAF
  // LA2: the one mark (#launchWordmark) fades to 70% for the dig, same
  // phase this flick covers.
  const wordmarkEl = $('#launchWordmark');
  wordmarkEl.classList.add('launch-digging');
  {
    // LA1: short swaps in its own cut accel/cruise/decel timings; every
    // other phase (fade/catch/pull/crossfade) stays LAUNCH_ANIM's, below.
    // LA4: an empty library gets this same cut timing even when `variant`
    // itself is `full` (see `shortDig` above).
    const timing = shortDig
      ? {accelMs: SHORT_LAUNCH_ANIM.accelMs, cruiseMs: SHORT_LAUNCH_ANIM.cruiseMs, decelMs: SHORT_LAUNCH_ANIM.decelMs}
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

  // LA3 (decision 18, step 1 -- "before the catch, read the live
  // .crate-card.crate-current's getBoundingClientRect()"): the crate has
  // been rendering underneath this whole overlay since the first paint
  // (restoreLibrary(), main.js), and by now the ~2s-plus flick above has
  // given it every chance to settle, so no further wait is added here
  // beyond the readyWaitMs race already run at the top of this function.
  // Null (crate not there, or sized 0 -- not ready in time) falls back to
  // today's generic pull/cross-fade landing below, unchanged.
  const landing = measureCrateLanding();

  // CATCH: the last-played sleeve lifts out of the stack (CR5's pull, the
  // crate's own way of taking a record out) and a haptic tick lands it
  // where the platform allows one (ui/haptic.js — silent on iOS Safari,
  // so the lift is what carries the moment there).
  // LA2: the mark fades further, to 25%, for the catch -- and stays there
  // through pull/crossfade (it never moves to the bottom or grows).
  wordmarkEl.classList.add('launch-caught');
  const targetCard = cards.get(stack.targetIndex);
  if(targetCard){
    hapticTick();
    targetCard.classList.add('launch-lifted');
    const liftStart = performance.now();
    await new Promise(resolve => {
      function step(now){
        if(cancelled()){ resolve(); return; }
        const p = clamp((now - liftStart) / LAUNCH_ANIM.catchMs, 0, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        applyLaunchCardPose(targetCard, launchCardPose(0, 0, 1), 1, LAUNCH_ANIM.liftPx * eased);
        if(p >= 1){ resolve(); return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  } else {
    await sleep(LAUNCH_ANIM.catchMs);
  }
  if(cancelled()) return;

  // PULL TO CAMERA / LAND: the sleeve's record slides out of the top in
  // its own pressing (record-art/peek.js — the same drawing as the
  // crate's pull-up, rising to the same quarter of the card) while the
  // sleeve itself animates to its landing pose. The mark (#launchWordmark)
  // stays put at the top, already at its 25% catch opacity set above
  // (LA2) -- it never grows or moves down here.
  let peekEl = null;
  if(targetCard){
    const targetTrack = targetId != null ? (S.tracks.find(t => albumKey(t) === targetId) || null) : null;
    peekEl = buildPeekDisc(targetTrack);
    peekEl.classList.add('launch-peek');
    targetCard.insertBefore(peekEl, targetCard.firstChild);
  }
  const cardSize = targetCard ? (targetCard.offsetHeight || 278) : 278;

  // the pose each card is already in, right after CATCH -- the lerp start
  // for the exact-landing branch below (see endPoseFor/applyExactPose)
  function startPoseFor(i){
    if(i === stack.targetIndex){
      const p = launchCardPose(0, 0, 1);
      return {tx:0, ty:p.offset - LAUNCH_ANIM.liftPx, z:p.depth, rot:p.tilt, scale:p.scale, opacity:p.opacity};
    }
    const p = launchCardPose(i - stack.targetIndex, 0, 1);
    return {tx:0, ty:p.offset, z:p.depth, rot:p.tilt, scale:p.scale, opacity:p.opacity};
  }

  if(landing){
    // LA3 (decision 18, steps 1-2): land exactly on the live crate card --
    // the target card's end pose comes straight from the measured rect
    // (position, size) plus flowPose()'s own tilt for the current card
    // (0, for d=0); every other card's end pose is the crate's own
    // flowPose(originY: CRATE_ORIGIN_Y, spread: crateCardSpread())
    // formula, calibrated by the same scale correction the target needed
    // -- the crate's own stack, not launch's generic "spread apart and
    // dim" flourish the `else` branch (today's fallback landing) below
    // still draws.
    const spread = crateCardSpread();
    const poseTarget = flowPose(0, 0, 0, {originY: CRATE_ORIGIN_Y, spread});
    const predictedTargetWidth = 278 * poseTarget.scale;
    const scaleCorrection = landing.width / predictedTargetWidth;
    const baseCenterX = 56 + 139, baseCenterY = 128 + 139;   // .launch-card's base box, centred
    const targetCenterX = landing.left + landing.width / 2;
    const targetCenterY = landing.top + landing.height / 2;
    const tx = targetCenterX - baseCenterX;
    const targetScale = landing.width / 278;
    function endPoseFor(i){
      const d = i - stack.targetIndex, a = Math.abs(d);
      if(d === 0) return {tx, ty: targetCenterY - baseCenterY, z: 0, rot: poseTarget.rotX, scale: targetScale, opacity: 1};
      const pose = flowPose(a, d, 0, {originY: CRATE_ORIGIN_Y, spread});
      return {
        tx,
        ty: (targetCenterY - baseCenterY) + (pose.y - poseTarget.y) * scaleCorrection,
        z: pose.z * scaleCorrection,
        rot: pose.rotX,
        scale: targetScale * (pose.scale / poseTarget.scale),
        opacity: pose.opacity,
      };
    }
    const pullStart = performance.now();
    await new Promise(resolve => {
      function step(now){
        if(cancelled()){ resolve(); return; }
        const p = clamp((now - pullStart) / LAUNCH_ANIM.pullMs, 0, 1);
        const eased = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2;   // ease-in-out
        cards.forEach((el, i) => {
          const start = startPoseFor(i), end = endPoseFor(i);
          applyExactPose(el, {
            tx: lerp(start.tx, end.tx, eased), ty: lerp(start.ty, end.ty, eased),
            z: lerp(start.z, end.z, eased), rot: lerp(start.rot, end.rot, eased),
            scale: lerp(start.scale, end.scale, eased), opacity: lerp(start.opacity, end.opacity, eased),
          });
        });
        if(peekEl) peekEl.style.transform = 'translateY(' + (-(cardSize * CRATE_PEEK_MAX_FRACTION * eased)).toFixed(1) + 'px)';
        if(p >= 1){ resolve(); return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    if(cancelled()) return;
  } else {
    // fallback (decision 18, step 1's own "if the crate isn't ready in
    // time"): today's landing -- the sleeve scales up to face-on,
    // neighbours spread apart, dim and fade (opacity only, no blur).
    const pullStart = performance.now();
    await new Promise(resolve => {
      function step(now){
        if(cancelled()){ resolve(); return; }
        const p = clamp((now - pullStart) / LAUNCH_ANIM.pullMs, 0, 1);
        const eased = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2;   // ease-in-out
        const spread = 1 + 1.2*eased;   // neighbours spread ~1.7x-2.2x by the end
        cards.forEach((el, i) => {
          if(i === stack.targetIndex){ applyLaunchCardPose(el, launchCardPose(0, 0, 1), 0.86 + 0.14*eased, LAUNCH_ANIM.liftPx); return; }
          const pose = launchCardPose(i - stack.targetIndex, 0, spread);
          pose.opacity = Math.max(0, pose.opacity) * (1 - 0.9*eased);
          applyLaunchCardPose(el, pose);
        });
        if(peekEl) peekEl.style.transform = 'translateY(' + (-(cardSize * CRATE_PEEK_MAX_FRACTION * eased)).toFixed(1) + 'px)';
        if(p >= 1){ resolve(); return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    if(cancelled()) return;
  }

  // HAND-OFF: the app underneath is already on the empty slipmat with the
  // last-played album primed (main.js). LA3 (decision 18): an exact
  // landing just stops drawing in one frame -- no cross-fade, since the
  // two covers already agree pixel-for-pixel. The fallback path (the
  // crate wasn't ready in time) keeps today's 600ms cross-fade, since
  // there's nothing exact to cut to instantly.
  finishLaunch(landing ? 0 : LAUNCH_ANIM.crossfadeMs);
}

export function attachLaunchSettingRow(){
  const b = $('#launchIntroBtn');
  if(!b) return;
  b.setAttribute('aria-checked', String(S.launchIntro));
}
export function toggleLaunchIntro(){
  S.launchIntro = !S.launchIntro;
  attachLaunchSettingRow();
  queueSave();
}
