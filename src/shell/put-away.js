import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { REDUCED } from '../util/motion.js';
import { SLEEVE_ANIM, renderMiniPlayer } from './mini-player.js';
import { waitAnimEnd, sleeveArtFor, applySleeveWear } from './start-sequence.js';
import { albumKey } from '../record-art/tiers.js';

/* ================= put-away: the record goes back in its sleeve =================
   Mirror image of the pull, run from advance()'s end-of-queue branch: the
   last track finished naturally, nothing is queued next, and repeat is off.
   Shares S.sleeveSeq with the pull on purpose — only one of them ever runs,
   and a pull picking up the token mid-sequence cancels this cleanly. */

// A track ending naturally at the end of the queue only goes away if the
// settings allow a ceremony at all — repeat 'off' is already guaranteed by
// the caller (advance()'s end-of-queue branch is unreachable for 'one', and
// 'all' wraps instead of ending), and `auto` tells manual skips apart from
// a real finish.
export function shouldPutAway(auto){ return auto && S.sleevePullEnabled && !REDUCED; }

export function startSpinDown(ms){ S.spinDown = {start: performance.now(), ms, from: S.rate}; }
export function clearSpinDown(){ S.spinDown = null; }

// No player open, or the page is hidden (background playback) — nothing
// would be visible either way, so skip straight to the end state rather
// than running a ceremony no one can see (mirrors advance()'s own
// "if(S.playerOpen) runStartSequence(...) else play()" for the pull).
export function putAwayInstant(){
  S.sleeveSeq++;
  clearSpinDown();
  $('#sleeve').style.display = 'none';
  $('#platterBox').classList.add('disc-hidden');
  S.platterEmpty = true;
  renderMiniPlayer();
}

// opts.token: run under a caller's own ceremony token (the run-out groove,
// shell/runout.js) instead of taking a new one; opts.skipSpin: the caller
// already spun the platter down.
export async function runPutAwaySequence(t, opts = {}){
  const stage = $('#platterStage'), discBox = $('#platterBox');
  const token = opts.token || ++S.sleeveSeq;
  const cancelled = () => token !== S.sleeveSeq;

  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging','returning','changing','putaway-in','putaway-slide','putaway-out');
  if(!opts.skipSpin) startSpinDown(SLEEVE_ANIM.putSpinMs);

  sleeveArtFor(t.art, !!t.art);
  applySleeveWear($('#sleeve'), albumKey(t));
  $('#sleeve').style.display = 'flex';
  void stage.offsetWidth;              // force a reflow so this restarts cleanly if triggered back-to-back
  stage.classList.add('putaway-in');

  // the disc slide starts 600ms in, overlapping the sleeve's own arrival —
  // a plain timer rather than waitAnimEnd since nothing here is waiting on
  // the sleeve's animation to finish, just on the clock
  await sleep(SLEEVE_ANIM.putSlideDelayMs);
  if(cancelled()) return;
  // RW4 (docs/23_RHYTHM_AND_WEAR.md): the held-sleeve final state (shell/
  // runout.js) stops the ceremony right here -- sleeve arrived, disc
  // still fully visible beside it -- instead of running the rest of the
  // put-away (the disc sliding in and disappearing, the sleeve itself
  // then hiding).
  if(opts.holdAfterArrive) return;
  stage.classList.add('putaway-slide');

  await waitAnimEnd(discBox, SLEEVE_ANIM.putSlideMs);
  if(cancelled()) return;
  // the disc has caught up to the sleeve's edge — it's "inside" now, so it
  // disappears exactly as the sleeve starts its own exit
  stage.classList.remove('putaway-in');
  discBox.classList.add('disc-hidden');
  stage.classList.add('putaway-out');

  await waitAnimEnd($('#sleeve'), SLEEVE_ANIM.putOutMs);
  if(cancelled()) return;
  stage.classList.remove('putaway-slide','putaway-out');
  $('#sleeve').style.display = 'none';
  S.platterEmpty = true;
  renderMiniPlayer();
}
