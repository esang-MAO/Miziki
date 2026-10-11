/* ================= wiring: gatefold and sealed-record sheet =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the gatefold's own
   back/panel/resize controls, the sealed-record sheet's close button,
   and the global Escape-key handler (which closes whichever of the
   gatefold/sealed sheet/add menu/search field is open, in that
   priority order — a cross-cutting shortcut, not any one area's own
   code, so it lives here next to the two overlays it closes first).
   Every function called here was already a real export of its owning
   module. */
import { $ } from '../util/dom.js';
import { isGatefoldOpen, closeGatefold, gatefoldSwitchPanel, updateGatefoldScale } from '../gatefold/view.js';
import { isSealedSheetOpen, closeSealedSheet } from '../gatefold/sealed-sheet.js';
import { isAddMenuOpen, closeAddMenu, isSearchFieldOpen, closeSearchField } from '../shell/header.js';
import { renderTracks } from '../library/view.js';

export function wireGatefold(){
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    if(isGatefoldOpen()) closeGatefold();
    else if(isSealedSheetOpen()) closeSealedSheet();
    else if(isAddMenuOpen()){ closeAddMenu(); $('#hdrAddBtn').focus(); }
    else if(isSearchFieldOpen()){ $('#librarySearch').value = ''; closeSearchField(); renderTracks(); }
  });

  $('#gfBack').addEventListener('click', closeGatefold);
  $('#gfFlatBack').addEventListener('click', closeGatefold);
  $('#gfLeftCue').addEventListener('click', () => gatefoldSwitchPanel('left'));
  document.querySelectorAll('#gfPanelToggle [data-panel], #gfFlatSeg [data-panel]').forEach(b =>
    b.addEventListener('click', () => gatefoldSwitchPanel(b.dataset.panel)));
  window.addEventListener('resize', updateGatefoldScale);
  $('#sealSheetClose').addEventListener('click', closeSealedSheet);
}
