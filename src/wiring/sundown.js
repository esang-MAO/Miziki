/* ================= wiring: Sundown panel =================
   The Day/Sound tab switch (selectSundownView itself lives in
   src/shell/routes.js, not here — see that module's own comment for
   why), the one "How deep the night goes" control ([data-depth], four
   buttons: Off is Auto off; Gentle/Medium/Deep set Auto on and S.target
   to one of three values), the preview slider's dial gesture, and the
   sheet's own ways-in (the sun knob, the mini-player's sun button, the
   sidebar's Sundown card, the sheet's own close button/scrim/drag —
   src/shell/sundown-sheet.js).

   S.manualRate and S.pace are untouched here -- a saved non-default
   value for either (there's no UI left to set manualRate away from 1,
   but an old save might still carry one; Moment pacing still can) keeps
   applying with no visible control, per the "no pref is deleted" rule
   (docs/12_REFINE.md). */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { queueSave } from '../storage/meta.js';
import { selectSundownView, lastSundownView } from '../shell/routes.js';
import { wireDialGesture } from '../sundown/dial-gesture.js';
import { DEPTH_TARGETS, depthKeyFor, depthCaptionFor } from '../sundown/solar.js';
import { syncSundownSheetHeight, wireSundownSheetEntryPoints } from '../shell/sundown-sheet.js';

function paintDepth(){
  const key = depthKeyFor(S.auto, S.target);
  document.querySelectorAll('[data-depth]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.depth === key)));
  const desc = $('#depthDesc');
  if(desc) desc.textContent = depthCaptionFor(key, S.target);
}

export function wireSundown(){
  document.querySelectorAll('[data-sundown-view]').forEach(b =>
    b.addEventListener('click', () => {
      selectSundownView(b.dataset.sundownView);
      syncSundownSheetHeight(b.dataset.sundownView);
    }));
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

  wireSundownSheetEntryPoints();
}
