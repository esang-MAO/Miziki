/* ================= wiring: small sheet toggles =================
   Small, single-button sheet openers/closers that don't belong to any of
   the other wiring areas' own files: the queue sheet, the look picker,
   the library sort menu, and (ST3, docs/32_SHELF_AND_TURNTABLES.md) the
   shelf finish sheet -- its own opener is a dynamically-built Settings
   row (src/profile/screens.js), wired inline there like every other
   settings row, so only its close button belongs here.

   NV2 (docs/11_SMOOTH_NAVIGATION.md) registers each of these with the
   nav-stack layer stack (openQueueSheet()/openLookPicker()/openSortMenu()
   do the registering, in their own owning modules), so each close button
   goes through closeLayer() instead of calling its own direct teardown
   function — the same single entry point Back/Escape/tap-outside use. */
import { $ } from '../util/dom.js';
import { openQueueSheet, saveQueueAsPlaylist, undoQueueChange } from '../player/queue.js';
import { openLookPicker } from '../record-art/looks.js';
import { closeLayer, closeLayerThen } from '../shell/nav-stack.js';
import { isDesktopShell } from '../util/viewport.js';
import { selectPlayerSideTab } from '../shell/player-side-panel.js';

export function wireOverlays(){
  // PRESSING_DRAW (docs/31_PRESSINGS_AND_LOOKS.md, PR B.3.1 point 1):
  // openLookPicker(t, opts) now takes real arguments (t defaults to
  // current()) -- wrapped so the click Event addEventListener would
  // otherwise pass as `t` can't leak in.
  $('#lookBtn').addEventListener('click', () => openLookPicker());
  // #queueBtn lives inside #playerOverflowMenu and opens 'queue' in its
  // place -- closeLayerThen() (nav-stack.js) waits for the menu's own
  // close to actually land before opening it, rather than racing that
  // close's history.go() the way an immediate openLayer() call would.
  // #miniQueueBtn/#playerQueueBtn below are outside that menu and need no
  // such close.
  $('#queueBtn').addEventListener('click', ()=>{
    closeLayerThen('player-overflow-menu', openQueueSheet);
  });
  $('#miniQueueBtn').addEventListener('click', openQueueSheet);
  // FS5 (docs/25_FROM_SCRATCH.md point 6): the bottom row's own queue
  // icon -- same hidden-until-a-track-loads rule as #queueBtn (player/
  // transport.js's load()/library/delete.js/shell/runout.js all toggle
  // both together). UN17 point 5: on desktop the side panel's "Up next"
  // tab already shows this same list right next to the player, so this
  // button switches to that tab instead of opening a second modal on
  // top of it -- the phone keeps the sheet, since it has no side panel.
  $('#playerQueueBtn').addEventListener('click', ()=>{
    if(isDesktopShell()) selectPlayerSideTab('upnext');
    else openQueueSheet();
  });
  $('#queueClose').addEventListener('click', () => closeLayer('queue'));
  // AU8 (docs/16_AUDIO.md §6): the queue sheet's own header action and its
  // shared undo toast — Clear Upcoming's own button is rendered fresh by
  // renderQueueSheet() each repaint, wired inline there instead.
  $('#queueSaveBtn').addEventListener('click', saveQueueAsPlaylist);
  $('#queueUndoBtn').addEventListener('click', undoQueueChange);
  $('#lookClose').addEventListener('click', () => closeLayer('look'));
  $('#sortMenuClose').addEventListener('click', () => closeLayer('sort-menu'));
  $('#shelfFinishClose').addEventListener('click', () => closeLayer('shelf-finish'));
  $('#turntableClose').addEventListener('click', () => closeLayer('turntable'));
}
