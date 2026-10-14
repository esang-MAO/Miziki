// NV4 (docs/11_SMOOTH_NAVIGATION.md): the one new wiring file this step
// adds (the same "new UI-adjacent concern, not an extraction from main.js"
// reasoning wiring/lifecycle.js already used for step 06/B3) — wires
// src/shell/pull-refresh.js's gesture onto the Home and Profile routes'
// own containers, each with its own refresh function and offline/signed-out
// status line. Reaches MizikiSocial as the real global, never imported —
// same posture every other module that touches it already has (see
// src/main.js's own entry in CLAUDE.md).
import { $ } from '../util/dom.js';
import { wirePullToRefresh } from '../shell/pull-refresh.js';
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

export function wirePullRefresh(){
  const homeRoute = $('#route-home');
  if(homeRoute){
    wirePullToRefresh(homeRoute, { onRefresh: refreshHome, getStatusLine: homeStatusLine, refreshLabel: 'Refresh' });
  }
  const profileRoute = $('#route-profile');
  if(profileRoute){
    wirePullToRefresh(profileRoute, { onRefresh: refreshProfileHome, getStatusLine: profileStatusLine, refreshLabel: 'Refresh' });
  }
}
