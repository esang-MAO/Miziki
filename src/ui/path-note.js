import { S, current } from '../state.js';
import { $ } from '../util/dom.js';

export function setPathNote(msg, warn){
  const el = $('#pathNote');
  if(msg){ el.textContent = msg; el.className = 'note' + (warn ? ' warn' : ''); return; }
  const t = current();
  el.className = 'note';
  if(!t){ el.textContent = ''; return; }
  if(!t.meta.lossless){
    el.textContent = 'Signal path: ' + t.meta.codec + ' is lossy, so detail was already discarded before Miziki saw it. '
      + 'It plays, and the platter and character still work — but the clean-path discipline has nothing left to protect.';
    return;
  }
  if(!S.ctx){ el.textContent = 'Signal path: ' + t.meta.codec + ' ' + (t.meta.rate/1000).toFixed(1) + ' kHz. Press play to see the output path.'; return; }
  el.textContent = 'Signal path: ' + t.meta.codec + ' ' + (t.meta.rate/1000).toFixed(1) + ' kHz → float32 engine → output '
    + (S.ctx.sampleRate/1000).toFixed(1) + ' kHz. ' + (S.ctx.sampleRate === t.meta.rate
      ? 'No resampling anywhere in the path.' : 'This device would not open an output at the file rate, so one conversion happens at the end.');
}
