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
import { thumbURL } from '../library/thumbs.js';
import { buildPeekDisc } from '../record-art/peek.js';
import { hapticTick } from '../ui/haptic.js';
import { wordmarkEl as buildWordmark } from '../ui/wordmark.js';

// resolved by restoreLibrary() (main.js) once S.tracks/sessions/thumbnails
// are in place — the launch intro races this against a timeout rather than
// ever blocking on it (see runLaunchSequence, "Never delay the app")
let libraryReadyResolve;
const libraryReadyPromise = new Promise(res => { libraryReadyResolve = res; });
export function markLibraryReady(){ libraryReadyResolve(); }

const LAUNCH_ANIM = {
  fadeMs: 250, accelMs: 650, cruiseMs: 800, decelMs: 800,
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
document.documentElement.style.setProperty('--launch-fade-duration', LAUNCH_ANIM.fadeMs + 'ms');
document.documentElement.style.setProperty('--launch-pull-duration', LAUNCH_ANIM.pullMs + 'ms');
document.documentElement.style.setProperty('--launch-wordmark-duration', (LAUNCH_ANIM.catchMs + LAUNCH_ANIM.pullMs) + 'ms');
document.documentElement.style.setProperty('--launch-skip-duration', LAUNCH_ANIM.skipMs + 'ms');

// TY4 (docs/22_TYPE.md): the launch header's wordmark is the drawn SVG now,
// not live text -- set once at module load, same as the CSS vars above.
$('#launchWordmark').replaceChildren(buildWordmark());

// the 390x740 design stage scales uniformly to fit the viewport rather than
// being redrawn per size — CSS alone can't turn a viewport length into a
// unitless scale() factor, so this is computed and written as a variable
function updateLaunchScale(){
  const s = Math.min(window.innerWidth / 390, window.innerHeight / 740);
  document.documentElement.style.setProperty('--launch-scale', s);
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
function makeLaunchCard(index, plan){
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
  if(index === LAUNCH_STACK.targetIndex) el.classList.add('launch-target');
  el.appendChild(face);
  return el;
}

export async function runLaunchSequence(){
  const token = ++S.launchSeq;
  const cancelled = () => token !== S.launchSeq;
  const overlay = $('#launchOverlay');

  updateLaunchScale();
  window.addEventListener('resize', updateLaunchScale);

  // wait for restoreLibrary() (so S.launchIntro is known), capped at 700ms
  await Promise.race([libraryReadyPromise, sleep(LAUNCH_ANIM.readyWaitMs)]);
  if(cancelled()) return;
  const stack = LAUNCH_STACK;
  // S.launchIntro's persisted value loads inside restoreLibrary(), which by
  // now has had at least this long to resolve it — now it's known for sure
  if(!S.launchIntro){ overlay.remove(); window.removeEventListener('resize', updateLaunchScale); return; }

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
    for(let i=lo;i<=hi;i++) if(!cards.has(i)){ const el = makeLaunchCard(i, plan); stackEl.appendChild(el); cards.set(i, el); }
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

  // FLICK: accelerate, cruise, decelerate — one position, driven by rAF
  {
    const timing = {accelMs: LAUNCH_ANIM.accelMs, cruiseMs: LAUNCH_ANIM.cruiseMs, decelMs: LAUNCH_ANIM.decelMs};
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

  // CATCH: the last-played sleeve lifts out of the stack (CR5's pull, the
  // crate's own way of taking a record out) and a haptic tick lands it
  // where the platform allows one (ui/haptic.js — silent on iOS Safari,
  // so the lift is what carries the moment there).
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

  // PULL TO CAMERA: the sleeve scales up to face-on while its record
  // slides out of the top in its own pressing (record-art/peek.js — the
  // same drawing as the crate's pull-up, rising to the same quarter of the
  // card); neighbours spread apart, dim and fade (opacity only, no blur);
  // the wordmark grows
  const wordmarkEl = $('#launchWordmark');
  wordmarkEl.classList.add('launch-grown');
  let peekEl = null;
  if(targetCard){
    const targetTrack = targetId != null ? (S.tracks.find(t => albumKey(t) === targetId) || null) : null;
    peekEl = buildPeekDisc(targetTrack);
    peekEl.classList.add('launch-peek');
    targetCard.insertBefore(peekEl, targetCard.firstChild);
  }
  const cardSize = targetCard ? (targetCard.offsetHeight || 278) : 278;
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

  // HAND-OFF: the app underneath is already on the empty slipmat with the
  // last-played album primed (main.js), so this is just the crossfade
  finishLaunch(LAUNCH_ANIM.crossfadeMs);
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
