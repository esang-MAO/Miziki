/* ================= wiring: small sheet toggles =================
   Three small, single-button sheet openers/closers that don't belong to
   any of the other wiring areas' own files: the queue sheet, the look
   picker, and the library sort menu.

   NV2 (docs/11_SMOOTH_NAVIGATION.md) registers each of these with the
   nav-stack layer stack (openQueueSheet()/openLookPicker()/openSortMenu()
   do the registering, in their own owning modules), so each close button
   goes through closeLayer() instead of calling its own direct teardown
   function — the same single entry point Back/Escape/tap-outside use. */
import { $ } from '../util/dom.js';
import { openQueueSheet, saveQueueAsPlaylist, undoQueueChange } from '../player/queue.js';
import { openLookPicker } from '../record-art/looks.js';
import { closeLayer } from '../shell/nav-stack.js';

export function wireOverlays(){
  $('#lookBtn').addEventListener('click', openLookPicker);
  $('#queueBtn').addEventListener('click', openQueueSheet);
  $('#miniQueueBtn').addEventListener('click', openQueueSheet);
  // FS5 (docs/25_FROM_SCRATCH.md point 6): the bottom row's own queue
  // icon -- same opener, same hidden-until-a-track-loads rule as
  // #queueBtn (player/transport.js's load()/library/delete.js/
  // shell/runout.js all toggle both together).
  $('#playerQueueBtn').addEventListener('click', openQueueSheet);
  $('#queueClose').addEventListener('click', () => closeLayer('queue'));
  // AU8 (docs/16_AUDIO.md §6): the queue sheet's own header action and its
  // shared undo toast — Clear Upcoming's own button is rendered fresh by
  // renderQueueSheet() each repaint, wired inline there instead.
  $('#queueSaveBtn').addEventListener('click', saveQueueAsPlaylist);
  $('#queueUndoBtn').addEventListener('click', undoQueueChange);
  $('#lookClose').addEventListener('click', () => closeLayer('look'));
  $('#sortMenuClose').addEventListener('click', () => closeLayer('sort-menu'));
}
