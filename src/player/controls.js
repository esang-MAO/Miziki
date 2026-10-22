import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { reorderQueue, skipWithLift } from './queue.js';
import { invalidateActiveSessionIfAny } from '../history/sessions.js';
import { performPendingFlip } from '../shell/runout.js';

// docs/15_SURFACE_NOISE.md §3: every manual Next/Previous (including the
// lock-screen/headphone/car controls, which call these same two
// functions -- src/player/background.js) goes through the needle-lift
// skip sequence, not a plain index change -- see queue.js's own entry for
// why that's the one function both routes through.
//
// §4, Auto-flip Off: with the record waiting in the run-out for a flip
// (shell/runout.js's own S.runout.kind === 'wait'), there's no "next" or
// "previous" track to lift to yet -- side B hasn't loaded -- so both
// instead perform the flip itself. This is also what makes "lock-screen
// Next performs the flip" true for free: the lock screen's own
// previoustrack/nexttrack handlers (player/background.js) call these same
// two functions, unchanged.
export function nextTrack(){
  if(S.runout && S.runout.kind === 'wait'){ performPendingFlip(); return; }
  skipWithLift(1);
}
export function prevTrack(){
  if(S.runout && S.runout.kind === 'wait'){ performPendingFlip(); return; }
  // §3: "Previous within the first 3 s goes to the previous track;
  // otherwise it restarts the current track. Both use the lift/drop."
  skipWithLift(S.pos > 4 ? 0 : -1);
}

export function toggleShuffle(){
  S.shuffle = !S.shuffle;
  if(S.shuffle) invalidateActiveSessionIfAny();
  reorderQueue();
  const b = $('#shuffle');
  b.setAttribute('aria-pressed', String(S.shuffle));
  b.title = S.shuffle ? 'Shuffle on' : 'Shuffle off';
}

export function cycleRepeat(){
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  const b = $('#repeat');
  b.setAttribute('aria-pressed', String(S.repeat !== 'off'));
  b.dataset.mode = S.repeat;
  b.title = S.repeat === 'off' ? 'Repeat off' : S.repeat === 'all' ? 'Repeat all' : 'Repeat this track';
  $('#repeatOne').style.display = S.repeat === 'one' ? '' : 'none';
}
