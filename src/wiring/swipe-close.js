// NV5 (docs/11_SMOOTH_NAVIGATION.md): wires swipe-to-close onto every sheet
// the plan names by name -- the queue, credits, edit, share (both the My
// Crate and Now Playing variants), sleep and record sheets -- plus the full
// player, each keyed by its own nav-stack layer id (the same ids every
// close button in src/wiring/ already closes via closeLayer(), see
// overlays.js/edit.js/share.js/transport.js/account.js). Deliberately not
// wired onto confirmOverlay/dupOverlay/dupScanOverlay/socialAuthOverlay/
// socialNavOverlay -- those aren't in the plan's own named list, and an
// accidental swipe dismissing a destructive confirmation or a duplicate-
// scan screen would be a real regression, not a convenience.
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { closeLayer } from '../shell/nav-stack.js';
import { wireSwipeToClose } from '../shell/swipe-close.js';
import { toggleFocus } from '../player/queue.js';

const SHEETS = [
  { sheet: '#queueSheetBox', layer: 'queue' },
  { sheet: '#creditsSheetBox', layer: 'credits' },
  { sheet: '#editSheetBox', layer: 'edit' },
  { sheet: '#shareSheetBox', layer: 'share' },
  { sheet: '#sleepSheetBox', layer: 'sleep' },
  { sheet: '#recordSheetBox', layer: 'record-sheet' },
];

export function wireSwipeClose(){
  SHEETS.forEach(({ sheet, layer }) => {
    const el = $(sheet);
    if(el) wireSwipeToClose(el, { onClose: () => closeLayer(layer) });
  });
  // The full player is its own sheet (.player-overlay, not .edit-sheet),
  // and it's the one case the plan itself calls out a start restriction
  // for: "the player's swipe only starts on the header area, or outside
  // the disc," so it never competes with spin-to-scrub on the platter
  // (#platterStage, src/player/scrub.js).
  const player = $('#playerOverlay');
  if(player){
    wireSwipeToClose(player, {
      // FS10 (docs/25_FROM_SCRATCH.md point 2): "the player can't be
      // minimised into the mini-bar" while Focus is on -- the same swipe
      // that would otherwise minimize instead ends Focus, same as Done,
      // and the player stays open at its ordinary (non-Focus) state.
      onClose: () => { if(S.focus) toggleFocus(); else closeLayer('player'); },
      isValidStart: (ev) => !ev.target.closest('#platterStage'),
    });
  }
}
