import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { seek } from './transport.js';
import { advance, reorderQueue } from './queue.js';
import { invalidateActiveSessionIfAny } from '../history/sessions.js';

export function nextTrack(){ advance(1, false); }
export function prevTrack(){
  if(S.pos > 4){ seek(0); return; }
  advance(-1, false);
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
