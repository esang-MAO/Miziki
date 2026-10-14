// NV4 (docs/11_SMOOTH_NAVIGATION.md): pull-to-refresh, Home and Profile
// only. decidePull()/pullTravel() are pure functions with no DOM at all —
// the actual gesture decision and the resistance curve are fully
// unit-testable without a document or a touch event, the same
// "pure function behind the DOM wiring" shape player/scrub.js's own
// angleDelta() and shell/nav-stack.js's idsToClose() already established.
// wirePullToRefresh() below is the DOM-and-touch-event half; like
// shell/put-away.js's own choreography (see tests/unit/shell.test.js's own
// escape-valve comment), there isn't much pure core left once gesture
// wiring, indicator DOM and the iOS touchmove/preventDefault dance enter
// the picture, so that part is covered by Playwright/manual preview
// instead of a unit test.
import { REDUCED } from '../util/motion.js';
import { hasOpenLayer } from './nav-stack.js';

export const PULL_AXIS_LOCK_PX = 10;
export const PULL_RESISTANCE = 0.5;
export const PULL_MAX_TRAVEL_PX = 96;
export const PULL_THRESHOLD_PX = 64;
export const REFRESH_THROTTLE_MS = 10000;

// dy/dx: raw finger movement since the gesture started, in screen pixels
// (not yet resistance-scaled). startScrollY: window.scrollY at touch start
// — a pull can only ever start exactly at the top, never partway down, so
// a gesture that began lower on the page is 'idle' for its whole life.
// elapsedMs is accepted (per the plan's own documented signature) but not
// read by anything below yet — reserved for a future velocity check, the
// same "unused for now, kept in the signature" shape a couple of this
// codebase's other pure gesture-math functions already have.
export function decidePull({ dy, dx, startScrollY }){
  if(startScrollY > 0) return 'idle';
  const lockedYet = Math.abs(dx) >= PULL_AXIS_LOCK_PX || Math.abs(dy) >= PULL_AXIS_LOCK_PX;
  if(!lockedYet) return 'idle';
  if(Math.abs(dx) > Math.abs(dy)) return 'cancel'; // mostly sideways: the crate strip, any horizontal row
  if(dy <= 0) return 'cancel'; // moving back up (or no net pull) is never a pull
  const travel = Math.min(dy * PULL_RESISTANCE, PULL_MAX_TRAVEL_PX);
  return travel >= PULL_THRESHOLD_PX ? 'armed' : 'pulling';
}

// The indicator's own resistance curve (move = pull × 0.5, capped at ~96px)
// — kept here, not re-derived inside wirePullToRefresh, so a test can check
// it against the exact same constants decidePull() itself uses.
export function pullTravel(dy){
  return Math.min(Math.max(dy, 0) * PULL_RESISTANCE, PULL_MAX_TRAVEL_PX);
}

// Pure throttle check: has enough time passed since the last successful
// refresh to allow a new network round trip? Kept separate from the DOM
// wiring below so "ignore a pull inside the 10s window" is testable
// without touch events.
export function shouldThrottle(lastRefreshAt, now){
  return (now - lastRefreshAt) < REFRESH_THROTTLE_MS;
}

function buildIndicatorDom(routeEl, refreshLabel){
  const controls = document.createElement('div');
  controls.className = 'pull-refresh';
  const dot = document.createElement('div');
  dot.className = 'pull-refresh-dot';
  dot.setAttribute('aria-hidden', 'true');
  controls.appendChild(dot);
  const btn = document.createElement('button');
  btn.className = 'pull-refresh-btn';
  btn.type = 'button';
  btn.textContent = refreshLabel || 'Refresh';
  btn.setAttribute('aria-label', refreshLabel || 'Refresh');
  controls.appendChild(btn);
  const live = document.createElement('div');
  live.className = 'pull-refresh-live';
  live.setAttribute('aria-live', 'polite');
  controls.appendChild(live);
  routeEl.insertBefore(controls, routeEl.firstChild);
  return { wrap: controls, dot, btn, live };
}

// Wires pull-to-refresh onto one route's own container. `routeEl` is the
// `.route` section itself (e.g. #route-home) — the gesture is scoped to it
// so a drag starting on a different tab's own content never fires this.
// `onRefresh` does the actual data refresh (patch-in-place, never a
// restore/merge — see src/social/screens/home.js's refreshHome() and
// src/profile/screens.js's refreshProfileHome()) and may return a promise.
// `getStatusLine()`, when it returns a non-empty string, means "nothing to
// fetch right now" (offline/signed out) — the indicator plays its spring
// animation and shows that line instead of making a request.
export function wirePullToRefresh(routeEl, { onRefresh, getStatusLine, refreshLabel }){
  const indicator = buildIndicatorDom(routeEl, refreshLabel);
  let state = 'idle';
  let startX = 0, startY = 0, startScrollY = 0, startedAt = 0;
  let refreshing = false;
  let lastRefreshAt = 0;

  function setTravel(px){
    indicator.wrap.style.transform = px ? 'translateY(' + px + 'px)' : '';
  }
  function setTransition(on){
    indicator.wrap.style.transition = (on && !REDUCED) ? 'transform .25s ease' : '';
  }
  function reset(){
    state = 'idle';
    indicator.wrap.dataset.state = 'idle';
    setTransition(true);
    setTravel(0);
  }

  async function runRefresh(){
    const statusLine = getStatusLine && getStatusLine();
    if(statusLine){
      indicator.live.textContent = statusLine;
      reset();
      return;
    }
    const now = Date.now();
    if(refreshing || shouldThrottle(lastRefreshAt, now)){
      indicator.live.textContent = 'Up to date';
      reset();
      return;
    }
    refreshing = true;
    indicator.wrap.dataset.state = 'refreshing';
    setTransition(false);
    setTravel(48);
    try{
      await onRefresh();
      lastRefreshAt = Date.now();
      indicator.live.textContent = 'Updated';
    }catch(_e){
      indicator.live.textContent = "Couldn't refresh";
    }
    refreshing = false;
    reset();
  }

  function onTouchStart(ev){
    if(hasOpenLayer()) return;
    if((window.scrollY || 0) > 0){ state = 'idle'; return; }
    const t = ev.touches[0];
    startX = t.clientX; startY = t.clientY;
    startScrollY = window.scrollY || 0;
    startedAt = Date.now();
    state = 'tracking';
    setTransition(false);
  }
  function onTouchMove(ev){
    if(state === 'idle' || refreshing) return;
    const t = ev.touches[0];
    const dy = t.clientY - startY, dx = t.clientX - startX;
    const decision = decidePull({ dy, dx, startScrollY, elapsedMs: Date.now() - startedAt });
    if(decision === 'idle') return;
    if(decision === 'cancel'){ reset(); return; }
    // only claim the gesture (and block the page's own scroll/rubber-band)
    // once it's actually confirmed as a pull, never on an ordinary scroll
    ev.preventDefault();
    state = decision;
    indicator.wrap.dataset.state = decision;
    setTravel(pullTravel(dy));
  }
  function onTouchEnd(){
    if(state === 'armed') runRefresh();
    else if(state !== 'idle') reset();
    else state = 'idle';
  }

  routeEl.addEventListener('touchstart', onTouchStart, { passive: true });
  routeEl.addEventListener('touchmove', onTouchMove, { passive: false });
  routeEl.addEventListener('touchend', onTouchEnd);
  routeEl.addEventListener('touchcancel', onTouchEnd);
  indicator.btn.addEventListener('click', runRefresh);

  return { refresh: runRefresh };
}
