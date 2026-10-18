// NV4 (docs/11_SMOOTH_NAVIGATION.md): the one new wiring file this step
// adds (the same "new UI-adjacent concern, not an extraction from main.js"
// reasoning wiring/lifecycle.js already used for step 06/B3) — wires
// src/shell/pull-refresh.js's gesture onto the Home and Profile routes'
// own containers, each with its own refresh function and offline/signed-out
// status line. Reaches MizikiSocial as the real global, never imported —
// same posture every other module that touches it already has (see
// src/main.js's own entry in CLAUDE.md).
import { $, el } from '../util/dom.js';
import { wirePullToRefresh, registerProfileRefresh } from '../shell/pull-refresh.js';
import { refreshHome } from '../social/screens/home.js';
import { refreshProfileHome } from '../profile/screens.js';

function isOffline(){
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function homeStatusLine(){
  if(isOffline()) return "Offline: showing what's saved";
  if(typeof MizikiSocial !== 'undefined' && MizikiSocial.status().auth !== 'ready') return 'Sign in to see Home';
  return null;
}

// Profile's own local stats/rhythm card refresh fine with no network at
// all (they only ever read S) -- only the offline line applies here, never
// a signed-out one.
function profileStatusLine(){
  return isOffline() ? "Offline: showing what's saved" : null;
}

// RF11 (docs/12_REFINE.md, point 4): the keyboard-accessible "Refresh"
// trigger used to be a child of src/shell/pull-refresh.js's own
// absolutely-positioned indicator overlay on both routes — on Profile, that
// floated on top of the Settings gear sitting at the same corner. Home has
// no gear to collide with, but the fix is the same either way: the button
// moves out of the floating overlay into this route's own normal document
// flow. Pull-to-refresh's own gesture (the dot, the resistance curve, the
// throttle) is unchanged on both routes.
function buildRouteRefreshButton(routeEl, runRefresh){
  const btn = el('button','route-refresh-btn','Refresh');
  btn.setAttribute('aria-label','Refresh');
  btn.addEventListener('click', runRefresh);
  routeEl.insertBefore(btn, routeEl.firstChild);
}

export function wirePullRefresh(){
  const homeRoute = $('#route-home');
  if(homeRoute){
    const ctrl = wirePullToRefresh(homeRoute, { onRefresh: refreshHome, getStatusLine: homeStatusLine });
    buildRouteRefreshButton(homeRoute, ctrl.refresh);
  }
  const profileRoute = $('#route-profile');
  if(profileRoute){
    // Profile has its own gear menu (src/profile/storefront.js) — its
    // "Refresh" menu item reaches this exact same debounced/throttled
    // closure through registerProfileRefresh()/triggerProfileRefresh(),
    // rather than a second in-flow button of its own.
    const ctrl = wirePullToRefresh(profileRoute, { onRefresh: refreshProfileHome, getStatusLine: profileStatusLine });
    registerProfileRefresh(ctrl.refresh);
  }
}
