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
import { queueSave } from '../storage/meta.js';
import { selectSundownView, lastSundownView } from '../shell/routes.js';
import { wireDialGesture } from '../sundown/dial-gesture.js';

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

  // "Preview the day" lives only on the dial now (dial-gesture.js): drag
  // or arrow-key it to write S.previewMin through the one shared
  // setPreviewMinutes(), and the NOW button (also wired there) is the one
  // way back to live. The old 0..1440 range slider and its "Back to live"
  // button were a second copy of both and are gone.
  wireDialGesture();
}
