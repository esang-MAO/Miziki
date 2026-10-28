/* ================= wiring: gatefold and sealed-record sheet =================
   The gatefold's own back/panel/resize controls and the sealed-record
   sheet's close button. The global Escape-key handler lives in
   src/shell/nav-stack.js (NV2, docs/11_SMOOTH_NAVIGATION.md) instead — a
   single generic handler that closes whichever registered layer is
   topmost, for every overlay in the app — not here. */
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
