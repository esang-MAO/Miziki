/* ================= wiring: small sheet toggles =================
   Moved out of main.js's "wiring" IIFE (step 7f) — three small,
   single-button sheet openers/closers that don't belong to any of the
   other wiring areas' own files: the queue sheet, the look picker, and
   the library sort menu. Every function called here was already a
   real export of its owning module.

   NV2 (docs/11_SMOOTH_NAVIGATION.md) registers the queue sheet with the
   nav-stack layer stack (openQueueSheet() does the registering, in
   player/queue.js), so its close button goes through closeLayer() instead
   of calling closeQueueSheet() directly — the same single entry point
   Back/Escape use. The look picker and the library sort menu are small,
   already-dismiss-anywhere popovers the plan's own layer list doesn't name
   (docs/11_SMOOTH_NAVIGATION.md's NV2 section) — left as direct opens/
   closes, an accepted, documented gap rather than scope creep. */
import { $ } from '../util/dom.js';
import { openQueueSheet } from '../player/queue.js';
import { openLookPicker, closeLookPicker } from '../record-art/looks.js';
import { closeSortMenu } from '../library/search.js';
import { closeLayer } from '../shell/nav-stack.js';

export function wireOverlays(){
  $('#lookBtn').addEventListener('click', openLookPicker);
  $('#queueBtn').addEventListener('click', openQueueSheet);
  $('#miniQueueBtn').addEventListener('click', openQueueSheet);
  $('#queueClose').addEventListener('click', () => closeLayer('queue'));
  $('#lookClose').addEventListener('click', closeLookPicker);
  $('#sortMenuClose').addEventListener('click', closeSortMenu);
}
