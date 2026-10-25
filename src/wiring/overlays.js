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
   Back/Escape use. The look picker and the library sort menu used to be
   small, direct-open/close popovers with no Back/Escape/tap-outside
   support at all — an accepted, documented gap under NV2's own plan.
   Closed now (openLookPicker/openSortMenu register themselves with
   nav-stack too, same as every other sheet), so their close buttons go
   through closeLayer() the same way the queue sheet's does. */
import { $ } from '../util/dom.js';
import { openQueueSheet, saveQueueAsPlaylist, undoQueueChange } from '../player/queue.js';
import { openLookPicker } from '../record-art/looks.js';
import { closeLayer } from '../shell/nav-stack.js';

export function wireOverlays(){
  $('#lookBtn').addEventListener('click', openLookPicker);
  $('#queueBtn').addEventListener('click', openQueueSheet);
  $('#miniQueueBtn').addEventListener('click', openQueueSheet);
  $('#queueClose').addEventListener('click', () => closeLayer('queue'));
  // AU8 (docs/16_AUDIO.md §6): the queue sheet's own header action and its
  // shared undo toast — Clear Upcoming's own button is rendered fresh by
  // renderQueueSheet() each repaint, wired inline there instead.
  $('#queueSaveBtn').addEventListener('click', saveQueueAsPlaylist);
  $('#queueUndoBtn').addEventListener('click', undoQueueChange);
  $('#lookClose').addEventListener('click', () => closeLayer('look'));
  $('#sortMenuClose').addEventListener('click', () => closeLayer('sort-menu'));
}
