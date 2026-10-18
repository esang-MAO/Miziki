/* ================= wiring: Sundown panel =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the auto/manual
   toggle, the manual-rate slider, the full-night-rate target buttons,
   the pacing buttons, and the preview slider. Every function called
   here was already a real export of its owning module.

   DA3 (docs/DAY_ARC.md) added the Day/Sound tab switch (selectSundownView
   itself lives in src/shell/routes.js, not here — see that module's own
   comment for why) and rewrote the preview slider from a sunset-window-
   relative formula to a direct 24h-from-now minute offset, matching the
   mockup's own <input min="0" max="1440">.

   RF9 (docs/12_REFINE.md): the old Auto/Manual toggle, manual-rate
   slider, full-night-rate seg and Window/Moment pacing row collapsed
   onto one "How deep the night goes" control ([data-depth], four
   buttons). Off is Auto off; Gentle/Medium/Deep set Auto on and S.target
   to one of the three values the old seg already offered. S.manualRate
   and S.pace are untouched here -- a saved non-default value for either
   (there's no UI left to set manualRate away from 1, but an old save
   might still carry one; Moment pacing still can) keeps applying with no
   visible control, per that doc's own "no pref is deleted" rule. The
   duplicate "Character now" shortcut link into Sound is gone too --
   the Day/Sound tabs above are the one way there now. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { queueSave } from '../storage/meta.js';
import { selectSundownView, lastSundownView } from '../shell/routes.js';
import { wireDialGesture } from '../sundown/dial-gesture.js';
import { DEPTH_TARGETS, depthKeyFor, depthCaptionFor } from '../sundown/solar.js';

function paintDepth(){
  const key = depthKeyFor(S.auto, S.target);
  document.querySelectorAll('[data-depth]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.depth === key)));
  const desc = $('#depthDesc');
  if(desc) desc.textContent = depthCaptionFor(key, S.target);
}

export function wireSundown(){
  document.querySelectorAll('[data-sundown-view]').forEach(b =>
    b.addEventListener('click', () => selectSundownView(b.dataset.sundownView)));
  // restores whichever view this device last had open (default Day) —
  // the one-time call belongs here, not in selectSundownView() itself,
  // since every later call is a real user action, not a boot-time restore.
  selectSundownView(lastSundownView());

  document.querySelectorAll('[data-depth]').forEach(b => b.addEventListener('click', ()=>{
    const key = b.dataset.depth;
    if(key === 'off') S.auto = false;
    else { S.auto = true; S.target = DEPTH_TARGETS[key]; }
    queueSave();
    paintDepth();
  }));
  paintDepth();

  // "Preview the day" lives only on the dial now (dial-gesture.js): drag
  // or arrow-key it to write S.previewMin through the one shared
  // setPreviewMinutes(), and the NOW button (also wired there) is the one
  // way back to live. The old 0..1440 range slider and its "Back to live"
  // button were a second copy of both and are gone.
  wireDialGesture();
}
