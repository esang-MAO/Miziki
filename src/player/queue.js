/* ================= queue, shuffle, repeat ================= */
import { S, current, touchBackupKey } from '../state.js';
import { $, el } from '../util/dom.js';
import { albumKey, trackTier, trackIdentityKey } from '../record-art/tiers.js';
import { idOf } from '../library/model.js';
import { sleepStopPlayback } from './sleep-timer.js';
import { load, play, pause, seek, sideLetterFor, cancelPendingGapless } from './transport.js';
import { turningPointAt } from '../sundown/arc.js';
import { drawTime, updateFocusStatusLine } from './clock.js';
import { ensureBuffer } from './buffers.js';
import { invalidateActiveSessionIfAny } from '../history/sessions.js';
import { runStartSequence } from '../shell/start-sequence.js';
import { openPlayerViaSheet, wakeEveningGlance } from '../shell/player-overlay.js';
import { endOfQueue, maybeSideFlip, stopAtRecordEndCeremony } from '../shell/runout.js';
import { openLayer } from '../shell/nav-stack.js';
import { REDUCED } from '../util/motion.js';
import { queueSave } from '../storage/meta.js';
import {
  releaseSeed, noiseFloorScale, surfaceNoiseActive,
  playNeedleLift, playSkipDrop, fadeMusicTo,
  SKIP_LIFT_MS, SKIP_AIR_MS, SKIP_FADE_MS
} from '../audio/surface-noise.js';
import { rotationHz, RPM_33, RPM_45 } from '../record-art/format.js';

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

// RW3 (docs/23_RHYTHM_AND_WEAR.md): true when nextT is missing (the
// queue has nothing more right now) or belongs to a different album than
// curT -- the one "stop at the end of this album" boundary check, shared
// by the sleep timer's own end-of-album stop (below) and This record
// only / Stop between records at sunset and midnight (also below), per
// the plan's own "reuse... by extracting it into one helper both use."
export function isAlbumBoundary(curT, nextT){
  return !nextT || albumKey(nextT) !== albumKey(curT);
}

export function advance(dir, auto){
  if(!S.queue.length) return;
  if(auto && S.repeat === 'one'){ seek(0); if(!S.playing) play(); return; }
  if(auto && S.sleep.mode === 'track'){ sleepStopPlayback(); return; }
  if(auto && S.sleep.mode === 'album'){
    const curT = S.tracks[S.queue[S.qpos]];
    const n2 = S.qpos + dir;
    const atEnd = n2 >= S.queue.length && S.repeat !== 'all';
    const nextT = (!atEnd && n2 >= 0 && n2 < S.queue.length) ? S.tracks[S.queue[n2]] : null;
    if(curT && isAlbumBoundary(curT, nextT)){ sleepStopPlayback(); return; }
  }
  // FS10 (docs/25_FROM_SCRATCH.md): Focus / Stop between records at sunset
  // and midnight -- both stop exactly where the sleep timer's own "end of
  // album" stop just above does, never mid-album and never at a side flip
  // (a side flip's nextT is the same album, so isAlbumBoundary() is false
  // there). Checked only on a natural end (auto), same as the sleep-timer
  // block. Replaces RW3's "This record only" outright -- same boundary.
  if(auto && (S.focus || S.stopAtTurns)){
    const curT = S.tracks[S.queue[S.qpos]];
    const n2 = S.qpos + dir;
    const atEnd = n2 >= S.queue.length && S.repeat !== 'all';
    const nextT = (!atEnd && n2 >= 0 && n2 < S.queue.length) ? S.tracks[S.queue[n2]] : null;
    if(curT && isAlbumBoundary(curT, nextT)){
      let reason = null;
      if(S.focus) reason = 'focus';
      else {
        const tp = turningPointAt(Date.now(), S.sun);
        if(tp) reason = tp;
      }
      if(reason){
        pause(); S.pos = 0; drawTime();
        // FS10 point 4: "Focus ends on its own at that moment" -- the UI
        // mode (top row, idle-fade timing, hidden tab bar/sidebar, can't
        // minimize) is over the instant the record stops; the held sleeve
        // that follows is the same RW4 screen a plain queue-end or Stop
        // between records lands on, no Focus chrome left to show it in.
        if(reason === 'focus') exitFocus();
        // RW4 (docs/23_RHYTHM_AND_WEAR.md): same run-out/put-away ceremony
        // as a real finish just below, ending on the held sleeve instead
        // of the empty slipmat -- not a second stop mechanism.
        stopAtRecordEndCeremony(reason, atEnd ? null : n2);
        return;
      }
    }
  }
  if(!auto) invalidateActiveSessionIfAny();     // an explicit next/prev press is a skip
  let n = S.qpos + dir;
  if(n >= S.queue.length){
    if(S.repeat === 'all'){ if(S.shuffle) buildOrder(); n = 0; }
    else {
      pause(); S.pos = 0; drawTime();
      // RW4: a real finish rides the run-out groove, goes back in its
      // sleeve, and now holds there (the held sleeve) rather than clearing
      // all the way to the empty slipmat -- CEREMONY §2's old final state
      // is left for the genuinely-empty case (clearToRest() elsewhere). A
      // manual skip past the last track just stops, as it always has.
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

/* ================= RW3/RW4 (docs/23_RHYTHM_AND_WEAR.md): resting at a record boundary =================
   src/shell/runout.js runs the actual run-out/put-away ceremony (shared
   with a real end-of-queue finish, RW4) and calls this module's
   paintRestingCard() once it lands on the held sleeve -- S.resting is set
   there, not here. This section is left with the UI (the card itself,
   Play/Flip) and the queue-side effects of leaving the resting state. */
const RESTING_COPY = {
  // FS10 (docs/25_FROM_SCRATCH.md) point 10: "the resting copy 'Playback
  // stops after this record.' is replaced by frame 16's" -- the reason
  // key itself is also renamed, recordOnly -> focus, with the toggle.
  focus: 'Focus ended when the record finished.',
  sunset: 'Around sunset, playback stops between records.',
  midnight: 'Around midnight, playback stops between records.',
  queueEnd: "You've reached the end of your queue.",
};
const RESTING_NOTE = {
  queueEnd: 'Press play to start it again.',
};
const DEFAULT_RESTING_NOTE = 'Your queue is still there. Press play to continue.';

// RW3: the first entry in S.queue that's the same album as curT but a
// different side -- what a manual "Flip to Side B" from the resting
// card jumps to, without disturbing the rest of the queue (the same
// "pick a track directly" shape a library/gatefold tap already uses).
// null when the album has no other side, or none of it is in the queue.
function otherSideQueuePos(curT){
  if(!curT) return null;
  const curSide = sideLetterFor(curT, S.queue[S.qpos]);
  if(!curSide) return null;
  for(let i = 0; i < S.queue.length; i++){
    const idx = S.queue[i];
    const t = S.tracks[idx]; if(!t) continue;
    if(albumKey(t) !== albumKey(curT)) continue;
    if(sideLetterFor(t, idx) !== curSide) return i;
  }
  return null;
}

// RW4: "Side A · ended 6:31 PM" -- a plain 12-hour clock, same shape the
// rest of the player already uses for a readout this small (no seconds).
function fmtEndedAt(ms){
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Exported: src/shell/runout.js calls this once it lands on the held
// sleeve (S.resting already set there), and this module's own
// continueFromResting()/flipFromResting() call it again whenever
// S.resting changes.
export function paintRestingCard(){
  const card = $('#restingCard'); if(!card) return;
  const r = S.resting;
  card.style.display = r ? '' : 'none';
  if(!r) return;
  const kicker = $('#restingKicker');
  if(kicker) kicker.textContent = r.reason === 'queueEnd' ? 'Played through' : 'Paused after this record';
  const body = $('#restingBody'); if(body) body.textContent = RESTING_COPY[r.reason] || RESTING_COPY.focus;
  const note = $('#restingNote'); if(note) note.textContent = RESTING_NOTE[r.reason] || DEFAULT_RESTING_NOTE;
  const meta = $('#restingMeta');
  if(meta) meta.textContent = (r.side ? 'Side ' + r.side + ' · ' : '') + 'Ended ' + fmtEndedAt(r.endedAt);
  const flipBtn = $('#restingFlipBtn');
  if(flipBtn) flipBtn.style.display = otherSideQueuePos(current()) !== null ? '' : 'none';
}

export function continueFromResting(){
  const r = S.resting;
  if(!r) return;
  S.resting = null;
  paintRestingCard();
  if(r.pendingIndex === null || r.pendingIndex === undefined){
    // RW4: nothing was queued after this record -- "Play to start it
    // again" restarts the whole record from side A, not just wherever
    // playback happened to stop.
    const curT = S.tracks[S.queue[S.qpos]];
    let startPos = S.qpos;
    if(curT){
      while(startPos > 0){
        const prevT = S.tracks[S.queue[startPos - 1]];
        if(!prevT || albumKey(prevT) !== albumKey(curT)) break;
        startPos--;
      }
    }
    S.qpos = startPos;
  } else {
    S.qpos = r.pendingIndex;
  }
  load(S.queue[S.qpos]);
  if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
  else play();
}

export function flipFromResting(){
  if(!S.resting) return;
  const pos = otherSideQueuePos(current());
  S.resting = null;
  paintRestingCard();
  if(pos === null) return;
  S.qpos = pos;
  load(S.queue[pos]);
  if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
  else play();
}

// FS10 (docs/25_FROM_SCRATCH.md): Focus -- a per-session player toggle
// (S.focus, never saved), replacing RW3's "This record only" switch
// outright. Syncs the Focus pill (hidden while Focus is on -- the way
// back out is Done/swipe, point 2 -- and, same as before, until a track
// is loaded), the overflow menu's Queue row (still hidden while on, same
// "nothing to navigate to" reasoning RW3 had), the .focus-on/focus-active
// classes that drive the rest of the UI mode (CSS: 03-sleeve-pull.css,
// 29-evening-glance.css, 23-desktop.css), and the status line under the
// artist (clock.js's updateFocusStatusLine(), called here so a toggle's
// own frame shows the right text immediately rather than waiting for the
// next drawTime() tick). Called on toggle and, from transport.js's
// load(), on every track change.
export function updateFocusUI(){
  const pill = $('#focusPill');
  if(pill) pill.classList.toggle('focus-hidden', S.focus);
  // a dedicated class rather than style.display directly -- #queueBtn's
  // own display is also toggled independently (hidden until a track is
  // loaded, src/player/transport.js's load()), and the two reasons must
  // not stomp on each other.
  const queueBtn = $('#queueBtn');
  if(queueBtn) queueBtn.classList.toggle('focus-hidden', S.focus);
  // FS5 (docs/25_FROM_SCRATCH.md point 6): the bottom row's own queue
  // icon follows the same hide -- moot in practice once .focus-on hides
  // the whole bottom row below, but kept in step regardless.
  const playerQueueBtn = $('#playerQueueBtn');
  if(playerQueueBtn) playerQueueBtn.classList.toggle('focus-hidden', S.focus);
  const ov = $('#playerOverlay');
  if(ov) ov.classList.toggle('focus-on', S.focus);
  // Point 2 ("the tab bar is hidden") and point 7 ("the sidebar and
  // library pane fold away" on desktop) -- one body class both of those
  // CSS rules key off, the same shape .glance-active (player-overlay.js)
  // already uses for the desktop glance view.
  document.body.classList.toggle('focus-active', S.focus);
  updateFocusStatusLine();
}

export function toggleFocus(){
  S.focus = !S.focus;
  updateFocusUI();
  // Entering or leaving Focus changes the idle-fade timing/condition
  // (RW5's eveningGlanceLevel() now reads S.focus too) -- wake it so the
  // new rule applies from a fresh 0s idle rather than mid-countdown under
  // whichever rule was running a moment ago.
  if(S.playerOpen) wakeEveningGlance();
}

// FS10 point 4: "Focus ends on its own" the instant a record boundary
// stops playback -- called from advance() below, never from a swipe/Done,
// which both call toggleFocus() like the pill itself. Leaves S.resting
// alone; the caller (advance()) sets that up separately via
// stopAtRecordEndCeremony().
export function exitFocus(){
  if(!S.focus) return;
  S.focus = false;
  updateFocusUI();
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
   either way.

   This section's own earlier assumption that no separate "from the lock
   screen" branch was needed turned out wrong in one way: a lock-screen
   press reaches this function while the page is hidden, and iOS can
   re-suspend a backgrounded page before the setTimeout below gets to
   run, silently dropping the "drop" half of the skip. skipWithLift()
   now checks document.hidden up front and resolves immediately in that
   case -- see its own comment for the full reasoning.

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
  // lock-screen/headphone/car Next/Previous reach this function from a
  // MediaSession action handler while the page is hidden (screen locked,
  // app backgrounded). iOS only wakes a suspended page briefly to run that
  // handler, and can re-suspend it again before a setTimeout scheduled
  // below ever fires — so the lift's own "drop" half (the actual
  // advance()/seek() call, deferred SKIP_FADE_MS-SKIP_LIFT_MS+SKIP_AIR_MS
  // below) would silently never run, and a second press would just
  // mutate a pendingSkip that never resolves either. Nothing is visible
  // to animate while hidden anyway, so resolve immediately instead of
  // deferring through a timer that isn't guaranteed to survive.
  if(typeof document !== 'undefined' && document.hidden){
    if(dir === 0) seek(0); else advance(dir, false);
    return;
  }
  const t = current();
  // AU9 (docs/16_AUDIO.md §5): the currently-playing record's own rpm,
  // cached onto S.recordFormat by transport.js's load(), feeds rotationHz()
  // below rather than a fixed rate multiplier.
  const rpm45 = !!(S.recordFormat && S.recordFormat.speed === RPM_45);
  const scale = t ? noiseFloorScale(S.surfaceNoise, trackTier(t), undefined, rpm45) : 0;
  const active = surfaceNoiseActive() && scale > 0;
  const seed = t ? releaseSeed(albumKey(t), sideLetterFor(t, S.index)) : 0;
  const rateHz = rotationHz((S.recordFormat && S.recordFormat.speed) || RPM_33, S.rate);
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

/* ================= AU8 (docs/16_AUDIO.md §6): queue undo =================
   One snapshot slot, taken right before "Clear upcoming" or removing a
   single row, so Undo can restore {baseQueue, queue, qpos} verbatim.
   Neither operation ever touches an index <= S.qpos, so restoring the
   snapshot never needs to reload() the current track -- the one playing
   stays exactly as it was throughout. A session invalidated by the
   removal (invalidateActiveSessionIfAny(), called at the same point
   queueRemoveAt/clearUpcoming already did before this step) stays
   invalidated even after Undo -- same documented asymmetry as RF1's own
   "offline plays after a remote clear" gap: undoing the *queue* arrangement
   is a convenience, not a time machine for session tracking. */
function queueUndoSnapshot(){
  S.queueUndo = { baseQueue: S.baseQueue.slice(), queue: S.queue.slice(), qpos: S.qpos };
}
function showQueueUndo(message){
  const toast = $('#queueUndoToast'); if(!toast) return;
  $('#queueUndoText').textContent = message;
  toast.style.display = 'flex';
  clearTimeout(S.queueUndoTimer);
  S.queueUndoTimer = setTimeout(hideQueueUndo, 8000);
}
function hideQueueUndo(){
  const toast = $('#queueUndoToast'); if(toast) toast.style.display = 'none';
  S.queueUndo = null;
}
export function undoQueueChange(){
  const snap = S.queueUndo; if(!snap) return;
  S.baseQueue = snap.baseQueue; S.queue = snap.queue; S.qpos = snap.qpos;
  hideQueueUndo();
  renderQueueSheet(queueSheetHost);
}

// a small, local relative-time formatter rather than importing
// profile/storefront.js's own timeAgoShort() -- that module sits inside a
// wide, already-circular profile/social import cluster, and this file is
// imported far too widely (transport.js, controls.js, main.js's own boot
// sequence) to be worth adding an edge into it for one string formatter.
// Same "duplicate rather than add an edge" call CLAUDE.md documents for
// sync/images.js's own cropSquareStepped().
function queueRelativeTime(ms){
  const s = Math.max(0, Math.round(ms / 1000));
  if(s < 60) return 'just now';
  const m = Math.round(s / 60);
  if(m < 60) return m + ' min' + (m === 1 ? '' : 's') + ' ago';
  const h = Math.round(m / 60);
  if(h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
  const d = Math.round(h / 24);
  return d + ' day' + (d === 1 ? '' : 's') + ' ago';
}

// §6: "Save queue as playlist" -- the whole current queue (already-played
// portion included), in its current (possibly shuffled) order, deduplicated
// by id the same way a playlist's own items array always is. window.prompt()
// is an established pattern in this codebase (player/eq-sheet.js's own
// "Save preset"), not a new one introduced here.
export function saveQueueAsPlaylist(){
  if(!S.queue.length) return;
  const nm = (window.prompt('Name this playlist') || '').trim();
  if(!nm) return;
  const seen = new Set();
  const items = [];
  S.queue.forEach(idx => {
    const id = idOf(idx); if(id === null || seen.has(id)) return;
    seen.add(id); items.push(id);
  });
  S.playlists.push({ name: nm, items });
  queueSave();
  touchBackupKey('playlistDefs', nm);
  touchBackupKey('playlistOrder', nm);
}

// §6: "Clear upcoming" -- truncates both the visible S.queue and the
// shuffle-source S.baseQueue to just what's already played plus the
// current track, so a later shuffle toggle can't resurrect what was just
// cleared. Mirrors queueRemoveAt's own invalidate/cancel-gapless pair.
export function clearUpcoming(){
  if(S.qpos >= S.queue.length - 1) return;   // nothing upcoming to clear
  invalidateActiveSessionIfAny();
  cancelPendingGapless();
  queueUndoSnapshot();
  const removed = new Set(S.queue.slice(S.qpos + 1));
  S.queue = S.queue.slice(0, S.qpos + 1);
  S.baseQueue = S.baseQueue.filter(idx => !removed.has(idx));
  showQueueUndo(removed.size === 1 ? '1 track removed from the queue.' : removed.size + ' tracks removed from the queue.');
  renderQueueSheet(queueSheetHost);
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
// that's what skip is for. AU8: also drops the index from S.baseQueue (not
// just S.queue), the same "a later shuffle toggle can't resurrect it" fix
// clearUpcoming() needs for the same reason — and snapshots for Undo,
// same shared toast clearUpcoming() uses.
// exported for its own unit test, same precedent as angleDelta in scrub.js --
// the real UI only ever reaches this through the ✕ button renderQueueSheet()
// wires per row.
export function queueRemoveAt(pos){
  const queueIdx = S.qpos + 1 + pos;
  if(queueIdx <= S.qpos || queueIdx >= S.queue.length) return;
  invalidateActiveSessionIfAny();
  cancelPendingGapless();   // AU4: a queue edit invalidates whatever was pre-armed
  queueUndoSnapshot();
  const removedIdx = S.queue[queueIdx];
  const removedTitle = (S.tracks[removedIdx] && S.tracks[removedIdx].tags.title) || 'Track';
  S.queue.splice(queueIdx, 1);
  S.baseQueue = S.baseQueue.filter(idx => idx !== removedIdx);
  showQueueUndo('Removed "' + removedTitle + '" from the queue.');
  renderQueueSheet(queueSheetHost);
}
// AU8: generalizes queueMove()'s adjacent-swap so a drag can jump more
// than one slot at once — queueMove(pos, dir) is kept as the ▲▼
// VoiceOver-action entry point, a thin wrapper over this. Exported for
// its own unit test, same precedent as queueRemoveAt just above.
export function queueReorderTo(fromPos, toPos){
  const fromIdx = S.qpos + 1 + fromPos;
  if(fromIdx <= S.qpos || fromIdx >= S.queue.length) return;
  const toIdx = Math.max(S.qpos + 1, Math.min(S.queue.length - 1, S.qpos + 1 + toPos));
  if(toIdx === fromIdx) return;
  invalidateActiveSessionIfAny();
  cancelPendingGapless();   // AU4: a queue edit invalidates whatever was pre-armed
  const [item] = S.queue.splice(fromIdx, 1);
  S.queue.splice(toIdx, 0, item);
  renderQueueSheet(queueSheetHost);
}
function queueMove(pos, dir){ queueReorderTo(pos, pos + dir); }

// D6 (docs/DESKTOP_LAYOUT.md): tracks whichever host renderQueueSheet()
// was last asked to paint into — the phone overlay's own #queueBody (the
// default, when called with no argument) or the desktop side panel's
// #playerSideBody (shell/player-side-panel.js) — so a move/remove click
// made *inside* whichever one is actually visible repaints that same one,
// not whichever happens to be the hardcoded default.
let queueSheetHost = null;

// AU8: artist, plus the side letter when S.albumSides is on — the same
// sideLetterFor(t, idx) PLAYBACK/Surface Noise already use for seeding
// lead-in/run-out noise by side. The "7″ · 45" format chip the doc's own
// mockup also shows is AU9/AU10 territory (sides-by-time/45 RPM haven't
// landed yet) — left out here rather than guessed at.
function queueRowSubtitle(t, idx){
  const side = sideLetterFor(t, idx);
  return side ? t.tags.artist + ' · SIDE ' + side : t.tags.artist;
}
function queueRowArt(t, li){
  if(t.art){ const im = el('img','t-art'); im.src = t.art; im.alt=''; li.appendChild(im); }
  else li.appendChild(el('span','t-art'));
}

/* ---- AU8: drag-to-reorder, with a handle ----
   Pointer-based, not the HTML5 drag-and-drop API — iOS Safari doesn't
   fire native dragstart/dragover from a touch gesture at all. The ▲▼
   movers stay as real, focusable buttons (just visually hidden via the
   existing .sr-only utility, record-art/view.js's own precedent) so
   VoiceOver can still reorder a row without the pointer gesture. */
let dragState = null;
function endQueueDrag(){
  if(!dragState) return;
  const { pos, targetPos, li, rows } = dragState;
  rows.forEach(r => r.el.classList.remove('queue-drop-before','queue-drop-after'));
  li.classList.remove('dragging');
  li.style.transform = '';
  dragState = null;
  if(targetPos !== pos) queueReorderTo(pos, targetPos);
}
function onQueueDragMove(e){
  if(!dragState || e.pointerId !== dragState.pointerId) return;
  const dy = e.clientY - dragState.startY;
  dragState.li.style.transform = 'translateY(' + dy + 'px) rotate(1.5deg)';
  const dragged = dragState.rows.find(r => r.pos === dragState.pos);
  const draggedCenter = dragged.top + dragged.height / 2 + dy;
  let best = dragState.pos, bestDist = Infinity;
  dragState.rows.forEach(r => {
    const dist = Math.abs((r.top + r.height / 2) - draggedCenter);
    if(dist < bestDist){ bestDist = dist; best = r.pos; }
  });
  if(best !== dragState.targetPos){
    dragState.rows.forEach(r => r.el.classList.remove('queue-drop-before','queue-drop-after'));
    if(best !== dragState.pos){
      dragState.rows.find(r => r.pos === best).el
        .classList.add(best < dragState.pos ? 'queue-drop-before' : 'queue-drop-after');
    }
    dragState.targetPos = best;
  }
}
function wireQueueDragHandle(handle, li, pos, listEl){
  handle.addEventListener('pointerdown', e => {
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const rows = Array.from(listEl.querySelectorAll('li[data-pos]')).map(r => ({
      pos: Number(r.dataset.pos), el: r, top: r.offsetTop, height: r.offsetHeight,
    }));
    dragState = { pointerId: e.pointerId, startY: e.clientY, pos, targetPos: pos, li, rows };
    li.classList.add('dragging');
  });
  handle.addEventListener('pointermove', onQueueDragMove);
  handle.addEventListener('pointerup', endQueueDrag);
  handle.addEventListener('pointercancel', endQueueDrag);
}

// Exported so the desktop side panel's "Up next" tab can target this at
// #playerSideBody instead of the phone overlay's #queueBody — same
// render, just a different host.
export function renderQueueSheet(host){
  queueSheetHost = host || $('#queueBody');
  const dest = queueSheetHost; dest.innerHTML = '';
  if(!S.queue.length || S.qpos >= S.queue.length){
    dest.appendChild(el('p','note','Nothing queued'));
    dest.appendChild(el('p','note','Play something and what follows shows up here.'));
    return;
  }

  // AU8: "Recently played" — everything already played earlier in this
  // same queue, i.e. S.queue before S.qpos. There's no separate play-event
  // log to read (history/sessions.js only tracks per-album session
  // progress, not an ordered list of individual plays) — the queue itself
  // already is this listening session's own history. Relative times come
  // from S.trackLastPlayed, written at 95% completion (history/played.js),
  // close enough to "when it finished" for a dimmed, secondary row.
  const played = S.queue.slice(0, S.qpos);
  if(played.length){
    dest.appendChild(el('p','queue-section-label','Recently played'));
    const rul = el('ul','tracklist queue-recent');
    played.slice(-5).reverse().forEach(idx => {
      const t = S.tracks[idx]; if(!t) return;
      const li = el('li');
      queueRowArt(t, li);
      const name = el('span','t-name');
      name.appendChild(el('b', null, t.tags.title));
      const key = trackIdentityKey(t);
      const when = S.trackLastPlayed[key];
      name.appendChild(el('em', null, when ? queueRelativeTime(Date.now() - when) : t.tags.artist));
      li.appendChild(name);
      rul.appendChild(li);
    });
    dest.appendChild(rul);
  }

  const ul = el('ul','tracklist');
  const curIdx = S.queue[S.qpos];
  const curT = S.tracks[curIdx];
  if(curT){
    const li = el('li'); li.setAttribute('aria-current','true');
    queueRowArt(curT, li);
    const name = el('span','t-name');
    name.appendChild(el('b', null, curT.tags.title));
    name.appendChild(el('em', null, 'Now playing · ' + queueRowSubtitle(curT, curIdx)));
    li.appendChild(name);
    ul.appendChild(li);
  }
  // FS10 point 2: Focus "covers the current record, both sides. The
  // queue isn't touched" -- replaces RW3's "only the current side's
  // tracks are listed" cut outright, not just while Focus happens to be
  // on (the queue sheet itself is unreachable during Focus anyway, since
  // the bottom row/overflow menu that opens it are hidden).
  const upcoming = S.queue.slice(S.qpos + 1);
  if(upcoming.length){
    const head = el('div','queue-section-head');
    head.appendChild(el('span', null, 'Up next · ' + upcoming.length));
    const clear = el('button','cta ghost small','Clear upcoming');
    clear.addEventListener('click', clearUpcoming);
    head.appendChild(clear);
    dest.appendChild(head);
  }
  upcoming.forEach((idx, pos) => {
    const t = S.tracks[idx]; if(!t) return;
    const li = el('li'); li.dataset.pos = String(pos);
    const handle = el('button','drag-handle','⠿');
    handle.setAttribute('aria-hidden','true'); handle.tabIndex = -1;
    li.appendChild(handle);
    queueRowArt(t, li);
    const name = el('span','t-name');
    name.appendChild(el('b', null, t.tags.title));
    name.appendChild(el('em', null, queueRowSubtitle(t, idx)));
    li.appendChild(name);
    const movers = el('span','movers sr-only');
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
    wireQueueDragHandle(handle, li, pos, ul);
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
