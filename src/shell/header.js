import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { formatBytes, totalLibraryBytes } from '../library/delete.js';
import { updateSearchChipsVisibility } from '../library/search.js';
import { isLibraryRouteVisible } from './routes.js';
import { openLayer, closeLayer } from './nav-stack.js';
import { sheetHeader } from '../ui/parts.js';

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

// UN3 (docs/36_UNIFORMITY.md point 6, decision 11): the library header's
// own "···" opens Library tools directly now (it was the menu's only
// real destination) -- a full sheet (sheetHeader()'s look, src/ui/
// parts.js) rather than the old two-row popover that grew into a panel
// in place. The header is built once, lazily, on first open.
let libToolsSheetHeadBuilt = false;
export function openLibraryToolsPanel(){
  const overlay = $('#libToolsSheetOverlay');
  if(!libToolsSheetHeadBuilt){
    const built = sheetHeader('Library tools');
    built.closeBtn.addEventListener('click', () => closeLayer('lib-tools-sheet'));
    $('#libToolsSheetHead').appendChild(built);
    libToolsSheetHeadBuilt = true;
  }
  const libTools = $('#libTools'), bodyHost = $('#libToolsSheetBody');
  // reparent, never copy -- "whichever opens last owns the element" (point
  // 3); profile/screens.js's own parkLibraryTools()/renderAppSettingsScreen()
  // do the same unconditional re-grab shape on their side.
  if(libTools && bodyHost && libTools.parentNode !== bodyHost) bodyHost.appendChild(libTools);
  // the disclosure is Settings-only here -- always expanded in this sheet
  $('#libToolsPanel').classList.add('open');
  $('#libToolsToggle').setAttribute('aria-expanded', 'true');
  refreshLibraryTools();
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  $('#hdrOverflowBtn').setAttribute('aria-expanded', 'true');
  openLayer('lib-tools-sheet', closeLibraryToolsPanel, { container: overlay });
}
export function closeLibraryToolsPanel(){
  const overlay = $('#libToolsSheetOverlay');
  const libTools = $('#libTools'), bodyHost = $('#libToolsSheetBody'), stash = $('#libToolsStash');
  // only hand it back if this sheet is still the one holding it -- if
  // Settings already re-grabbed it (can't happen on the same route, but
  // guarded per point 4 anyway), leave it where it is.
  if(libTools && stash && libTools.parentNode === bodyHost) stash.appendChild(libTools);
  $('#libToolsPanel').classList.remove('open');
  $('#libToolsToggle').setAttribute('aria-expanded', 'false');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  $('#hdrOverflowBtn').setAttribute('aria-expanded', 'false');
}
export function isLibraryToolsPanelOpen(){
  return $('#libToolsSheetOverlay').classList.contains('open');
}
