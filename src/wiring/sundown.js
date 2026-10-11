/* ================= wiring: Sundown panel =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the auto/manual
   toggle, the manual-rate slider, the full-night-rate target buttons,
   the pacing buttons, and the preview slider. Every function called
   here was already a real export of its owning module. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { nowClock } from '../sundown/solar.js';
import { queueSave } from '../storage/meta.js';

export function wireSundown(){
  $('#autoOn').addEventListener('click', ()=>{
    S.auto = true; $('#autoOn').setAttribute('aria-pressed','true'); $('#autoOff').setAttribute('aria-pressed','false');
    $('#manualRow').style.display = 'none';
    $('#autoDesc').textContent = 'The platter eases down across twilight.';
  });
  $('#autoOff').addEventListener('click', ()=>{
    S.auto = false; $('#autoOn').setAttribute('aria-pressed','false'); $('#autoOff').setAttribute('aria-pressed','true');
    $('#manualRow').style.display = 'block';
    $('#autoDesc').textContent = 'You are driving the platter yourself.';
  });
  $('#manual').addEventListener('input', e=>{
    S.manualRate = e.target.value/1000;
    $('#manualOut').textContent = S.manualRate.toFixed(3) + '×';
  });

  document.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', ()=>{
    S.target = parseFloat(b.dataset.target); queueSave();
    document.querySelectorAll('[data-target]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  document.querySelectorAll('[data-pace]').forEach(b => b.addEventListener('click', ()=>{
    S.pace = b.dataset.pace; queueSave();
    document.querySelectorAll('[data-pace]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#pacingDesc').textContent = S.pace === 'window'
      ? 'Spread across the whole twilight window.'
      : 'Held back, then a felt drop near the end.';
  }));

  $('#preview').addEventListener('input', e=>{
    const v = +e.target.value;
    if(!S.sun.ok || v === 0){ S.previewMin = 0; $('#previewOut').textContent = 'Live'; return; }
    const span = (S.sun.dusk - S.sun.set)/60000;
    const from = (S.sun.set - Date.now())/60000 - 5;
    S.previewMin = from + (v/100) * (span + 12);
    const c = nowClock();
    $('#previewOut').textContent = c.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  });
  $('#liveBtn').addEventListener('click', ()=>{ S.previewMin = 0; $('#preview').value = 0; $('#previewOut').textContent = 'Live'; });
}
