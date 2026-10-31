import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { formatBytes, totalLibraryBytes } from '../library/delete.js';
import { updateSearchChipsVisibility } from '../library/search.js';
import { isLibraryRouteVisible } from './routes.js';
import { openLayer } from './nav-stack.js';

/* ================= navigation shell: header actions, search field, add menu =================
   isLibraryRouteVisible, updateHeaderActionsAvailability,
   updateLibTabsForLayout, refreshLibraryTools, the header search field
   (openSearchField/closeSearchField/isSearchFieldOpen), the header + menu
   (openAddMenu/closeAddMenu/isAddMenuOpen), and showRoute. */

// the library tabs row (icons + the Songs/Crate/Artists/Playlists group)
// only ever shows on the library route; the icons stay even with an empty
// library (the + button is how you add your first files), but the tab
// buttons and the search icon itself only make sense once there's something
// to switch between or search (S1 §2.1)
export function updateHeaderActionsAvailability(){
  const isLibrary = isLibraryRouteVisible();
  $('#libNav').style.display = isLibrary ? 'flex' : 'none';
  $('#libNavTabs').style.display = (isLibrary && S.tracks.length) ? 'flex' : 'none';
  $('#hdrSearchBtn').style.display = (isLibrary && S.tracks.length) ? '' : 'none';
}

// the crate replaces Albums as the first tab when that's the saved layout,
// so Songs/Artists/Playlists are never hidden by it (S1 §2.2, S2 §5)
export function updateLibTabsForLayout(){
  const firstTab = $('#libNav [data-view="crate"]') || $('#libNav [data-view="albums"]');
  if(!firstTab) return;
  if(S.libraryLayout === 'crate'){ firstTab.dataset.view = 'crate'; firstTab.textContent = 'Crate'; }
  else { firstTab.dataset.view = 'albums'; firstTab.textContent = 'Albums'; }
}

// Library tools lives in Profile › Settings, parked in #libToolsStash the
// rest of the time (profile/screens.js's own parkLibraryTools()/
// renderAppSettingsScreen(), the same stash shape #playbackSettings already
// uses). Its visibility is governed entirely by which DOM parent currently
// holds it, not by which route is active, so this only refreshes its
// counts/row states, never a display toggle of its own — the stash itself,
// and renderAppSettingsScreen()'s own "Playback & behavior"-style section
// it's appended into, are what show or hide it.
export function refreshLibraryTools(){
  const tools = $('#libTools');
  if(!tools) return;
  const hasTracks = S.tracks.length > 0;
  $('#libToolsBody').style.display = hasTracks ? '' : 'none';
  $('#libToolsFooter').textContent = hasTracks
    ? (S.tracks.length + (S.tracks.length === 1 ? ' track' : ' tracks') + ' · ' + formatBytes(totalLibraryBytes()) + ' · stored on this device')
    : '';
}

// header search field: swaps the library tabs row for a full-width search
// input, which lives in the header above it (S1 §2.1). Cancel clears and
// closes; the × only clears.
export function openSearchField(){
  $('#libNav').style.display = 'none';
  $('#hdrSearchRow').style.display = 'flex';
  $('#hdrSearchBtn').classList.add('active');
  $('#librarySearch').focus();
  updateSearchChipsVisibility();
  openLayer('search-field', closeSearchField, { container: $('#hdrSearchRow') });
}
export function closeSearchField(){
  updateHeaderActionsAvailability();
  $('#hdrSearchRow').style.display = 'none';
  $('#hdrSearchBtn').classList.remove('active');
  $('#searchChips').style.display = 'none';
}
export function isSearchFieldOpen(){
  return $('#hdrSearchRow').style.display !== 'none';
}

// header + menu: Add songs / Add folder popover (S1 §3)
export function openAddMenu(){
  // positioned from the button's own rect rather than a fixed CSS offset,
  // since the button now lives on the library tabs row instead of a fixed
  // header height above it
  const btn = $('#hdrAddBtn'), r = btn.getBoundingClientRect();
  const menu = $('#addMenu');
  menu.style.top = Math.round(r.bottom + window.scrollY + 8) + 'px';
  menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
  $('#addScrim').style.top = Math.round(r.bottom) + 'px';   // position:fixed, so viewport-relative
  $('#addScrim').classList.add('open');
  menu.classList.add('open');
  btn.classList.add('add-open');
  btn.setAttribute('aria-expanded', 'true');
  // Both the menu and its own scrim are top-level siblings here, not one
  // nested inside the other -- container has to protect both, or the
  // scrim gets marked inert as "just another background sibling" and
  // silently loses the tap-to-dismiss its own CSS gives it (see the
  // Sundown sheet's own identical fix, src/shell/sundown-sheet.js).
  openLayer('add-menu', closeAddMenu, { container: [menu, $('#addScrim')] });
}
export function closeAddMenu(){
  $('#addScrim').classList.remove('open');
  $('#addMenu').classList.remove('open');
  $('#hdrAddBtn').classList.remove('add-open');
  $('#hdrAddBtn').setAttribute('aria-expanded', 'false');
}
export function isAddMenuOpen(){
  return $('#addMenu').classList.contains('open');
}

// RF8 (docs/12_REFINE.md): the library header's own "···" overflow —
// Select and Library tools. Same popover shape as the + menu above,
// positioned off its own button instead.
export function openLibOverflowMenu(){
  const btn = $('#hdrOverflowBtn'), r = btn.getBoundingClientRect();
  const menu = $('#libOverflowMenu');
  menu.style.top = Math.round(r.bottom + window.scrollY + 8) + 'px';
  menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
  $('#libOverflowScrim').classList.add('open');
  menu.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  // See openAddMenu()'s own comment above -- the scrim is a separate
  // sibling, not nested inside the menu, so it has to be in container too.
  openLayer('lib-overflow-menu', closeLibOverflowMenu, { container: [menu, $('#libOverflowScrim')] });
}
export function closeLibOverflowMenu(){
  closeLibraryToolsMenuPanel();
  $('#libOverflowScrim').classList.remove('open');
  $('#libOverflowMenu').classList.remove('open');
  $('#hdrOverflowBtn').setAttribute('aria-expanded', 'false');
}
export function isLibOverflowMenuOpen(){
  return $('#libOverflowMenu').classList.contains('open');
}

// FS11 (docs/25_FROM_SCRATCH.md): "Library tools" grows #libOverflowMenu
// in place into the full panel -- same menu element, same 'lib-overflow-menu'
// nav-stack layer (no second layer to push/pop), just a size/content swap.
// Closing it (the panel's own ×, the scrim, Escape, or the back gesture)
// always closes the whole menu, never collapses back to the small one --
// closeLibOverflowMenu() above calls closeLibraryToolsMenuPanel() first on
// every close, a no-op if the panel was never opened.
export function openLibraryToolsMenuPanel(){
  const menu = $('#libOverflowMenu');
  const libTools = $('#libTools'), body = $('#libToolsMenuBody');
  // reparent, never copy -- "whichever opens last owns the element" (point
  // 3); profile/screens.js's own parkLibraryTools()/renderAppSettingsScreen()
  // do the same unconditional re-grab shape on their side.
  if(libTools && body && libTools.parentNode !== body) body.appendChild(libTools);
  // the disclosure is Settings-only here -- always expanded in this panel
  $('#libToolsPanel').classList.add('open');
  $('#libToolsToggle').setAttribute('aria-expanded', 'true');
  refreshLibraryTools();
  const r = $('#libNav').getBoundingClientRect();
  menu.style.top = Math.round(r.bottom + window.scrollY + 8) + 'px';
  menu.style.left = '12px';
  menu.style.right = '12px';
  menu.style.width = 'auto';
  menu.style.maxHeight = 'calc(100dvh - 140px)';
  menu.style.borderRadius = '14px';
  menu.classList.add('lib-tools-open');
}
export function closeLibraryToolsMenuPanel(){
  const menu = $('#libOverflowMenu');
  if(!menu.classList.contains('lib-tools-open')) return;
  const libTools = $('#libTools'), body = $('#libToolsMenuBody'), stash = $('#libToolsStash');
  // only hand it back if this panel is still the one holding it -- if
  // Settings already re-grabbed it (can't happen on the same route, but
  // guarded per point 4 anyway), leave it where it is.
  if(libTools && stash && libTools.parentNode === body) stash.appendChild(libTools);
  $('#libToolsPanel').classList.remove('open');
  $('#libToolsToggle').setAttribute('aria-expanded', 'false');
  menu.classList.remove('lib-tools-open');
  menu.style.top = ''; menu.style.left = ''; menu.style.right = '';
  menu.style.width = ''; menu.style.maxHeight = ''; menu.style.borderRadius = '';
}
