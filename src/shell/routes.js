import { $ } from '../util/dom.js';
import { renderProfile } from '../profile/screens.js';
import { renderHome } from '../social/screens/home.js';
import { updateHeaderActionsAvailability, closeSearchField, closeAddMenu } from './header.js';
// GF is read-only here (see refactor rule 7) — not reassigned, only read.
import { GF, closeGatefoldInstant } from '../gatefold/view.js';

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
export function selectSundownView(view){
  view = view === 'sound' ? 'sound' : 'day';
  document.querySelectorAll('[data-sundown-view]').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.sundownView === view)));
  const dayEl = $('#sundownDayView'), soundEl = $('#sundownSoundView');
  if(dayEl) dayEl.style.display = view === 'day' ? '' : 'none';
  if(soundEl) soundEl.style.display = view === 'sound' ? '' : 'none';
  // device-only, same posture as S.theme's own localStorage mirror
  // (src/theme-boot.js) — never synced, never part of prefs/backup.
  try{ localStorage.setItem(SUNDOWN_VIEW_KEY, view); }catch(_e){}
}
export function lastSundownView(){
  try{ return localStorage.getItem(SUNDOWN_VIEW_KEY) === 'sound' ? 'sound' : 'day'; }
  catch(_e){ return 'day'; }
}

export function showRoute(name){
  // DA3: the Character tab is gone — its content lives in Sundown's own
  // Sound view now. Anything that still asks for "character" (a stale
  // saved last-tab value, an old link, a future typo) lands there instead
  // of 404ing onto a route that no longer exists in the DOM at all.
  if(name === 'character'){ name = 'sundown'; selectSundownView('sound'); }
  // the gatefold is a library-only view (opened from the crate); it must
  // never persist over another tab's content since it's a fixed full-screen
  // overlay that would otherwise hide whatever route is switched to
  if(name !== 'library' && GF) closeGatefoldInstant();
  document.querySelectorAll('.tabbar-btn').forEach(b => b.setAttribute('aria-selected', String(b.dataset.route === name)));
  document.querySelectorAll('.route').forEach(p => p.classList.toggle('on', p.id === 'route-' + name));
  $('#appHeader').classList.toggle('no-border', name === 'library');
  updateHeaderActionsAvailability();
  if(name !== 'library'){ closeSearchField(); closeAddMenu(); }
  if(name === 'profile'){
    // library tools starts closed on every fresh visit to Profile (S1 §5)
    $('#libToolsPanel').classList.remove('open');
    $('#libToolsToggle').setAttribute('aria-expanded', 'false');
    renderProfile();
  }
  if(name === 'home') renderHome();
}
