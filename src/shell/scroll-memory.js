// NV3 (docs/11_SMOOTH_NAVIGATION.md): per-tab/per-view scroll-position
// memory. The whole app is one scroller (body — see CLAUDE.md's own
// "single-scroller architecture" note, confirmed by src/styles/00-base.css's
// .wrap having no overflow of its own), so "a tab's own scroll position" is
// just window.scrollY at the moment that tab stops being the one on screen.
//
// A plain Map keyed by caller-chosen string (e.g. 'route:library',
// 'sundown-view:sound') — callers (shell/routes.js) are responsible for
// calling saveScrollPosition() for the view being left and
// restoreScrollPosition() for the view being entered, around whatever DOM
// toggling actually switches the visible content. Zero imports of its own,
// so it's fully testable with a fake `window` — same precedent as
// shell/nav-stack.js.
const positions = new Map();

export function saveScrollPosition(key){
  if(!key || typeof window === 'undefined') return;
  positions.set(key, window.scrollY || 0);
}

export function restoreScrollPosition(key){
  if(typeof window === 'undefined') return;
  const y = key ? (positions.get(key) || 0) : 0;
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
