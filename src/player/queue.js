/* ================= queue, shuffle, repeat =================
   Moved out of main.js (step 5a), together with the "visible queue"
   section's advance()/preloadNextTrack() — see CLAUDE.md. The rest of the
   "visible queue" section (queueInsert/playNext/addToQueue, queueRemoveAt,
   queueMove, the queue-sheet UI) moved in here too, in step 5e. */
import { S, current } from '../state.js';
import { $, el } from '../util/dom.js';
import { albumKey, trackTier } from '../record-art/tiers.js';
import { sleepStopPlayback } from './sleep-timer.js';
import { load, play, pause, seek, sideLetterFor, cancelPendingGapless } from './transport.js';
import { drawTime } from './clock.js';
import { ensureBuffer } from './buffers.js';
import { invalidateActiveSessionIfAny } from '../history/sessions.js';
import { runStartSequence } from '../shell/start-sequence.js';
import { openPlayerViaSheet } from '../shell/player-overlay.js';
import { endOfQueue, maybeSideFlip } from '../shell/runout.js';
import { openLayer } from '../shell/nav-stack.js';
import { REDUCED } from '../util/motion.js';
import {
  releaseSeed, noiseFloorScale, surfaceNoiseActive,
  playNeedleLift, playSkipDrop, fadeMusicTo,
  SKIP_LIFT_MS, SKIP_AIR_MS, SKIP_FADE_MS
} from '../audio/surface-noise.js';

export function buildOrder(first){
  const rest = S.baseQueue.filter(i => i !== first);
  for(let i = rest.length - 1; i > 0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  S.queue = (first === undefined || first === null) ? rest : [first].concat(rest);
}

export function setQueue(indices, startPos, autoplay){
  invalidateActiveSessionIfAny();
  S.baseQueue = indices.slice();
  const first = indices[startPos];
  if(S.shuffle) buildOrder(first); else S.queue = S.baseQueue.slice();
  S.qpos = Math.max(0, S.queue.indexOf(first));
  load(S.queue[S.qpos]);
  if(!autoplay){
    // silent queue-priming (restoring a persisted library on boot) is not a
    // ceremony — nothing is "arriving," so the disc just appears as-is
    // instead of sitting hidden forever with no pull ever coming to reveal it
    $('#platterBox').classList.remove('disc-hidden');
    return;
  }
  // an explicit track pick (as opposed to the silent initial queue-priming
  // calls, which pass autoplay:false) is always "starting something" —
  // opens the full player via the sheet, not the mini-player's morph.
  // Audio itself is strictly gated behind whichever ceremony runs, never
  // started up front — see runStartSequence().
  if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
  else openPlayerViaSheet(current(), S.pendingShellInfo);
}

export function reorderQueue(){
  cancelPendingGapless();   // AU4 (docs/16_AUDIO.md §2.4): a queue edit invalidates whatever was pre-armed
  const cur = S.index;
  if(!S.baseQueue.length) return;
  if(S.shuffle) buildOrder(cur >= 0 ? cur : undefined);
  else S.queue = S.baseQueue.slice();
  S.qpos = Math.max(0, S.queue.indexOf(cur));
}

// Mirrors advance(1, true)'s own index math (natural end-of-track,
// repeat-all wraparound) without mutating any state — used to know what to
// preload before it's actually time to play it (see PLAYBACK spec §1).
// Exported since AU4 (docs/16_AUDIO.md §2.4) needs the exact same "what
// would advance(1, true) move to" answer to decide what to pre-schedule.
export function peekNextIndex(){
  if(!S.queue.length) return null;
  if(S.repeat === 'one') return S.queue[S.qpos];
  let n = S.qpos + 1;
  if(n >= S.queue.length){
    if(S.repeat === 'all') n = 0;
    else return null;
  }
  return S.queue[n];
}

// Kicked off whenever a track starts, so whatever plays next has already
// finished decoding by the time this one's onended fires — decode latency,
// not JS scheduling overhead, was the actual cause of the gap between
// tracks. See PLAYBACK spec §1: "no buffer underrun."
export function preloadNextTrack(){
  const nextIdx = peekNextIndex();
  if(nextIdx === null || nextIdx === undefined) return;
  if(nextIdx === S.index) return;
  const nt = S.tracks[nextIdx];
  if(!nt || nt.buffer) return;
  ensureBuffer(nextIdx).catch(()=>{});
}

export function advance(dir, auto){
  if(!S.queue.length) return;
  if(auto && S.repeat === 'one'){ seek(0); if(!S.playing) play(); return; }
  if(auto && S.sleep.mode === 'track'){ sleepStopPlayback(); return; }
  if(auto && S.sleep.mode === 'album'){
    const curT = S.tracks[S.queue[S.qpos]];
    const n2 = S.qpos + dir;
    const nextT = (n2 >= 0 && n2 < S.queue.length) ? S.tracks[S.queue[n2]] : null;
    if(curT && (!nextT || albumKey(nextT) !== albumKey(curT))){ sleepStopPlayback(); return; }
  }
  if(!auto) invalidateActiveSessionIfAny();     // an explicit next/prev press is a skip
  let n = S.qpos + dir;
  if(n >= S.queue.length){
    if(S.repeat === 'all'){ if(S.shuffle) buildOrder(); n = 0; }
    else {
      pause(); S.pos = 0; drawTime();
      // a real finish rides the run-out groove, goes back in its sleeve and
      // clears to the empty slipmat (CEREMONY §2); a manual skip past the
      // last track just stops, as it always has
      endOfQueue(auto);
      return;        // end of the record
    }
  }
  if(n < 0) n = S.repeat === 'all' ? S.queue.length - 1 : 0;
  if(auto && maybeSideFlip(n)) return;   // side A ran out: turn the record over first (CEREMONY §3)
  S.qpos = n;
  load(S.queue[n]);
  // next/prev/auto-advance never open the player themselves — but if it's
  // already open (sitting in it, or mid next/prev), there's no sheet or
  // morph to wait for, so the disc ceremony (if any) runs immediately.
  // With the player closed there's nothing to see, so audio just starts.
  if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
  else play();
}

/* ================= §3 (docs/15_SURFACE_NOISE.md): needle-lift skipping =================
   A manual skip -- Next, Previous, or the "restart the current track"
   case Previous falls back to past a few seconds in (src/player/
   controls.js) -- lifts and re-drops the needle instead of cutting
   silently. Natural track-end advances (auto===true, above) are
   completely untouched: no lift there, by §3's own "natural transitions
   are unchanged" rule -- this is a second entry point into the queue, not
   a change to advance() itself. Lock-screen/headphone/car Next/Previous
   go through the exact same function (they call src/player/controls.js's
   nextTrack()/prevTrack(), same as a tap) -- §3 only asks for those to be
   *shorter*, which naturally falls out of there being no Surface Noise
   bed (Off/Pure) or, with it on, no screen to show the platter dip on
   either way, so the one real difference is already covered without a
   separate "from the lock screen" branch.

   Scope note: §3's own "skipping past the last track of a side behaves
   like the side ending" rule needs the Auto-flip/run-out-wait state
   machine docs/15_SURFACE_NOISE.md §4 describes -- that's PR3's own
   territory per the spec's build order ("3. depends on 1's run-out and
   timeout"). For now, landing past the end of the queue (nothing for a
   lift to resolve onto) just falls straight through to the existing,
   un-lifted advance()/endOfQueue() path, same as every skip always has.

   Why setTimeout and not the Web Audio-clock pre-scheduling PR1's own
   lead-in uses: by the time a skip can happen, playback (and so S.ctx)
   is already running -- nothing here resumes a suspended context or
   starts an <audio> element for the first time, the two things iOS
   actually gates on a live user gesture (refactor rule 9). advance()'s
   own natural-end path already calls play() from a non-gesture context
   today (src.onended, startSource() above) with no special handling, so
   deferring the "drop" half of a skip past the original tap the same way
   is nothing new. What rule 9 still protects here untouched: no await
   was added before play()'s own first bgPrime() call, and S.gen/onended
   are read, never written, by anything in this section. */
let pendingSkip = null;   // {dir} while a lift is in flight -- see skipWithLift()

// Mirrors advance(dir, false)'s own index math with no state mutation, so
// a repeated tap mid-lift can ask "where would this land right now"
// without moving S.qpos until the drop actually fires. null means "past
// the end with nothing to wrap to" -- the one case this function defers
// to the plain, un-lifted advance() path (see the scope note above).
function resolveSkipTarget(dir){
  if(!S.queue.length) return null;
  let n = S.qpos + dir;
  if(n >= S.queue.length) return S.repeat === 'all' ? 0 : null;
  if(n < 0) n = S.repeat === 'all' ? S.queue.length - 1 : 0;
  return n;
}

// §3's own "visual nudge... otherwise the platter dips slightly" (there's
// no separate stylus/tonearm indicator in this app to lift instead). A
// plain class toggle, same "CSS does the animation, JS just flips a
// class" shape as every sleeve/platter state elsewhere in shell/ --
// skipped outright under Reduce Motion, per this doc's own principle
// ("sounds and haptics remain" but animations don't run).
function setPlatterLift(on){
  const box = $('#platterBox');
  if(box) box.classList.toggle('skip-lift', on);
}

// dir: 1 (next), -1 (previous track), or 0 (restart the current track --
// Previous past the first few seconds, src/player/controls.js). Every
// call invalidates any in-progress qualifying session immediately, the
// same "manual skip" rule reorderQueue/queueRemoveAt/etc. already follow
// below, rather than waiting for the drop to actually land.
export function skipWithLift(dir){
  invalidateActiveSessionIfAny();
  cancelPendingGapless();   // AU4: a manual skip invalidates whatever was pre-armed for the natural next track
  if(pendingSkip){ pendingSkip.dir = dir; return; }   // §3 "rapid skips collapse"
  if(dir !== 0 && resolveSkipTarget(dir) === null){ advance(dir, false); return; }
  const t = current();
  const scale = t ? noiseFloorScale(S.surfaceNoise, trackTier(t)) : 0;
  const active = surfaceNoiseActive() && scale > 0;
  const seed = t ? releaseSeed(albumKey(t), sideLetterFor(t, S.index)) : 0;
  const rateHz = 0.55 * S.rate;
  pendingSkip = { dir };
  fadeMusicTo(0, SKIP_FADE_MS);
  if(active){ playNeedleLift(); if(!REDUCED) setPlatterLift(true); }
  const liftMs = active ? (SKIP_LIFT_MS + SKIP_AIR_MS) : SKIP_FADE_MS;
  setTimeout(() => {
    const d = pendingSkip ? pendingSkip.dir : dir;
    pendingSkip = null;
    if(active) playSkipDrop(seed, scale, rateHz);
    setPlatterLift(false);
    if(d === 0) seek(0); else advance(d, false);
    fadeMusicTo(1, active ? SKIP_FADE_MS : 0);
  }, liftMs);
}

/* ================= visible queue: reorder, remove, play next / add =================
   Shows the current track plus everything after it. Reordering or removing
   is manual queue manipulation, same as shuffle/skip, so it silently
   invalidates whatever qualifying session is in progress — no warning, no
   prompt (see PLAYBACK spec §5). */
function queueInsert(idx, mode){
  if(idx === S.index) return;   // already playing; nothing to insert
  invalidateActiveSessionIfAny();
  cancelPendingGapless();   // AU4: a queue edit invalidates whatever was pre-armed
  if(!S.baseQueue.includes(idx)) S.baseQueue.push(idx);
  const existing = S.queue.indexOf(idx, S.qpos + 1);
  if(existing !== -1) S.queue.splice(existing, 1);
  const insertAt = mode === 'next' ? S.qpos + 1 : S.queue.length;
  S.queue.splice(Math.min(insertAt, S.queue.length), 0, idx);
  renderQueueSheet();
}
export function playNext(idx){ queueInsert(idx, 'next'); }
export function addToQueue(idx){ queueInsert(idx, 'end'); }

// pos is an offset into the "upcoming" portion (0 = the track right after
// current) — the current track itself is shown but never removable here,
// that's what skip is for
function queueRemoveAt(pos){
  const queueIdx = S.qpos + 1 + pos;
  if(queueIdx <= S.qpos || queueIdx >= S.queue.length) return;
  invalidateActiveSessionIfAny();
  cancelPendingGapless();   // AU4: a queue edit invalidates whatever was pre-armed
  S.queue.splice(queueIdx, 1);
  renderQueueSheet(queueSheetHost);
}
function queueMove(pos, dir){
  const queueIdx = S.qpos + 1 + pos;
  const n = queueIdx + dir;
  if(queueIdx <= S.qpos || queueIdx >= S.queue.length || n <= S.qpos || n >= S.queue.length) return;
  invalidateActiveSessionIfAny();
  cancelPendingGapless();   // AU4: a queue edit invalidates whatever was pre-armed
  const tmp = S.queue[queueIdx]; S.queue[queueIdx] = S.queue[n]; S.queue[n] = tmp;
  renderQueueSheet(queueSheetHost);
}

// D6 (docs/DESKTOP_LAYOUT.md): tracks whichever host renderQueueSheet()
// was last asked to paint into — the phone overlay's own #queueBody (the
// default, when called with no argument) or the desktop side panel's
// #playerSideBody (shell/player-side-panel.js) — so a move/remove click
// made *inside* whichever one is actually visible repaints that same one,
// not whichever happens to be the hardcoded default.
let queueSheetHost = null;

// exported (previously module-private) since step D6 lets the desktop side
// panel's "Up next" tab target this at #playerSideBody instead of the
// phone overlay's #queueBody — same render, just a different host
export function renderQueueSheet(host){
  queueSheetHost = host || $('#queueBody');
  const dest = queueSheetHost; dest.innerHTML = '';
  if(!S.queue.length || S.qpos >= S.queue.length){
    dest.appendChild(el('p','note','Nothing queued'));
    dest.appendChild(el('p','note','Play something and what follows shows up here.'));
    return;
  }
  const ul = el('ul','tracklist');
  const curT = S.tracks[S.queue[S.qpos]];
  if(curT){
    const li = el('li'); li.setAttribute('aria-current','true');
    if(curT.art){ const im = el('img','t-art'); im.src = curT.art; im.alt=''; li.appendChild(im); }
    else li.appendChild(el('span','t-art'));
    const name = el('span','t-name');
    name.appendChild(el('b', null, curT.tags.title));
    name.appendChild(el('em', null, 'Now playing · ' + curT.tags.artist));
    li.appendChild(name);
    ul.appendChild(li);
  }
  const upcoming = S.queue.slice(S.qpos + 1);
  upcoming.forEach((idx, pos) => {
    const t = S.tracks[idx]; if(!t) return;
    const li = el('li');
    if(t.art){ const im = el('img','t-art'); im.src = t.art; im.alt=''; li.appendChild(im); }
    else li.appendChild(el('span','t-art'));
    const name = el('span','t-name');
    name.appendChild(el('b', null, t.tags.title));
    name.appendChild(el('em', null, t.tags.artist));
    li.appendChild(name);
    const movers = el('span','movers');
    [['▲',-1],['▼',1]].forEach(([glyph,dir]) => {
      const b = el('button','mv',glyph);
      b.setAttribute('aria-label', dir < 0 ? 'Move up' : 'Move down');
      b.addEventListener('click', e => { e.stopPropagation(); queueMove(pos, dir); });
      movers.appendChild(b);
    });
    li.appendChild(movers);
    const rm = el('button','mv','✕');
    rm.setAttribute('aria-label','Remove from queue');
    rm.addEventListener('click', e => { e.stopPropagation(); queueRemoveAt(pos); });
    li.appendChild(rm);
    ul.appendChild(li);
  });
  dest.appendChild(ul);
}
export function openQueueSheet(){
  renderQueueSheet();
  const overlay = $('#queueOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  openLayer('queue', closeQueueSheet, { container: overlay });
}
export function closeQueueSheet(){
  $('#queueOverlay').classList.remove('open');
  $('#queueOverlay').setAttribute('aria-hidden', 'true');
}
