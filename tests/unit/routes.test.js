import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/shell/routes.js imports renderProfile (profile/screens.js) and
// renderHome (social/screens/home.js) for real, plus a real circular pair
// with shell/header.js — each of those reaches a wide chain (profile's
// own storefront/settings/share chain; the social screens; and, via
// header.js, nothing back here that matters for this file) for no benefit
// to what's actually being tested: showRoute()'s own character->sundown
// redirect and the Day/Sound view-switch state it now owns. Mocked
// directly, the usual "stop the chain at the door" reasoning every other
// mock-heavy file in this suite already uses. gatefold/view.js's
// GF/closeGatefoldInstant are also mocked, same reasoning — GF is read
// read-only here per refactor rule 7.
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

// A tiny, DOM-free fake document — just enough for showRoute()/
// selectSundownView() to run without throwing: getElementById for the
// per-route '.route' sections (keyed by id), querySelectorAll for
// '.tabbar-btn'/'[data-sundown-view]' (returning the small fixed sets
// this test itself populates), and $()'s own single-element lookups.
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

const routeEls = { 'route-library': fakeEl('route-library'), 'route-sundown': fakeEl('route-sundown'), 'route-profile': fakeEl('route-profile') };
const appHeader = fakeEl('appHeader');
const libToolsPanel = fakeEl('libToolsPanel');
const libToolsToggle = fakeEl('libToolsToggle');
const tabbarBtns = [
  { dataset: { route: 'library' }, setAttribute(){} },
  { dataset: { route: 'sundown' }, setAttribute(){} },
  { dataset: { route: 'profile' }, setAttribute(){} },
];
let sundownViewBtns = [];

globalThis.localStorage = (() => {
  let store = {};
  return {
    getItem(k){ return k in store ? store[k] : null; },
    setItem(k, v){ store[k] = String(v); },
    removeItem(k){ delete store[k]; },
    _reset(){ store = {}; },
  };
})();

globalThis.document = {
  getElementById(id){ return routeEls[id] || null; },
  querySelectorAll(sel){
    if(sel === '.tabbar-btn') return tabbarBtns;
    if(sel === '.route') return Object.values(routeEls);
    if(sel === '[data-sundown-view]') return sundownViewBtns;
    return [];
  },
  querySelector(sel){
    if(sel === '#appHeader') return appHeader;
    if(sel === '#libToolsPanel') return libToolsPanel;
    if(sel === '#libToolsToggle') return libToolsToggle;
    if(sel === '#sundownDayView' || sel === '#sundownSoundView') return fakeEl(sel.slice(1));
    return null;
  },
};

const { showRoute, selectSundownView, lastSundownView, isLibraryRouteVisible, isProfileRouteVisible } =
  await import('../../src/shell/routes.js');

test('showRoute: a normal route (sundown) just toggles the matching .route element', () => {
  showRoute('sundown');
  assert.equal(routeEls['route-sundown'].classList.contains('on'), true);
  assert.equal(routeEls['route-library'].classList.contains('on'), false);
});

// DA3 (docs/DAY_ARC.md): the Character tab is gone from the DOM entirely
// — showRoute('character') must never just silently fail to match any
// .route element (which is what would happen without the redirect, since
// there is no "route-character" element any more). It has to land
// somewhere real: Sundown, with the Sound sub-view selected.
test('showRoute("character") redirects to sundown and selects the Sound sub-view, never 404s', () => {
  sundownViewBtns = [
    { dataset: { sundownView: 'day' }, setAttribute(){} },
    { dataset: { sundownView: 'sound' }, setAttribute(){} },
  ];
  showRoute('character');
  assert.equal(routeEls['route-sundown'].classList.contains('on'), true, 'should land on the sundown route');
  // selectSundownView('sound') was called as part of the redirect —
  // confirmed via its own return-trip through localStorage, the one
  // externally-observable side effect it has.
  assert.equal(lastSundownView(), 'sound');
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
