// D3 (docs/DESKTOP_LAYOUT.md) — the one place the desktop/phone
// breakpoint is named in JavaScript. The breakpoint itself still has to
// be repeated once more, unavoidably, in the CSS media query
// (src/styles/23-desktop.css) that a script can't read directly — this
// module exists so every other script asking "is the desktop shell
// active right now" reads it from one place rather than re-typing 1024
// as a magic number, the same reasoning util/motion.js's REDUCED already
// follows for a different media feature.
export const DESKTOP_BREAKPOINT_PX = 1024;

export function isDesktopShell(){
  try { return window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`).matches; }
  catch(_e){ return false; }
}
