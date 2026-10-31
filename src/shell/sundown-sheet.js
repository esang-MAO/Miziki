/* ================= Sundown sheet (RF26, docs/12_REFINE.md) =================
   Sundown stopped being a tab-bar route in this step — its Day/Sound
   content (DA3/RF9's own, byte-for-byte unchanged markup and wiring,
   src/wiring/sundown.js) now lives in a sheet opened from any of five
   places: the sun knob on the platter (#sunKnob), the sun button on the
   mini-player (#miniSunBtn), the desktop sidebar's own Sundown summary
   (#sidebarSundown), the full player's own phase pill (#nowPhasePill,
   FS5, docs/25_FROM_SCRATCH.md point 6), and Settings › Sundown
   (src/profile/screens.js).

   Registered with the NV2 layer stack (src/shell/nav-stack.js) the same
   way every other sheet in the app is — Back/Escape/the scrim all close
   it through closeLayer('sundown-sheet'), never a direct call to the
   teardown function below (see wiring/overlays.js's own queue-sheet
   comment for why that distinction matters: a direct call would leave a
   stale history entry for a later Back press to trip over).

   Half/full height is a plain class toggle (.full on #sundownSheet) —
   opening defaults to whichever of Day/Sound was last selected (Day →
   half, Sound → full, matching the mockup's own "Day" and "Full height
   (drag up, or Sound)" rule), tapping a tab re-syncs it to that view's
   own default, and a drag on the grabber overrides it for the rest of
   this open/close cycle. There is no pure, DOM-free core to unit-test
   here, the same "not much here is pure" shape shell/put-away.js's own
   choreography already has (see tests/unit/shell.test.js) — this is
   covered by the Playwright device checklist instead. */
import { $ } from '../util/dom.js';
import { openLayer, closeLayer } from './nav-stack.js';
import { selectSundownView, lastSundownView } from './routes.js';

const DRAG_OPEN_THRESHOLD = 60;   // px dragged up past half-height to snap to full
const DRAG_CLOSE_THRESHOLD = 120; // px dragged down past half-height to dismiss

// Called on open and on every explicit Day/Sound tab tap (src/wiring/
// sundown.js) — the view's own default height, overridden only by an
// in-progress drag.
export function syncSundownSheetHeight(view){
  const sheet = $('#sundownSheet');
  if(sheet) sheet.classList.toggle('full', view === 'sound');
}

// The teardown nav-stack calls on every close, however it started (the
// close button, the scrim, Back, Escape) — never call this directly from
// a UI element; go through closeLayer('sundown-sheet') instead, the same
// rule every other sheet in this app follows.
function teardownSundownSheet(){
  const sheet = $('#sundownSheet');
  if(sheet){
    sheet.classList.remove('open', 'full', 'dragging');
    sheet.style.removeProperty('--sundown-drag-dy');
    sheet.setAttribute('aria-hidden', 'true');
  }
  const scrim = $('#sundownSheetScrim');
  if(scrim) scrim.classList.remove('open');
  // Deliberately a no-op: closing the sheet does NOT snap the preview back
  // to live time. Previewing the night, then dismissing the sheet to go do
  // something else, should leave the preview running rather than quietly
  // cancel it — S.previewMin simply carries over to the sheet's next open,
  // exactly as if the sheet had never closed at all.
}

export function openSundownSheet(view){
  const sheet = $('#sundownSheet'), scrim = $('#sundownSheetScrim');
  if(!sheet) return;
  const v = view === 'sound' || view === 'day' ? view : lastSundownView();
  selectSundownView(v);
  syncSundownSheetHeight(v);
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  if(scrim) scrim.classList.add('open');
  // Both the sheet and its own scrim are top-level siblings here, not one
  // nested inside the other (unlike every .edit-overlay/.share-overlay in
  // this app, which is a single element doubling as its own backdrop) --
  // nav-stack.js's own container list has to protect both, or the scrim
  // gets marked `inert` as "just another background sibling" and silently
  // loses the tap-to-dismiss its own `.open{pointer-events:auto}` CSS rule
  // is there to give it (`inert`'s UA style wins over author CSS).
  openLayer('sundown-sheet', teardownSundownSheet, { container: scrim ? [sheet, scrim] : sheet });
}

function wireSundownSheetClose(){
  const closeBtn = $('#sundownSheetClose'), scrim = $('#sundownSheetScrim');
  if(closeBtn) closeBtn.addEventListener('click', () => closeLayer('sundown-sheet'));
  if(scrim) scrim.addEventListener('click', () => closeLayer('sundown-sheet'));
}

// A plain pointer drag on the grabber: up past the threshold snaps to
// full height; down past the close threshold dismisses the sheet outright
// — from either height, not just half, so one continuous pull all the way
// down closes it from full too, the same "all the way up or down" shape a
// drag from half has. Short of that, it snaps back to whichever height it
// started at. --sundown-drag-dy tracks the live finger position only while
// dragging (src/styles/26-sundown-sheet.css); the snapped end state is
// always one of the two fixed heights or closed, never a value frozen
// mid-drag.
function wireSundownSheetDrag(){
  const sheet = $('#sundownSheet'), grabber = $('#sundownSheetGrabber');
  if(!sheet || !grabber) return;
  let startY = null, startFull = false, dragging = false;
  grabber.addEventListener('pointerdown', ev => {
    dragging = true; startY = ev.clientY; startFull = sheet.classList.contains('full');
    sheet.classList.add('dragging');
    try{ grabber.setPointerCapture(ev.pointerId); }catch(_e){}
  });
  grabber.addEventListener('pointermove', ev => {
    if(!dragging) return;
    sheet.style.setProperty('--sundown-drag-dy', (ev.clientY - startY) + 'px');
  });
  function endDrag(ev){
    if(!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.removeProperty('--sundown-drag-dy');
    const dy = ev.clientY - startY;
    if(dy > DRAG_CLOSE_THRESHOLD){ closeLayer('sundown-sheet'); return; }
    if(!startFull && dy < -DRAG_OPEN_THRESHOLD) sheet.classList.add('full');
    else if(startFull && dy > DRAG_OPEN_THRESHOLD) sheet.classList.remove('full');
  }
  grabber.addEventListener('pointerup', endDrag);
  grabber.addEventListener('pointercancel', endDrag);
}

// Ways in — called once at boot (src/wiring/sundown.js), alongside that
// file's own Day/Sound tab wiring.
export function wireSundownSheetEntryPoints(){
  const knob = $('#sunKnob');
  if(knob) knob.addEventListener('click', () => openSundownSheet());
  const miniSun = $('#miniSunBtn');
  if(miniSun) miniSun.addEventListener('click', () => openSundownSheet());
  // D3 (docs/DESKTOP_LAYOUT.md): the desktop sidebar's own Sundown summary
  // — "no sheet on desktop, a right-side panel instead" is a CSS-only
  // distinction (src/styles/26-sundown-sheet.css re-anchors #sundownSheet
  // to the right edge, full height, no scrim, at the 1024px breakpoint),
  // so the same open call works for both.
  const sidebarCard = $('#sidebarSundown');
  if(sidebarCard) sidebarCard.addEventListener('click', () => openSundownSheet());
  // FS5 (docs/25_FROM_SCRATCH.md point 6): the bottom row's own sun
  // icon + phase word, a fifth way in alongside the four above.
  const phasePill = $('#nowPhasePill');
  if(phasePill) phasePill.addEventListener('click', () => openSundownSheet());
  wireSundownSheetClose();
  wireSundownSheetDrag();
}
