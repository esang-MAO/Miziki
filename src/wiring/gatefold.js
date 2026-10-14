/* ================= wiring: gatefold and sealed-record sheet =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the gatefold's own
   back/panel/resize controls and the sealed-record sheet's close button.
   The cross-cutting Escape-key handler that used to live here (closing
   whichever of the gatefold/sealed sheet/add menu/search field was open, in
   a hand-written priority order covering only four of the app's ~13
   overlays) moved to src/shell/nav-stack.js (NV2,
   docs/11_SMOOTH_NAVIGATION.md) — a single generic handler that closes
   whichever registered layer is topmost, for every overlay in the app, not
   just these four. Every function called here was already a real export of
   its owning module. */
import { $ } from '../util/dom.js';
import { gatefoldSwitchPanel, updateGatefoldScale } from '../gatefold/view.js';
import { closeLayer } from '../shell/nav-stack.js';

export function wireGatefold(){
  $('#gfBack').addEventListener('click', () => closeLayer('gatefold'));
  $('#gfFlatBack').addEventListener('click', () => closeLayer('gatefold'));
  $('#gfLeftCue').addEventListener('click', () => gatefoldSwitchPanel('left'));
  document.querySelectorAll('#gfPanelToggle [data-panel], #gfFlatSeg [data-panel]').forEach(b =>
    b.addEventListener('click', () => gatefoldSwitchPanel(b.dataset.panel)));
  window.addEventListener('resize', updateGatefoldScale);
  $('#sealSheetClose').addEventListener('click', () => closeLayer('sealed-sheet'));
}
