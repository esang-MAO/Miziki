// UN3 (docs/36_UNIFORMITY.md): the "anchor above the button, flip below
// if there's no room" math a floating popover menu (player ⋯, gatefold
// ⋯, ...) needs -- pure, so it's unit-testable without a real DOM/
// viewport. Returns the popover's absolute `top` (document-relative,
// matching `window.scrollY`-relative positioning already used by
// shell/player-overlay.js/shell/header.js).
export function anchoredMenuTop({buttonTop, buttonBottom, menuHeight, viewportHeight, scrollY, margin}){
  const fitsAbove = buttonTop >= menuHeight + margin;
  if(fitsAbove) return Math.round(buttonTop + scrollY - menuHeight - margin);
  const maxTop = scrollY + viewportHeight - menuHeight - margin;
  return Math.round(Math.max(scrollY + margin, Math.min(buttonBottom + scrollY + margin, maxTop)));
}
