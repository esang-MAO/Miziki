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

export function showRoute(name){
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
