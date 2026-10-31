// NV3 (docs/11_SMOOTH_NAVIGATION.md): per-tab/per-view scroll-position
// memory. The whole app was one scroller (body — see CLAUDE.md's own
// "single-scroller architecture" note) when this module was written, so "a
// tab's own scroll position" was just window.scrollY at the moment that tab
// stopped being the one on screen.
//
// FS6 (docs/25_FROM_SCRATCH.md) gave the Library route its own internal
// scroller (#libBody, src/library/view.js's updateLibBodyInset()) once the
// body itself got locked there — an optional `target` param (an element)
// lets a caller save/restore that element's own scrollTop instead of the
// window's scrollY, without changing any existing call site (routes.js/
// sundown-sheet.js never pass one, so they keep reading/writing window).
//
// A plain Map keyed by caller-chosen string (e.g. 'route:library',
// 'sundown-view:sound', 'lib-view:artists:Boygenius') — callers are
// responsible for calling saveScrollPosition() for the view being left and
// restoreScrollPosition() for the view being entered, around whatever DOM
// toggling actually switches the visible content. Zero imports of its own,
// so it's fully testable with a fake `window`/element — same precedent as
// shell/nav-stack.js.
const positions = new Map();

export function saveScrollPosition(key, target){
  if(!key) return;
  if(target){ positions.set(key, target.scrollTop || 0); return; }
  if(typeof window === 'undefined') return;
  positions.set(key, window.scrollY || 0);
}

export function restoreScrollPosition(key, target){
  const y = key ? (positions.get(key) || 0) : 0;
  if(target){ target.scrollTop = y; return; }
  if(typeof window === 'undefined') return;
  window.scrollTo(0, y);
}

// Browsers restoring their own idea of scroll position on a back/forward
// navigation would race the app's own restoreScrollPosition() above (and,
// unlike this module's memory, persists only per-history-entry, not
// per-tab) — 'manual' hands the whole thing to the app, same posture NV2's
// own history.pushState()-based nav stack already assumes throughout.
export function initScrollRestoration(){
  try{ if('scrollRestoration' in history) history.scrollRestoration = 'manual'; }catch(_e){}
}

// test-only accessor — never used by app code
export function _debugPositions(){
  return new Map(positions);
}
