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
   (openAddMenu/closeAddMenu/isAddMenuOpen), and showRoute. These sat under
   the old "share image"/"setMode" header only because that's physically
   where they were in the file, not because they're share-image or mode
   code — left in main.js for step 7's navigation-shell module. */

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

// RF8 (docs/12_REFINE.md): Library tools lives in static markup under
// #route-library now (moved there from #route-profile, since it's one of
// the library header's own overflow menu items — see wireLibraryView()'s
// own #libOverflowToolsBtn handler), so re-renders of #libBody never
// destroy its listeners (S1 §5's original implementation note, same
// reasoning, new route); this just refreshes its visibility, counts and
// row states.
export function refreshLibraryTools(){
  const tools = $('#libTools');
  if(!tools) return;
  const onLibrary = isLibraryRouteVisible();
  tools.style.display = onLibrary ? 'block' : 'none';
  if(!onLibrary) return;
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
// Select and Library tools, both of which used to be their own always-
// visible controls on the tabs row. Same popover shape as the + menu
// above, positioned off its own button instead.
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
  $('#libOverflowScrim').classList.remove('open');
  $('#libOverflowMenu').classList.remove('open');
  $('#hdrOverflowBtn').setAttribute('aria-expanded', 'false');
}
export function isLibOverflowMenuOpen(){
  return $('#libOverflowMenu').classList.contains('open');
}
