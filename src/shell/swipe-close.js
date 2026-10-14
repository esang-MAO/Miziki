// NV5 (docs/11_SMOOTH_NAVIGATION.md): swipe-down-to-close for the queue,
// credits, edit, share, sleep and record sheets, and the full player.
// Same split NV4's pull-to-refresh already established (src/shell/pull-
// refresh.js): the gesture-decision math is pure and unit-tested; the
// touch-event/transform wiring itself has no meaningful pure core left
// once real DOM measurement (scrollTop, getBoundingClientRect) enters the
// picture, so that part is covered by Playwright/manual preview instead of
// a unit test, the same escape valve shell/put-away.js's own tests already
// document.
//
// The spring-back and close animations are never driven from here --
// they're the sheet's own existing CSS transition (src/styles/16-edit-
// sheet.css/20-friend-store.css's .edit-sheet/.share-sheet, and src/styles
// /13-player-overlay.css's .player-overlay), already reduced-motion-guarded
// at the stylesheet level. This module only ever disables that transition
// while the finger is actually moving (so the sheet tracks 1:1, with no
// lag), then clears the override -- the CSS decides what happens next,
// including under prefers-reduced-motion, with no REDUCED branch needed
// here at all.
export const SWIPE_AXIS_LOCK_PX = 10;
export const SWIPE_COMMIT_FRACTION = 1 / 3;
export const SWIPE_COMMIT_VELOCITY_PX_MS = 0.6;

// Live tracking decision, called on every touchmove: 'idle' before the
// axis lock is reached (so a tap or a tiny jitter never arms anything),
// 'cancel' for a mostly-sideways or upward drag (a sheet only ever closes
// downward), 'dragging' once a genuine downward drag is confirmed. Mirrors
// decidePull()'s own shape (src/shell/pull-refresh.js) -- same axis lock,
// same "sideways wins, cancel" rule -- but with no scroll-position gate of
// its own: wireSwipeToClose below checks the sheet's own scrollTop before
// ever starting a gesture, so by the time this runs the drag has already
// been confirmed to start at the sheet's own top.
export function decideSwipeTrack({ dy, dx }){
  const lockedYet = Math.abs(dx) >= SWIPE_AXIS_LOCK_PX || Math.abs(dy) >= SWIPE_AXIS_LOCK_PX;
  if(!lockedYet) return 'idle';
  if(Math.abs(dx) > Math.abs(dy)) return 'cancel';
  if(dy <= 0) return 'cancel';
  return 'dragging';
}

// Release-time decision: per the plan's own "release past a third of the
// height or with enough speed to close, otherwise spring back" rule. A
// fast flick commits even on a short drag; a slow drag needs real distance.
export function shouldCommitClose({ dy, velocity, sheetHeight }){
  if(dy <= 0 || !sheetHeight) return false;
  if(dy >= sheetHeight * SWIPE_COMMIT_FRACTION) return true;
  return velocity >= SWIPE_COMMIT_VELOCITY_PX_MS;
}

// Wires swipe-to-close onto one sheet's own card element (.edit-sheet/
// .share-sheet, or the full player's own .player-overlay -- all three
// already carry the slide transition this reuses). `onClose` is always the
// nav-stack close (closeLayer(id)), never the sheet's own bare close
// function -- every close has to go through it so Back/Escape/a swipe all
// consume exactly one history entry (see shell/nav-stack.js's own header
// comment). `isValidStart(ev)`, when given, gates where a drag may even
// begin -- the full player's own "header area, or outside the disc" rule,
// so this never competes with spin-to-scrub on the platter
// (src/player/scrub.js).
export function wireSwipeToClose(sheetEl, { onClose, isValidStart }){
  let state = 'idle';
  let startX = 0, startY = 0, startedAt = 0;

  function setTracking(on){
    // Clearing the inline override (rather than ever setting it to a real
    // value) lets the sheet's own CSS transition -- and that rule's own
    // reduced-motion guard -- decide what a spring-back/close looks like;
    // this module never re-derives either value.
    sheetEl.style.transition = on ? 'none' : '';
  }
  function setTravel(px){
    sheetEl.style.transform = px ? 'translateY(' + px + 'px)' : '';
  }
  function reset(){
    state = 'idle';
    setTracking(false);
    setTravel(0);
  }

  function onTouchStart(ev){
    // A sheet whose own content is scrolled down must keep scrolling
    // normally -- only a drag starting right at its own top can mean
    // "close me," the same "only starts at the top" rule pull-to-refresh
    // already applies to a route's own scroll position.
    if(sheetEl.scrollTop > 0){ state = 'idle'; return; }
    if(isValidStart && !isValidStart(ev)){ state = 'idle'; return; }
    const t = ev.touches[0];
    startX = t.clientX; startY = t.clientY;
    startedAt = Date.now();
    state = 'tracking';
  }
  function onTouchMove(ev){
    if(state === 'idle') return;
    const t = ev.touches[0];
    const dy = t.clientY - startY, dx = t.clientX - startX;
    const decision = decideSwipeTrack({ dy, dx });
    if(decision === 'idle') return;
    if(decision === 'cancel'){ reset(); return; }
    // only claim the gesture once it's actually confirmed as a downward
    // drag, never on an ordinary scroll inside the sheet
    ev.preventDefault();
    state = 'dragging';
    setTracking(true);
    setTravel(dy);
  }
  function onTouchEnd(ev){
    if(state !== 'dragging'){ state = 'idle'; return; }
    const t = ev.changedTouches[0];
    const dy = t.clientY - startY;
    const elapsedMs = Math.max(1, Date.now() - startedAt);
    const velocity = dy / elapsedMs;
    const sheetHeight = sheetEl.getBoundingClientRect().height;
    const commit = shouldCommitClose({ dy, velocity, sheetHeight });
    state = 'idle';
    // Clearing the inline transform+transition and triggering the close in
    // the very same synchronous turn (no await/rAF in between) means the
    // browser only ever recomputes style once: it animates from the last
    // *painted* value (wherever the finger left the sheet) straight to
    // whichever target the resulting class state implies -- translateY(0)
    // for a spring-back, or fully off-screen once onClose() removes
    // .open -- never through an intermediate snap-then-slide.
    setTracking(false);
    setTravel(0);
    if(commit) onClose();
  }

  sheetEl.addEventListener('touchstart', onTouchStart, { passive: true });
  sheetEl.addEventListener('touchmove', onTouchMove, { passive: false });
  sheetEl.addEventListener('touchend', onTouchEnd);
  sheetEl.addEventListener('touchcancel', reset);
}
