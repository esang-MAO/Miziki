// Ken, 2026-10-21: "allow users to easily close/'x' out of any menus that
// open or by simply clicking on another part of the screen to close it."
// Every full-screen sheet in this app already has an explicit X (or Back/
// Escape, via nav-stack.js's own generic handler) — what was missing was
// tapping the dimmed backdrop itself. Each of these overlays is one
// element doubling as its own backdrop (.edit-overlay/.share-overlay,
// position:fixed;inset:0, flex-centering a smaller sheet child inside
// itself) — unlike the Sundown sheet or the add/overflow menus, which have
// a *separate* scrim sibling (see shell/sundown-sheet.js's/shell/
// header.js's own comments on that) — so a plain "was the click target the
// overlay element itself, not something inside it" check is enough here;
// there's no second element to register with nav-stack.
//
// Deliberately NOT wired onto confirmOverlay, clearHistoryOverlay,
// dupOverlay, dupScanOverlay, socialAuthOverlay or socialNavOverlay — the
// same exclusion list src/wiring/swipe-close.js already established for
// the identical reason: an accidental tap dismissing a destructive
// confirmation or a duplicate-scan/sign-in flow would be a real
// regression, not a convenience. Also not on launchOverlay/playerOverlay
// (full-screen takeovers with nothing behind them worth tapping back to)
// or the gatefold/sealed-record sheet/Sundown sheet (each already has its
// own scrim with its own tap-to-close wiring).
import { $ } from '../util/dom.js';
import { closeLayer } from '../shell/nav-stack.js';

const OVERLAYS = [
  { overlay: '#editOverlay', layer: 'edit' },
  { overlay: '#rowMenuOverlay', layer: 'row-menu' },
  { overlay: '#creditsOverlay', layer: 'credits' },
  { overlay: '#recordSheetOverlay', layer: 'record-sheet' },
  { overlay: '#sleepOverlay', layer: 'sleep' },
  { overlay: '#sortMenuOverlay', layer: 'sort-menu' },
  { overlay: '#lookOverlay', layer: 'look' },
  { overlay: '#queueOverlay', layer: 'queue' },
  { overlay: '#shareOverlay', layer: 'share' },
  { overlay: '#playerShareOverlay', layer: 'player-share' },
  { overlay: '#bgOfferCard', layer: 'bg-offer' },
];

export function wireBackdropClose(){
  OVERLAYS.forEach(({ overlay, layer }) => {
    const el = $(overlay);
    if(!el) return;
    el.addEventListener('click', ev => {
      if(ev.target === el) closeLayer(layer);
    });
  });
}
