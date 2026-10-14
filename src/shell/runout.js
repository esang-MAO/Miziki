import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { REDUCED } from '../util/motion.js';
import { isDesktopShell } from '../util/viewport.js';
import { albumKey } from '../record-art/tiers.js';
import { applyDiscVariant } from '../record-art/looks.js';
import { albumTracks } from '../library/model.js';
import { renderTracks } from '../library/view.js';
import { load, play, pause } from '../player/transport.js';
import { drawTime } from '../player/clock.js';
import { stopSleepState } from '../player/sleep-timer.js';
import { startRunout } from '../audio/runout.js';
import { updateGatefoldNowPlaying } from '../gatefold/view.js';
import { GROOVE, FLIP, splitSides, sideTurn } from './ceremony-timing.js';
import { renderMiniPlayer } from './mini-player.js';
import { renderPlayerSidePanel } from './player-side-panel.js';
import { forceCloseLayer } from './nav-stack.js';
import { shouldPutAway, putAwayInstant, runPutAwaySequence, startSpinDown } from './put-away.js';

/* ================= run-out groove, rest, side flip (docs/CEREMONY.md §2, §3) =================
   §2: the last record of the queue ends, the needle rides the run-out groove
   for a moment, the record goes back in its sleeve, and the player clears to
   an empty slipmat. §3: the last track of side A ends with side B still to
   come, so the record is lifted and turned over before side B plays.
   S.runout is the in-flight state ({kind:'end'|'flip', turning, n, to}),
   runtime only, never saved. Every await is followed by the same S.sleeveSeq
   token check the pull and put-away use, so a tap or a new pull cancels it. */

let groove = null;

function stopGroove(fadeMs){ if(groove){ groove.stop(fadeMs); groove = null; } }

// Drops whatever run-out/flip is in flight without landing it anywhere.
// Safe to call any time, any number of times.
export function cancelRunout(){
  stopGroove(0);
  S.runout = null;
  const stage = $('#platterStage');
  if(stage) stage.classList.remove('runout', 'flipping');
  const letter = $('#sideLetter');
  if(letter) letter.textContent = '';
}

// The rest state: nothing loaded, the platter empty. Same clear-out order
// forgetLibrary()'s empty-library branch already uses (library/delete.js).
// Desktop keeps the player open on the empty slipmat; a phone slides it shut.
export function clearToRest(){
  S.queue = []; S.baseQueue = []; S.qpos = 0;
  S.index = -1; S.pendingShellInfo = null; S.shellAlbumId = null;
  S.outgoingArt = null; S.outgoingHasArt = false;
  if(typeof MizikiSocial !== 'undefined') MizikiSocial.stopSpinning();
  $('#trackName').textContent = 'Nothing on the platter';
  $('#trackBy').textContent = ''; $('#trackSpec').textContent = 'Load a file to see its signal path';
  $('#label').classList.remove('has-art'); $('#labelArt').removeAttribute('src');
  applyDiscVariant(null);
  if(S.playerOpen && !isDesktopShell()) forceCloseLayer('player');
  $('#platterBox').classList.add('disc-hidden');
  $('#sleeve').style.display = 'none';
  S.platterEmpty = true;
  ['#playerShareBtn', '#queueBtn', '#sleepTimerBtn', '#trackInfoBtn', '#playerFavBtn']
    .forEach(sel => { const b = $(sel); if(b) b.style.display = 'none'; });
  stopSleepState();
  renderMiniPlayer();
  renderPlayerSidePanel();
  drawTime();
  renderTracks();
  updateGatefoldNowPlaying();
}

// advance()'s end-of-queue branch, after it has already paused. A manual
// skip past the last track keeps the old behavior (nothing clears). A real
// finish runs the groove and the put-away where there's something to see,
// otherwise (Pure, the setting off, the player closed, the page hidden)
// cuts straight to the same final state.
export async function endOfQueue(auto){
  if(!auto) return;
  const t = current();
  if(!t || S.mode === 'pure' || !shouldPutAway(auto) || !S.playerOpen || document.hidden){
    putAwayInstant();
    clearToRest();
    return;
  }
  const stage = $('#platterStage');
  const token = ++S.sleeveSeq;
  const cancelled = () => {
    if(token === S.sleeveSeq && !S.playing) return false;
    if(S.runout && S.runout.kind === 'end') cancelRunout();
    return true;
  };
  S.runout = {kind:'end', turning:true};
  stage.classList.add('runout');
  groove = startRunout((GROOVE.ms + GROOVE.spinDownMs) / 1000);
  await sleep(GROOVE.ms);
  if(cancelled()) return;
  stopGroove(GROOVE.spinDownMs);
  S.runout.turning = false;
  startSpinDown(GROOVE.spinDownMs);
  stage.classList.remove('runout');
  await sleep(GROOVE.spinDownMs);
  if(cancelled()) return;
  await runPutAwaySequence(t, {skipSpin:true, token});
  if(cancelled()) return;
  S.runout = null;
  clearToRest();
}

// §3: true (and the flip started) when an automatic advance moves from the
// last track of one side straight onto the first of the next, in Vinyl,
// with the player open and visible. advance() then does nothing more.
export function maybeSideFlip(n){
  if(S.mode === 'pure' || !S.albumSides || !S.playerOpen || document.hidden || REDUCED) return false;
  if(!S.sleevePullEnabled || S.shuffle) return false;
  const cur = current(), next = S.tracks[S.queue[n]];
  if(!cur || !next || albumKey(cur) !== albumKey(next)) return false;
  const turn = sideTurn(splitSides(albumTracks(cur.tags.album), S.tracks, S.albumSides), S.index, S.queue[n]);
  if(!turn) return false;
  runSideFlip(n, turn);
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
  await sleep(FLIP.grooveMs);
  if(cancelled()) return;
  stopGroove(150);
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

// A tap on the player while the groove or a flip is running snaps to where
// it was heading: the empty slipmat, or side B playing. True if it did.
export function interruptRunout(){
  const r = S.runout;
  if(!r) return false;
  cancelRunout();
  S.sleeveSeq++;
  if(r.kind === 'end'){
    putAwayInstant();
    clearToRest();
  } else {
    $('#platterBox').classList.remove('disc-hidden');
    S.qpos = r.n;
    load(S.queue[r.n]);
    play();
  }
  return true;
}
