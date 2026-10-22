import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/shell/routes.js imports renderProfile (profile/screens.js) and
// renderHome (social/screens/home.js) for real, plus a real circular pair
// with shell/header.js — each of those reaches a wide chain (profile's
// own storefront/settings/share chain; the social screens; and, via
// header.js, nothing back here that matters for this file) for no benefit
// to what's actually being tested: showRoute()'s own route switching and
// the Day/Sound view-switch state it now owns. Mocked directly, the usual
// "stop the chain at the door" reasoning every other mock-heavy file in
// this suite already uses. gatefold/view.js's GF/closeGatefoldInstant are
// also mocked, same reasoning — GF is read-only here per refactor rule 7.
mock.module(new URL('../../src/profile/screens.js', import.meta.url).href, {
  namedExports: { renderProfile(){} },
});
mock.module(new URL('../../src/social/screens/home.js', import.meta.url).href, {
  namedExports: { renderHome(){} },
});
mock.module(new URL('../../src/shell/header.js', import.meta.url).href, {
  namedExports: { updateHeaderActionsAvailability(){}, isSearchFieldOpen(){ return false; }, isAddMenuOpen(){ return false; } },
});
mock.module(new URL('../../src/gatefold/view.js', import.meta.url).href, {
  namedExports: { GF: null },
});
// NV2 (docs/11_SMOOTH_NAVIGATION.md): showRoute() now force-closes the
// gatefold/search-field/add-menu nav-stack layers instead of calling each
// overlay's own close function directly, and records the route for the
// tab-switch Back exception — both stubbed to no-ops, same "stop the chain
// at the door" reasoning as every other mock in this file.
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: { forceCloseLayer(){}, recordRoute(){} },
});
// RF26 (docs/12_REFINE.md): "sundown"/"character" no longer switch to a
// .route element at all — showRoute() hands both off to
// openSundownSheet() instead (src/shell/sundown-sheet.js, a real circular
// pair with this file — see routes.js's own comment). Mocked here so this
// file tests only what showRoute() itself does: which argument it hands
// off with, and that it touches nothing else about the current route.
let openSundownSheetCalls = [];
mock.module(new URL('../../src/shell/sundown-sheet.js', import.meta.url).href, {
  namedExports: { openSundownSheet(view){ openSundownSheetCalls.push(view); } },
});
// Ken, 2026-10-22: the Library scroll lock -- showRoute() now calls
// updateLibBodyInset() (src/library/view.js) once the Library route is
// confirmed on screen. library/view.js is this suite's own biggest real-
// import hub (seven circular pairs, per CLAUDE.md's refactor rule 8) --
// mocked here for the usual "stop the chain at the door" reasoning,
// same as every other module in this file.
let updateLibBodyInsetCalls = 0;
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { updateLibBodyInset(){ updateLibBodyInsetCalls++; } },
});

// A tiny, DOM-free fake document — just enough for showRoute() to run
// without throwing: getElementById for the per-route '.route' sections
// (keyed by id, library/home/profile only now — RF26 removed Sundown's),
// querySelectorAll for '.tabbar-btn', and $()'s own single-element lookups.
function fakeEl(id){
  const classes = new Set();
  return {
    id, dataset: {}, style: {},
    classList: {
      contains(c){ return classes.has(c); },
      add(c){ classes.add(c); },
      remove(c){ classes.delete(c); },
      toggle(c, on){ on ? classes.add(c) : classes.delete(c); },
    },
    setAttribute(){}, getAttribute(){ return null; },
  };
}

const routeEls = { 'route-library': fakeEl('route-library'), 'route-home': fakeEl('route-home'), 'route-profile': fakeEl('route-profile') };
const appHeader = fakeEl('appHeader');
const libToolsPanel = fakeEl('libToolsPanel');
const libToolsToggle = fakeEl('libToolsToggle');
const tabbarBtns = [
  { dataset: { route: 'library' }, setAttribute(){} },
  { dataset: { route: 'home' }, setAttribute(){} },
  { dataset: { route: 'profile' }, setAttribute(){} },
];

globalThis.localStorage = (() => {
  let store = {};
  return {
    getItem(k){ return k in store ? store[k] : null; },
    setItem(k, v){ store[k] = String(v); },
    removeItem(k){ delete store[k]; },
    _reset(){ store = {}; },
  };
})();

const bodyEl = fakeEl('body');
globalThis.document = {
  body: bodyEl,
  getElementById(id){ return routeEls[id] || null; },
  querySelectorAll(sel){
    if(sel === '.tabbar-btn') return tabbarBtns;
    if(sel === '.route') return Object.values(routeEls);
    return [];
  },
  querySelector(sel){
    if(sel === '#appHeader') return appHeader;
    if(sel === '#libToolsPanel') return libToolsPanel;
    if(sel === '#libToolsToggle') return libToolsToggle;
    return null;
  },
};

// NV3 (docs/11_SMOOTH_NAVIGATION.md): routes.js's own scroll-memory calls
// are real (src/shell/scroll-memory.js, which has no imports of its own),
// so a real window stand-in is enough -- no mock.module needed for it.
globalThis.window = { scrollY: 0, scrollTo(x, y){ globalThis.window.scrollY = y; } };

const { showRoute, selectSundownView, lastSundownView, isLibraryRouteVisible, isProfileRouteVisible } =
  await import('../../src/shell/routes.js');

test('showRoute: a normal route just toggles the matching .route element', () => {
  showRoute('library');
  assert.equal(routeEls['route-library'].classList.contains('on'), true);
  showRoute('profile');
  assert.equal(routeEls['route-profile'].classList.contains('on'), true);
  assert.equal(routeEls['route-library'].classList.contains('on'), false);
});

// RF26 (docs/12_REFINE.md): Sundown and the old Character tab are both
// gone as routes — showRoute('sundown')/('character') must never try to
// match a '.route' element that no longer exists in the DOM at all.
// Instead they open the sheet, with the view each name maps onto, and
// leave whatever route was already on screen completely alone.
test('showRoute("sundown") opens the sheet on Day and leaves the current route untouched', () => {
  openSundownSheetCalls = [];
  showRoute('library');
  showRoute('sundown');
  assert.deepEqual(openSundownSheetCalls, ['day']);
  assert.equal(routeEls['route-library'].classList.contains('on'), true, 'library is still the route on screen');
});

test('showRoute("character") opens the sheet on Sound, never 404s onto a removed route', () => {
  openSundownSheetCalls = [];
  showRoute('profile');
  showRoute('character');
  assert.deepEqual(openSundownSheetCalls, ['sound']);
  assert.equal(routeEls['route-profile'].classList.contains('on'), true, 'profile is still the route on screen');
});

test('selectSundownView: persists the choice (device-only, via localStorage) and restores it as lastSundownView()', () => {
  localStorage._reset();
  assert.equal(lastSundownView(), 'day', 'defaults to day with nothing saved yet');
  selectSundownView('sound');
  assert.equal(lastSundownView(), 'sound');
  selectSundownView('day');
  assert.equal(lastSundownView(), 'day');
});

test('selectSundownView: an unrecognized value is treated as day', () => {
  selectSundownView('sound');
  selectSundownView('nonsense');
  assert.equal(lastSundownView(), 'day');
});

test('selectSundownView: never throws when localStorage is unavailable', () => {
  const real = globalThis.localStorage;
  // @ts-ignore
  globalThis.localStorage = undefined;
  assert.doesNotThrow(() => selectSundownView('sound'));
  assert.doesNotThrow(() => lastSundownView());
  globalThis.localStorage = real;
});

test('isLibraryRouteVisible/isProfileRouteVisible read the real "on" class off the matching route element', () => {
  showRoute('library');
  assert.equal(isLibraryRouteVisible(), true);
  assert.equal(isProfileRouteVisible(), false);
  showRoute('profile');
  assert.equal(isProfileRouteVisible(), true);
  assert.equal(isLibraryRouteVisible(), false);
});

// --- NV3 (docs/11_SMOOTH_NAVIGATION.md): per-tab scroll memory -----------

test('showRoute: scrolling down on one tab, then switching away and back, restores that same position', () => {
  showRoute('library');
  globalThis.window.scrollY = 850;
  showRoute('home');
  assert.equal(globalThis.window.scrollY, 0, 'a tab visited for the first time starts at the top');
  globalThis.window.scrollY = 120;
  showRoute('library');
  assert.equal(globalThis.window.scrollY, 850, 'library\'s own remembered position comes back');
});

test('showRoute: switching to the tab already on screen doesn\'t save over its own position', () => {
  showRoute('profile');
  globalThis.window.scrollY = 300;
  showRoute('profile');
  assert.equal(globalThis.window.scrollY, 300);
});

test('selectSundownView: Day and Sound each keep their own scroll position, independent of the route (the sheet floats over whatever route is on screen)', () => {
  selectSundownView('day');
  globalThis.window.scrollY = 400;
  selectSundownView('sound');
  globalThis.window.scrollY = 77;
  selectSundownView('day');
  assert.equal(globalThis.window.scrollY, 400, 'Day\'s own remembered position comes back');
  selectSundownView('sound');
  assert.equal(globalThis.window.scrollY, 77, 'Sound\'s own remembered position comes back');
});

// --- Ken, 2026-10-22: the Library scroll lock ----------------------------
// "go back to the lock of the library tab... make sure lock doesn't leak
// to other tabs." A prior attempt (PR #164, reverted as #165) toggled this
// via a reactive body:has(...) selector; this time the class is only ever
// set/cleared from inside showRoute() itself, so these tests are really
// checking the one property that matters: it is never on for any route
// but Library, under any sequence of calls.

test('showRoute("library"): locks body scroll and recomputes #libBody\'s own inset', () => {
  updateLibBodyInsetCalls = 0;
  showRoute('home');
  showRoute('library');
  assert.equal(bodyEl.classList.contains('lib-scroll-lock'), true);
  assert.ok(updateLibBodyInsetCalls > 0, 'updateLibBodyInset() is called once Library is confirmed on screen');
});

test('showRoute: the lock never leaks to another tab, whichever tab it switches to', () => {
  showRoute('library');
  assert.equal(bodyEl.classList.contains('lib-scroll-lock'), true);
  showRoute('home');
  assert.equal(bodyEl.classList.contains('lib-scroll-lock'), false, 'leaving Library for Home always lifts the lock');
  showRoute('library');
  assert.equal(bodyEl.classList.contains('lib-scroll-lock'), true);
  showRoute('profile');
  assert.equal(bodyEl.classList.contains('lib-scroll-lock'), false, 'leaving Library for Profile always lifts the lock');
});

test('showRoute: re-tapping the Library tab already on screen keeps the lock on, not a flicker off and back on', () => {
  showRoute('library');
  assert.equal(bodyEl.classList.contains('lib-scroll-lock'), true);
  showRoute('library');
  assert.equal(bodyEl.classList.contains('lib-scroll-lock'), true);
});

test('showRoute: opening the Sundown sheet over Library never touches the lock either way', () => {
  showRoute('library');
  assert.equal(bodyEl.classList.contains('lib-scroll-lock'), true);
  showRoute('sundown');
  assert.equal(bodyEl.classList.contains('lib-scroll-lock'), true, 'the sheet opens over Library, which is still the route on screen');
});
