/* ================= wiring: Sundown panel =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the auto/manual
   toggle, the manual-rate slider, the full-night-rate target buttons,
   the pacing buttons, and the preview slider. Every function called
   here was already a real export of its owning module.

   DA3 (docs/DAY_ARC.md) added the Day/Sound tab switch (selectSundownView
   itself lives in src/shell/routes.js, not here — see that module's own
   comment for why) and rewrote the preview slider from a sunset-window-
   relative formula to a direct 24h-from-now minute offset, matching the
   mockup's own <input min="0" max="1440">. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { nowClock } from '../sundown/solar.js';
import { queueSave } from '../storage/meta.js';
import { selectSundownView, lastSundownView } from '../shell/routes.js';

export function wireSundown(){
  document.querySelectorAll('[data-sundown-view]').forEach(b =>
    b.addEventListener('click', () => selectSundownView(b.dataset.sundownView)));
  $('#dayDriftLink').addEventListener('click', () => selectSundownView('sound'));
  // restores whichever view this device last had open (default Day) —
  // the one-time call belongs here, not in selectSundownView() itself,
  // since every later call is a real user action, not a boot-time restore.
  selectSundownView(lastSundownView());

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

  // DA3: the slider's own value is now the direct minute offset from
  // "now" (0..1440, a full day), not a 0..100 position mapped onto the
  // sunset->dusk window — S.previewMin already means exactly this to
  // every consumer (nowClock(), currentDayPosition(), sunProgress(),
  // easedProgress(), computeRate(), and, since DA2, effectiveChar() via
  // currentDayPosition()), so this is a UI simplification, not a new
  // capability: "preview the day" needed no change anywhere else.
  $('#preview').addEventListener('input', e=>{
    const v = +e.target.value;
    S.previewMin = v;
    const eyebrow = $('#sundownEyebrow');
    if(v === 0){
      $('#previewOut').textContent = 'Live';
      if(eyebrow){ eyebrow.textContent = 'Now'; eyebrow.classList.remove('sd-previewing'); }
      return;
    }
    const c = nowClock();
    const label = c.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('#previewOut').textContent = label;
    if(eyebrow){ eyebrow.textContent = 'Previewing · ' + label; eyebrow.classList.add('sd-previewing'); }
  });
  $('#liveBtn').addEventListener('click', ()=>{
    S.previewMin = 0; $('#preview').value = 0; $('#previewOut').textContent = 'Live';
    const eyebrow = $('#sundownEyebrow');
    if(eyebrow){ eyebrow.textContent = 'Now'; eyebrow.classList.remove('sd-previewing'); }
  });
}
