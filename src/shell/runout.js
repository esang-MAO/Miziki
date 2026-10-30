import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { REDUCED } from '../util/motion.js';
import { isDesktopShell } from '../util/viewport.js';
import { albumKey, trackTier } from '../record-art/tiers.js';
import { applyDiscVariant } from '../record-art/looks.js';
import { applyDeadWaxEtching } from '../record-art/etchings.js';
import { albumTracks } from '../library/model.js';
import { renderTracks } from '../library/view.js';
import { load, play, pause } from '../player/transport.js';
import { drawTime } from '../player/clock.js';
import { stopSleepState } from '../player/sleep-timer.js';
import { startRunout } from '../audio/runout.js';
import { releaseSeed, noiseFloorScale, surfaceNoiseActive, startRunoutNoise, playNeedleLift } from '../audio/surface-noise.js';
import { rotationHz, RPM_33, RPM_45 } from '../record-art/format.js';
import { updateGatefoldNowPlaying } from '../gatefold/view.js';
import { GROOVE, FLIP, splitSides, sideTurn, runoutWaitMs } from './ceremony-timing.js';
import { renderMiniPlayer } from './mini-player.js';
import { renderPlayerSidePanel } from './player-side-panel.js';
import { forceCloseLayer } from './nav-stack.js';
import { shouldPutAway, putAwayInstant, runPutAwaySequence, startSpinDown, clearSpinDown } from './put-away.js';
import { sleeveArtFor, applySleeveWear } from './start-sequence.js';
// RW4 (docs/23_RHYTHM_AND_WEAR.md): real circular import, same shape as
// start-sequence.js/transport.js already have with this file -- queue.js
// imports endOfQueue/stopAtRecordEndCeremony from here, and this file
// calls back into queue.js's paintRestingCard() once a ceremony lands on
// the held sleeve.
import { paintRestingCard } from '../player/queue.js';

/* ================= run-out groove, rest, side flip (docs/CEREMONY.md §2, §3) =================
   §2: the last record of the queue ends, the needle rides the run-out groove
   for a moment, the record goes back in its sleeve, and the player clears to
   an empty slipmat. §3: the last track of side A ends with side B still to
   come, so the record is lifted and turned over before side B plays, unless
   Auto-flip is off (docs/15_SURFACE_NOISE.md §4), in which case it waits in
   the run-out for a flip instead -- see runSideWait()/performPendingFlip()
   further down.
   S.runout is the in-flight state ({kind:'end'|'flip'|'wait', turning, n, to}),
   runtime only, never saved. Every await is followed by the same S.sleeveSeq
   token check the pull and put-away use, so a tap or a new pull cancels it. */

let groove = null;
// docs/15_SURFACE_NOISE.md §1: the Surface Noise hiss/tick layer that rides
// alongside the CEREMONY groove's own thump, started and stopped in
// lockstep with it — see startNoiseLayer()/stopNoiseLayer() below.
let noiseLayer = null;

function stopGroove(fadeMs){ if(groove){ groove.stop(fadeMs); groove = null; } }
function stopNoiseLayer(fadeMs){ if(noiseLayer){ noiseLayer.stop(fadeMs); noiseLayer = null; } }

// The side letter the current track is on, for seeding the run-out noise
// the same way player/transport.js seeds the lead-in — '' when sides are
// off (one seed per album rather than per side).
function currentSideLetter(t){
  if(!S.albumSides || !t || !t.tags || !t.tags.album) return '';
  const splits = splitSides(albumTracks(t.tags.album), S.tracks, S.albumSides);
  const found = splits && splits.find(s => s.idx.includes(S.index));
  return found ? found.label.replace('SIDE ', '') : '';
}

function startNoiseLayer(t, durSec){
  if(!surfaceNoiseActive()) return;
  const rpm45 = !!(S.recordFormat && S.recordFormat.speed === RPM_45);
  const scale = noiseFloorScale(S.surfaceNoise, trackTier(t), undefined, rpm45);
  if(scale <= 0) return;
  noiseLayer = startRunoutNoise(durSec, releaseSeed(albumKey(t), currentSideLetter(t)), scale,
    rotationHz((S.recordFormat && S.recordFormat.speed) || RPM_33, S.rate));
}

// Drops whatever run-out/flip is in flight without landing it anywhere.
// Safe to call any time, any number of times.
export function cancelRunout(){
  stopGroove(0);
  stopNoiseLayer(0);
  const wasWaiting = S.runout && S.runout.kind === 'wait';
  S.runout = null;
  const stage = $('#platterStage');
  if(stage) stage.classList.remove('runout', 'flipping');
  const letter = $('#sideLetter');
  if(letter) letter.textContent = '';
  // docs/15_SURFACE_NOISE.md §4: whatever ended the wait (a flip, a new
  // pull cancelling it from start-sequence.js) also clears its own status
  // line and buttons -- S.runout is already null above, so both read the
  // "nothing waiting" state.
  if(wasWaiting){ setFlipWaitStatus(false); updateWaitUI(); }
}

// The rest state: nothing loaded, the platter empty. Same clear-out order
// forgetLibrary()'s empty-library branch already uses (library/delete.js).
// Desktop keeps the player open on the empty slipmat; a phone slides it shut.
export function clearToRest(){
  S.queue = []; S.baseQueue = []; S.qpos = 0;
  S.index = -1; S.pendingShellInfo = null; S.shellAlbumId = null;
  S.outgoingArt = null; S.outgoingHasArt = false;
  if(typeof MizikiSocial !== 'undefined') MizikiSocial.stopSpinning();
  // RF21 (docs/12_REFINE.md, "a quieter broadcast"): "Don't share this
  // session" is session-only and turns itself off once the queue genuinely
  // ends (not a manual skip past the last track -- endOfQueue() only calls
  // clearToRest() for a real finish), so a listener never has to remember
  // it was on for a prior, unrelated session.
  S.privateSpin = false;
  $('#trackName').textContent = 'Nothing on the platter';
  $('#trackBy').textContent = ''; $('#trackSpec').textContent = 'Load a file to see its signal path';
  $('#label').classList.remove('has-art'); $('#labelArt').removeAttribute('src');
  $('#labelTitle').textContent = '';
  applyDeadWaxEtching(null, '');
  applyDiscVariant(null);
  if(S.playerOpen && !isDesktopShell()) forceCloseLayer('player');
  $('#platterBox').classList.add('disc-hidden');
  $('#sleeve').style.display = 'none';
  S.platterEmpty = true;
  ['#playerShareIconBtn', '#queueBtn', '#sleepTimerBtn', '#trackInfoBtn', '#playerFavBtn']
    .forEach(sel => { const b = $(sel); if(b) b.style.display = 'none'; });
  stopSleepState();
  renderMiniPlayer();
  renderPlayerSidePanel();
  drawTime();
  renderTracks();
  updateGatefoldNowPlaying();
}

// RW4 (docs/23_RHYTHM_AND_WEAR.md): the record resting half out of its
// sleeve -- the exact midpoint of the existing put-away animation (the
// sleeve has arrived, the disc hasn't slid into it yet), held rather
// than completed. S.index/S.queue are left exactly as they are (unlike
// clearToRest()), so the just-finished track's own title/artist/art
// keep showing and current() keeps returning it -- that's also what
// keeps .rest-hint's Open Crate/Open Library suggestions from showing,
// with no extra guard needed, since that only ever triggers on !current().
function holdSleeve(t, reason, pendingIndex){
  const stage = $('#platterStage');
  stage.classList.remove('runout','flipping','putaway-slide','putaway-out','sleeve-arriving','sleeve-exiting','disc-emerging','returning','changing');
  clearSpinDown();
  sleeveArtFor(t.art, !!t.art);
  applySleeveWear($('#sleeve'), albumKey(t));
  $('#sleeve').style.display = 'flex';
  stage.classList.add('putaway-in');
  $('#platterBox').classList.remove('disc-hidden');
  S.platterEmpty = false;
  S.resting = { reason, pendingIndex, side: currentSideLetter(t), endedAt: Date.now() };
  paintRestingCard();
  renderMiniPlayer();
  renderPlayerSidePanel();
}

// Shared by a real end-of-queue finish and RW3's This record only/Stop
// between records -- same run-out groove and put-away ceremony either
// way (one in, one out: no second ceremony for RW3's own stop), ending
// on the held sleeve (holdSleeve()) instead of completing the put-away
// into the empty slipmat. Pure, the setting off, the player closed, or
// the page hidden skip the animation but land on the exact same final
// state, same as today's early-exit already does.
async function runToHeldSleeve(t, reason, pendingIndex){
  if(S.mode === 'pure' || !shouldPutAway(true) || !S.playerOpen || document.hidden){
    holdSleeve(t, reason, pendingIndex);
    return;
  }
  const stage = $('#platterStage');
  const token = ++S.sleeveSeq;
  const cancelled = () => {
    if(token === S.sleeveSeq && !S.playing) return false;
    if(S.runout && S.runout.kind === 'end') cancelRunout();
    return true;
  };
  S.runout = {kind:'end', turning:true, reason, pendingIndex};
  stage.classList.add('runout');
  groove = startRunout((GROOVE.ms + GROOVE.spinDownMs) / 1000);
  startNoiseLayer(t, (GROOVE.ms + GROOVE.spinDownMs) / 1000);
  await sleep(GROOVE.ms);
  if(cancelled()) return;
  stopGroove(GROOVE.spinDownMs);
  stopNoiseLayer(GROOVE.spinDownMs);
  playNeedleLift();
  S.runout.turning = false;
  startSpinDown(GROOVE.spinDownMs);
  stage.classList.remove('runout');
  await sleep(GROOVE.spinDownMs);
  if(cancelled()) return;
  // holdAfterArrive: stop right where the sleeve has arrived and the disc
  // is still fully visible beside it -- never run the rest of the put-away
  // (the disc sliding in and disappearing, the sleeve itself then hiding).
  await runPutAwaySequence(t, {skipSpin:true, token, holdAfterArrive:true});
  if(cancelled()) return;
  S.runout = null;
  holdSleeve(t, reason, pendingIndex);
}

// advance()'s end-of-queue branch, after it has already paused. A manual
// skip past the last track keeps the old behavior (nothing clears).
export async function endOfQueue(auto){
  if(!auto) return;
  const t = current();
  if(!t){ putAwayInstant(); clearToRest(); return; }   // nothing to hold -- genuinely nothing loaded
  await runToHeldSleeve(t, 'queueEnd', null);
}

// RW3: This record only / Stop between records at sunset and midnight --
// called by player/queue.js's advance() right after it pauses, same
// "already paused, just land somewhere" shape endOfQueue() has always had.
export async function stopAtRecordEndCeremony(reason, pendingIndex){
  const t = current();
  if(!t) return;
  await runToHeldSleeve(t, reason, pendingIndex);
}

// Pure: would moving from the current track to queue index n trigger the
// side-flip ceremony right now -- every one of maybeSideFlip()'s own
// conditions, with no side effect. AU4 (docs/16_AUDIO.md §2.4) calls this
// before pre-scheduling a gapless next source, so a side flip "still runs
// exactly as now" instead of being raced by a seamless hand-off.
export function sideFlipTurnAt(n){
  if(S.mode === 'pure' || !S.albumSides || !S.playerOpen || document.hidden || REDUCED) return null;
  if(!S.sleevePullEnabled || S.shuffle) return null;
  const cur = current(), next = S.tracks[S.queue[n]];
  if(!cur || !next || albumKey(cur) !== albumKey(next)) return null;
  return sideTurn(splitSides(albumTracks(cur.tags.album), S.tracks, S.albumSides), S.index, S.queue[n]);
}

// §3: true (and the flip started) when an automatic advance moves from the
// last track of one side straight onto the first of the next, in Vinyl,
// with the player open and visible. advance() then does nothing more.
export function maybeSideFlip(n){
  const turn = sideFlipTurnAt(n);
  if(!turn) return false;
  // docs/15_SURFACE_NOISE.md §4: On (the default) keeps the record flipping
  // itself, same as always; Off leaves it waiting in the run-out instead.
  if(S.autoFlip) runSideFlip(n, turn); else runSideWait(n, turn);
  return true;
}

async function runSideFlip(n, turn){
  const stage = $('#platterStage'), letter = $('#sideLetter');
  pause();
  const token = ++S.sleeveSeq;
  const cancelled = () => {
    if(token === S.sleeveSeq) return false;
    if(S.runout && S.runout.kind === 'flip') cancelRunout();
    return true;
  };
  S.runout = {kind:'flip', turning:true, n, to:turn.to};
  stage.classList.add('runout');
  groove = startRunout(FLIP.grooveMs / 1000);
  startNoiseLayer(current(), FLIP.grooveMs / 1000);
  await sleep(FLIP.grooveMs);
  if(cancelled()) return;
  stopGroove(150);
  stopNoiseLayer(150);
  playNeedleLift();
  S.runout.turning = false;
  startSpinDown(FLIP.liftMs);
  stage.classList.remove('runout');
  if(letter) letter.textContent = turn.from;
  void stage.offsetWidth;
  stage.classList.add('flipping');
  await sleep(FLIP.liftMs);
  if(cancelled()) return;
  if(letter) letter.textContent = turn.to;   // edge-on: the other face comes round
  await sleep(FLIP.turnMs);
  if(cancelled()) return;
  stage.classList.remove('flipping');
  if(letter) letter.textContent = '';
  S.runout = null;
  S.qpos = n;
  load(S.queue[n]);
  play();
}

// docs/15_SURFACE_NOISE.md §4, Auto-flip Off: the record stays on the
// platter, spinning in the run-out, until the user flips it, the run-out
// times out (the needle lifts on its own), or a different record is pulled
// (start-sequence.js's own cancelRunout() call). S.runout.kind === 'wait'.
// One bounded chunk of groove/noise at a time (WAIT_LOOP_SEC) rather than
// one unbounded buffer, since audio/runout.js's startRunout() allocates a
// single fixed-duration buffer and "Until I lift it" has no duration at
// all -- the loop just re-arms itself until the deadline (or forever).
const WAIT_LOOP_SEC = 20;

// Saved so the "Side A finished - Flip to continue" status can be put back
// once the wait ends, the same save-once/restore-once shape as any other
// transient status overlay in this codebase.
let savedTrackSpec = null;
function setFlipWaitStatus(on, fromLetter){
  const el = $('#trackSpec');
  if(!el) return;
  if(on){
    if(savedTrackSpec === null) savedTrackSpec = el.textContent;
    el.textContent = 'Side ' + fromLetter + ' finished · Flip to continue.';
  } else if(savedTrackSpec !== null){
    el.textContent = savedTrackSpec;
    savedTrackSpec = null;
  }
}

// Shows/hides the player's own "Flip to Side B"/"Lift needle" buttons
// (miziki.html's #flipPrompt/#liftNeedleBtn, inside #nowActions). Lift
// needle only makes sense for "Until I lift it" -- short/normal already
// lift on their own once the timeout passes -- and only before that's
// already happened.
function updateWaitUI(){
  const r = S.runout;
  const waiting = !!(r && r.kind === 'wait');
  const flipBtn = $('#flipPrompt'), liftBtn = $('#liftNeedleBtn');
  if(flipBtn) flipBtn.style.display = waiting ? '' : 'none';
  if(liftBtn) liftBtn.style.display = (waiting && !r.lifted && S.runoutLength === 'until-lift') ? '' : 'none';
}

// The needle comes up on its own (a timed-out wait) or because the user
// asked it to ("Lift needle", shown only for "Until I lift it"). The
// record keeps waiting either way -- this never clears S.runout, only
// stops the groove/noise and the platter's own spin.
export function liftNeedleNow(){
  const r = S.runout;
  if(!r || r.kind !== 'wait' || r.lifted) return false;
  stopGroove(150);
  stopNoiseLayer(150);
  playNeedleLift();
  r.turning = false;
  r.lifted = true;
  startSpinDown(GROOVE.spinDownMs);
  const stage = $('#platterStage');
  if(stage) stage.classList.remove('runout');
  updateWaitUI();
  return true;
}

async function runSideWait(n, turn){
  const stage = $('#platterStage');
  pause();
  const t = current();
  const token = ++S.sleeveSeq;
  const cancelled = () => {
    if(token === S.sleeveSeq) return false;
    if(S.runout && S.runout.kind === 'wait') cancelRunout();
    return true;
  };
  S.runout = {kind:'wait', turning:true, n, from:turn.from, to:turn.to, lifted:false};
  stage.classList.add('runout');
  // #sideLetter is a brief, giant overlay meant only for the ~700 ms flip
  // animation itself (runSideFlip, above) -- a wait can run for seconds or
  // (Until I lift it) indefinitely, so it stays empty/hidden here (its own
  // CSS, :empty{display:none}) and the status line below is the one
  // on-screen "waiting" indicator.
  setFlipWaitStatus(true, turn.from);
  updateWaitUI();

  const timeoutMs = runoutWaitMs(S.runoutLength);
  const deadline = timeoutMs == null ? null : Date.now() + timeoutMs;
  for(;;){
    const remainMs = deadline == null ? WAIT_LOOP_SEC * 1000 : Math.min(WAIT_LOOP_SEC * 1000, deadline - Date.now());
    if(remainMs <= 0) break;
    stopGroove(0);
    stopNoiseLayer(0);
    groove = startRunout(remainMs / 1000);
    startNoiseLayer(t, remainMs / 1000);
    await sleep(remainMs);
    if(cancelled()) return;
  }
  if(cancelled()) return;
  // the timeout passed with nobody flipping it: the needle lifts on its
  // own and the platter spins down (§4's second bullet) -- the record
  // keeps waiting, just silently now, until a flip or a new pull.
  liftNeedleNow();
}

// The flip itself, whether it comes from the player's own "Flip to Side B"
// button or a lock-screen/headphone/car Next or Play (player/controls.js's
// nextTrack(), player/transport.js's play()) -- all three routes end up
// here. No lift/turn animation of its own: the same snap-straight-to-side-B
// shape interruptRunout() used for the old always-on flip, since this is a
// discrete action, not a continuous ceremony, and two of its three callers
// (the lock screen, headphones) have no screen to animate on.
//
// Deliberately NOT reached from a generic tap anywhere on the open player
// (interruptRunout(), below) the way the old always-on flip animation was --
// see that function's own comment for why a "wait" has to stay off that path.
export function performPendingFlip(){
  const r = S.runout;
  if(!r || r.kind !== 'wait') return false;
  const n = r.n;
  cancelRunout();
  S.sleeveSeq++;
  $('#platterBox').classList.remove('disc-hidden');
  S.qpos = n;
  load(S.queue[n]);
  play();
  return true;
}

// A tap on the player while the groove or a flip is running snaps to where
// it was heading: the empty slipmat, or side B playing. True if it did.
//
// docs/15_SURFACE_NOISE.md §4: a 'wait' is deliberately excluded. Unlike
// 'end'/'flip' -- a brief, ~2.5s/~700ms animation genuinely in flight, where
// "any tap on the player skips to where it was heading" is a reasonable
// shortcut -- a wait can last indefinitely, and this is reached from the
// player overlay's own generic pointerdown handler (wiring/transport.js),
// which fires on every tap anywhere in the overlay, including the player's
// own "Flip to Side B"/"Lift needle" buttons themselves: pointerdown always
// precedes a button's own click, so without this guard, tapping either
// button (or the scrub bar, or anything else on the open player) would
// perform the flip right here, out from under the button's own handler,
// before that handler ever runs. A wait only ever ends through
// performPendingFlip() (the Flip button, or a lock-screen/headphone Next
// or Play), liftNeedleNow() (the Lift needle button), or a new pull
// (runStartSequence()'s own unconditional cancelRunout() call) -- never a
// stray tap.
export function interruptRunout(){
  const r = S.runout;
  if(!r || r.kind === 'wait') return false;
  cancelRunout();
  S.sleeveSeq++;
  if(r.kind === 'end'){
    // RW4: an 'end' ceremony interrupted mid-flight was heading for the
    // held sleeve (r.reason/r.pendingIndex, stashed by runToHeldSleeve()),
    // same final state a tap landing after it finished would reach --
    // land there directly instead of the old empty-slipmat shortcut.
    const t = current();
    if(t && r.reason) holdSleeve(t, r.reason, r.pendingIndex);
    else { putAwayInstant(); clearToRest(); }
  } else {
    $('#platterBox').classList.remove('disc-hidden');
    S.qpos = r.n;
    load(S.queue[r.n]);
    play();
  }
  return true;
}
