/* ================= launch intro: crate riffle to a title screen =================
   Moved out of main.js (step 7c). Cold start only — see runLaunchSequence().
   Fully independent of the sleeve pull/put-away: its own token
   (S.launchSeq), its own overlay, removed from the DOM once it finishes or
   is skipped. Never delays the app — restoreLibrary() (main.js) runs
   underneath it from the first paint. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { clamp } from '../util/math.js';
import { albumKey, trackIdentityKey } from '../record-art/tiers.js';
import { albumTracks, groupBy } from '../library/model.js';
import { thumbURL } from '../library/thumbs.js';
import { queueSave } from '../storage/meta.js';
import { flowPose, flowZIndex } from '../crate/geometry.js';
import { crateArtCache } from '../crate/tiers.js';

// resolved by restoreLibrary() (main.js) once S.tracks/sessions/thumbnails
// are in place — the launch intro races this against a timeout rather than
// ever blocking on it (see runLaunchSequence, "Never delay the app")
let libraryReadyResolve;
const libraryReadyPromise = new Promise(res => { libraryReadyResolve = res; });
export function markLibraryReady(){ libraryReadyResolve(); }

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
export function resolveLastPlayedAlbum(){
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

// Evenly samples down to `cap` entries, always keeping mustIncludeId among
// them (see LAUNCH spec §1, flick-length rule, A > 50 case). Exported for
// its unit test, same as angleDelta in scrub.js (step 3c).
export function sampleStackAlbums(allIds, cap, mustIncludeId){
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

// Pure-ish DOM builder, split out so a malicious tag value's handling is
// testable without the rest of runLaunchSequence's choreography (security
// hardening, step 01 — the last-played artist is untrusted file-tag text,
// so this must never reach innerHTML).
export function renderLaunchTitleSub(subEl, artist){
  subEl.textContent = '';
  subEl.appendChild(document.createTextNode(artist || ''));
  subEl.appendChild(document.createElement('br'));
  const lastPlayedEl = document.createElement('span');
  lastPlayedEl.style.color = 'var(--accent)';
  lastPlayedEl.textContent = 'LAST PLAYED';
  subEl.appendChild(lastPlayedEl);
}

export async function runLaunchSequence(){
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
    renderLaunchTitleSub(subEl, stack.targetArtist);
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
export function toggleLaunchIntro(){
  S.launchIntro = !S.launchIntro;
  attachLaunchSettingRow();
  queueSave();
}
