import { $ } from '../util/dom.js';
import { renderProfile } from '../profile/screens.js';
import { renderHome } from '../social/screens/home.js';
import { updateHeaderActionsAvailability, isSearchFieldOpen, isAddMenuOpen } from './header.js';
// GF is read-only here (see refactor rule 7) — not reassigned, only read.
import { GF } from '../gatefold/view.js';
import { forceCloseLayer, recordRoute } from './nav-stack.js';
import { saveScrollPosition, restoreScrollPosition } from './scroll-memory.js';
// RF26 (docs/12_REFINE.md): a real circular pair with sundown-sheet.js now
// — that module imports selectSundownView/lastSundownView back from here,
// the same peer-import shape as audio/engine.js and player/transport.js
// (see CLAUDE.md's refactor rule 8).
import { openSundownSheet } from './sundown-sheet.js';

export function isLibraryRouteVisible(){
  const r = document.getElementById('route-library');
  return !!(r && r.classList.contains('on'));
}
export function isProfileRouteVisible(){
  const r = document.getElementById('route-profile');
  return !!(r && r.classList.contains('on'));
}

// DA3 (docs/DAY_ARC.md): the Sundown route's own Day/Sound switch — lives
// here, not in src/wiring/sundown.js, specifically so showRoute()'s own
// character->sundown redirect just below can call it directly without a
// wiring file ever being imported from a shell/ module (wiring imports
// from shell/, never the other way — see CLAUDE.md's own module-layering
// convention). src/wiring/sundown.js imports this back for its own tab
// click handlers and its own "restore last view" call at boot, the usual
// direction for a wiring file reaching into a shell/ one.
const SUNDOWN_VIEW_KEY = 'miziki.sundownView';
// NV3 (docs/11_SMOOTH_NAVIGATION.md): which sub-view is on screen right now,
// so its own scroll position can be saved before switching away from it —
// module-private, the same "track what's current so the thing leaving can
// be saved" shape showRoute() itself uses below for the route level.
let currentSundownView = null;
export function selectSundownView(view){
  view = view === 'sound' ? 'sound' : 'day';
  // switching to the view already on screen (e.g. re-tapping the same tab)
  // must never fight the scroll position the user is already at
  const isNewView = currentSundownView !== view;
  if(currentSundownView && isNewView) saveScrollPosition('sundown-view:' + currentSundownView);
  document.querySelectorAll('[data-sundown-view]').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.sundownView === view)));
  // NV5 (docs/11_SMOOTH_NAVIGATION.md): the one attribute the shared
  // sliding underline reads (src/styles/24-sundown-arc.css's
  // .sd-tabs-indicator) -- mirrors the per-button aria-selected above onto
  // the row itself, the same "mirror existing state" shape this file's own
  // GF/showRoute() reads already use elsewhere.
  const tabs = $('.sd-tabs');
  if(tabs) tabs.setAttribute('data-selected', view);
  const dayEl = $('#sundownDayView'), soundEl = $('#sundownSoundView');
  if(dayEl) dayEl.style.display = view === 'day' ? '' : 'none';
  if(soundEl) soundEl.style.display = view === 'sound' ? '' : 'none';
  // device-only, same posture as S.theme's own localStorage mirror
  // (src/theme-boot.js) — never synced, never part of prefs/backup.
  try{ localStorage.setItem(SUNDOWN_VIEW_KEY, view); }catch(_e){}
  currentSundownView = view;
  if(isNewView) restoreScrollPosition('sundown-view:' + view);
}
export function lastSundownView(){
  try{ return localStorage.getItem(SUNDOWN_VIEW_KEY) === 'sound' ? 'sound' : 'day'; }
  catch(_e){ return 'day'; }
}

// NV3: which route is on screen right now, so its own scroll position can be
// saved just before showRoute() switches to a different one.
let currentRouteName = null;
export function showRoute(name){
  // RF26 (docs/12_REFINE.md): Sundown and the old Character tab are both
  // gone as routes — "sundown"/"character" (a stale saved last-tab value,
  // an old link, a future typo) open the sheet over whatever route is
  // already on screen instead, rather than switching to a route id that
  // no longer exists in the DOM at all. The sheet's own teardown
  // (sundown-sheet.js) handles returning the preview to live time on
  // close — this function no longer needs to.
  if(name === 'sundown'){ openSundownSheet('day'); return; }
  if(name === 'character'){ openSundownSheet('sound'); return; }
  // re-tapping the tab already on screen must never fight the scroll
  // position the user is already at
  const isNewRoute = currentRouteName !== name;
  // NV3: save the leaving route's own scroll position before anything about
  // the DOM changes — window.scrollY here is still wherever the user left it.
  if(currentRouteName && isNewRoute) saveScrollPosition('route:' + currentRouteName);
  // the gatefold is a library-only view (opened from the crate); it must
  // never persist over another tab's content since it's a fixed full-screen
  // overlay that would otherwise hide whatever route is switched to — an
  // instant, non-animated close (NV2, docs/11_SMOOTH_NAVIGATION.md): an
  // unrelated tab switch is not the user dismissing the gatefold, so it
  // shouldn't also play the gatefold's own ~600ms close animation
  if(name !== 'library' && GF) forceCloseLayer('gatefold');
  document.querySelectorAll('.tabbar-btn').forEach(b => b.setAttribute('aria-selected', String(b.dataset.route === name)));
  document.querySelectorAll('.route').forEach(p => p.classList.toggle('on', p.id === 'route-' + name));
  $('#appHeader').classList.toggle('no-border', name === 'library');
  updateHeaderActionsAvailability();
  if(name !== 'library'){
    if(isSearchFieldOpen()) forceCloseLayer('search-field');
    if(isAddMenuOpen()) forceCloseLayer('add-menu');
  }
  recordRoute(name);
  if(name === 'profile'){
    // library tools starts closed on every fresh visit to Profile (S1 §5)
    $('#libToolsPanel').classList.remove('open');
    $('#libToolsToggle').setAttribute('aria-expanded', 'false');
    renderProfile();
  }
  if(name === 'home') renderHome();
  currentRouteName = name;
  // NV3: restore the entering route's own remembered position (top, on a
  // first visit) — after its content is actually on screen, not before.
  if(isNewRoute) restoreScrollPosition('route:' + name);
}
