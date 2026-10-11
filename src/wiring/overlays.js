/* ================= wiring: small sheet toggles =================
   Moved out of main.js's "wiring" IIFE (step 7f) — three small,
   single-button sheet openers/closers that don't belong to any of the
   other wiring areas' own files: the queue sheet, the look picker, and
   the library sort menu. Every function called here was already a
   real export of its owning module. */
import { $ } from '../util/dom.js';
import { openQueueSheet, closeQueueSheet } from '../player/queue.js';
import { openLookPicker, closeLookPicker } from '../record-art/looks.js';
import { closeSortMenu } from '../library/search.js';

export function wireOverlays(){
  $('#lookBtn').addEventListener('click', openLookPicker);
  $('#queueBtn').addEventListener('click', openQueueSheet);
  $('#miniQueueBtn').addEventListener('click', openQueueSheet);
  $('#queueClose').addEventListener('click', closeQueueSheet);
  $('#lookClose').addEventListener('click', closeLookPicker);
  $('#sortMenuClose').addEventListener('click', closeSortMenu);
}
