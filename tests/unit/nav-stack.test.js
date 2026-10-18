import { test } from 'node:test';
import assert from 'node:assert/strict';

// NV2 (docs/11_SMOOTH_NAVIGATION.md): src/shell/nav-stack.js has no imports
// of its own (no other src module, see its own header comment) — just
// document/history/window, which don't exist in Node, so this stubs the
// three of them with the minimum real tests need: a fake DOM element
// (setAttribute/removeAttribute/focus/querySelector, enough for applyInert/
// focusFirstIn to run without throwing), a fake history stack (replaceState/
// pushState/go, tracked so a test can assert exactly how many entries were
// consumed), and a fake window whose addEventListener just records the
// handler so a test can re-invoke it directly, the same as actually firing
// a popstate/keydown event would.
function makeFakeEl(){
  return {
    _attrs: {},
    setAttribute(k, v){ this._attrs[k] = v; },
    removeAttribute(k){ delete this._attrs[k]; },
    focus(){ this._focused = true; },
    querySelector(){ return null; },
  };
}

const historyStack = [null];
let historyIndex = 0;
let lastGoArg = null;
globalThis.history = {
  replaceState(state){ historyStack[historyIndex] = state; },
  pushState(state){ historyIndex++; historyStack[historyIndex] = state; },
  go(n){ lastGoArg = n; historyIndex += n; },
};

const listeners = {};
globalThis.window = {
  addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
  removeEventListener(){},
};

const fakeBody = makeFakeEl();
globalThis.document = {
  getElementById(){ return null; },
  body: fakeBody,
  activeElement: makeFakeEl(),
};

const {
  idsToClose, openLayer, closeLayer, forceCloseLayer,
  recordRoute, onRouteRestore, initNavStack, hasOpenLayer, _debugLayers,
} = await import('../../src/shell/nav-stack.js');

function fire(type, ev){
  (listeners[type] || []).forEach(fn => fn(ev));
}

/* ---- idsToClose: pure diff helper, no DOM/history involved at all ---- */

test('idsToClose: a Back to an id already open closes everything above it', () => {
  assert.deepEqual(idsToClose(['a', 'b', 'c'], ['a']), ['c', 'b']);
});

test('idsToClose: already in sync (same top id) closes nothing', () => {
  assert.deepEqual(idsToClose(['a'], ['a']), []);
});

test('idsToClose: a Back past everything (no target ids left) closes all, topmost first', () => {
  assert.deepEqual(idsToClose(['a', 'b'], []), ['b', 'a']);
});

test('idsToClose: nothing open and nothing targeted is a no-op', () => {
  assert.deepEqual(idsToClose([], []), []);
});

/* ---- openLayer/closeLayer: push/pop order and the close-callback contract ---- */

test('openLayer: pushes in order, closeLayer closes top-down and consumes one history entry per layer', () => {
  const closed = [];
  openLayer('a', () => closed.push('a'));
  openLayer('b', () => closed.push('b'));
  openLayer('c', () => closed.push('c'));
  assert.deepEqual(_debugLayers(), ['a', 'b', 'c']);

  // closing a layer that isn't topmost closes it and everything stacked
  // above it too, most-recently-opened first
  closeLayer('b');
  assert.deepEqual(closed, ['c', 'b']);
  assert.deepEqual(_debugLayers(), ['a']);
  assert.equal(lastGoArg, -2);   // two layers closed in one go

  closeLayer('a');
  assert.deepEqual(_debugLayers(), []);
});

test('closeLayer: closing an id that is not open is a no-op', () => {
  openLayer('x', () => {});
  lastGoArg = null;
  closeLayer('not-open');
  assert.deepEqual(_debugLayers(), ['x']);
  assert.equal(lastGoArg, null);
  closeLayer('x');
});

test('a layer whose close callback throws never blocks closing the rest of the stack', () => {
  const closed = [];
  openLayer('a', () => closed.push('a'));
  openLayer('b', () => { throw new Error('boom'); });
  closeLayer('a');
  assert.deepEqual(closed, ['a']);   // 'b' threw, 'a' still ran
  assert.deepEqual(_debugLayers(), []);
});

/* ---- forceCloseLayer: the instant-teardown twin, used for a forced
   replace (e.g. switching tabs out from under an open gatefold) rather
   than the user dismissing the layer themselves ---- */

test('forceCloseLayer: uses the instant close, not the (possibly animated) default one', () => {
  const calls = [];
  openLayer('gatefold', () => calls.push('animated'), { instantClose: () => calls.push('instant') });
  forceCloseLayer('gatefold');
  assert.deepEqual(calls, ['instant']);
  assert.deepEqual(_debugLayers(), []);
});

test('forceCloseLayer: without instantClose, falls back to the registered close', () => {
  const calls = [];
  openLayer('plain', () => calls.push('close'));
  forceCloseLayer('plain');
  assert.deepEqual(calls, ['close']);
});

/* ---- popstate: a real Back press closes only the topmost layer, never
   double-closes with a UI-driven close, and a stale/empty popstate no-ops ---- */

test('popstate: Back closes only the topmost open layer', () => {
  initNavStack();
  openLayer('a', () => {});
  openLayer('b', () => {});
  assert.deepEqual(_debugLayers(), ['a', 'b']);
  // the browser's own popstate for a Back press that lands back on 'a'
  fire('popstate', { state: { navLayer: 'a' } });
  assert.deepEqual(_debugLayers(), ['a']);
  closeLayer('a');
});

test('popstate: closing via the UI (closeLayer) and the trailing popstate it causes never double-closes', () => {
  const closed = [];
  openLayer('x', () => closed.push('x'));
  // the close button/Escape path: closeLayer() already removed 'x' from the
  // layer stack and called history.go(-1) itself before the browser's own
  // matching popstate for that go() arrives
  closeLayer('x');
  assert.deepEqual(closed, ['x']);
  fire('popstate', { state: null });   // the trailing popstate from history.go(-1) above
  assert.deepEqual(closed, ['x']);     // not called a second time
  assert.deepEqual(_debugLayers(), []);
});

test('popstate: a stale event with nothing open is a no-op', () => {
  assert.deepEqual(_debugLayers(), []);
  fire('popstate', { state: { navLayer: 'whatever-was-open-before-a-reload' } });
  assert.deepEqual(_debugLayers(), []);
});

test('popstate: a reload that lost in-memory layer state but still carries a stale browser history entry never throws', () => {
  assert.doesNotThrow(() => fire('popstate', { state: { navLayer: 'stale-from-before-reload' } }));
  assert.deepEqual(_debugLayers(), []);
});

/* ---- Escape: closes the topmost layer, same as Back ---- */

test('keydown Escape closes the topmost layer', () => {
  const closed = [];
  openLayer('a', () => closed.push('a'));
  openLayer('b', () => closed.push('b'));
  fire('keydown', { key: 'Escape', preventDefault(){} });
  assert.deepEqual(closed, ['b']);
  assert.deepEqual(_debugLayers(), ['a']);
  closeLayer('a');
});

test('keydown: a non-Escape key is ignored', () => {
  openLayer('a', () => {});
  fire('keydown', { key: 'Enter', preventDefault(){} });
  assert.deepEqual(_debugLayers(), ['a']);
  closeLayer('a');
});

/* ---- tab-switch Back exception: Library <-> another tab ---- */

test('recordRoute: library -> another tab pushes a real history entry', () => {
  const before = historyIndex;
  recordRoute('library');
  recordRoute('home');
  assert.equal(historyIndex, before + 1);
});

test('recordRoute: another tab -> library replaces, never pushes', () => {
  recordRoute('home');
  const before = historyIndex;
  recordRoute('library');
  assert.equal(historyIndex, before);
});

test('recordRoute: switching between two non-library tabs replaces, never pushes', () => {
  recordRoute('library');
  recordRoute('home');
  const before = historyIndex;
  recordRoute('sundown');
  assert.equal(historyIndex, before);
});

test('recordRoute: does nothing while a layer is open (its own history entry is left alone)', () => {
  recordRoute('library');
  openLayer('a', () => {});
  const before = historyIndex;
  recordRoute('home');
  assert.equal(historyIndex, before);
  closeLayer('a');
  recordRoute('library');
});

test('onRouteRestore: a route-only popstate (no layers open) calls the restore callback', () => {
  let restoredTo = null;
  onRouteRestore(route => { restoredTo = route; });
  recordRoute('library');
  recordRoute('home');
  fire('popstate', { state: { navRoute: 'library' } });
  assert.equal(restoredTo, 'library');
});

test('onRouteRestore: a layer popstate never reaches the route-restore callback', () => {
  let restoredTo = null;
  onRouteRestore(route => { restoredTo = route; });
  openLayer('a', () => {});
  fire('popstate', { state: { navLayer: 'a' } });
  assert.equal(restoredTo, null);   // handlePopstate owned this one, not handleRoutePopstate
  closeLayer('a');
});

// NV4 (docs/11_SMOOTH_NAVIGATION.md): pull-to-refresh must never start
// while any overlay/sheet is open -- hasOpenLayer() is the real (not
// test-only) accessor it checks.
test('hasOpenLayer: false with nothing open, true with a layer open, false again once it closes', () => {
  assert.equal(hasOpenLayer(), false);
  openLayer('a', () => {});
  assert.equal(hasOpenLayer(), true);
  closeLayer('a');
  assert.equal(hasOpenLayer(), false);
});

/* ---- applyInert: the background must go inert, but the topmost layer's
   own container (and the app's one open overlay, not the whole page) must
   stay reachable -- regression coverage for the real bug: every overlay in
   this app (the full player, the gatefold, every sheet) is a direct
   sibling of the rest of the app's own top-level content, not a
   descendant of it, so inerting a single "whole app" root used to also
   inert the overlay that was just opened, right along with it. */

function makeTreeEl(id, children = []){
  const el = {
    id,
    _attrs: {},
    children,
    parentNode: null,
    setAttribute(k, v){ this._attrs[k] = v; },
    removeAttribute(k){ delete this._attrs[k]; },
    contains(other){
      for(let n = other; n; n = n.parentNode) if(n === this) return true;
      return false;
    },
    querySelector(){ return null; },
  };
  children.forEach(c => { c.parentNode = el; });
  return el;
}

function isInert(el){ return el._attrs.inert === ''; }

test('applyInert: a layer whose container is a top-level sibling (the full player, the gatefold) inerts every OTHER sibling, never the container itself', () => {
  const gatefold = makeTreeEl('gatefold');
  const playerOverlay = makeTreeEl('playerOverlay');
  const wrap = makeTreeEl('wrap');
  const miniPlayer = makeTreeEl('miniPlayer');
  const body = makeTreeEl('body', [wrap, miniPlayer, playerOverlay, gatefold]);

  initNavStack(body);
  openLayer('player', () => {}, { container: playerOverlay });

  assert.equal(isInert(playerOverlay), false, 'the open layer\'s own container must stay reachable');
  assert.equal(isInert(wrap), true);
  assert.equal(isInert(miniPlayer), true);
  assert.equal(isInert(gatefold), true);
  assert.equal(isInert(body), false, 'the whole page must never go inert, only the container\'s siblings');

  closeLayer('player');
  assert.equal(isInert(wrap), false);
  assert.equal(isInert(miniPlayer), false);
  assert.equal(isInert(gatefold), false);
});

test('applyInert: a layer whose container is nested inside other reachable content (the header search field) inerts siblings at every level, leaving the whole path to it reachable', () => {
  const hdrSearchRow = makeTreeEl('hdrSearchRow');
  const addMenu = makeTreeEl('addMenu');
  const header = makeTreeEl('header', [hdrSearchRow, addMenu]);
  const routeLibrary = makeTreeEl('route-library', [header]);
  const routeHome = makeTreeEl('route-home');
  const wrap = makeTreeEl('wrap', [routeLibrary, routeHome]);
  const gatefold = makeTreeEl('gatefold');
  const body = makeTreeEl('body', [wrap, gatefold]);

  initNavStack(body);
  openLayer('search-field', () => {}, { container: hdrSearchRow });

  // the path down to the container stays reachable at every level...
  assert.equal(isInert(hdrSearchRow), false);
  assert.equal(isInert(header), false);
  assert.equal(isInert(routeLibrary), false);
  assert.equal(isInert(wrap), false);
  // ...while its siblings at each of those same levels go inert
  assert.equal(isInert(addMenu), true);
  assert.equal(isInert(routeHome), true);
  assert.equal(isInert(gatefold), true);

  closeLayer('search-field');
  assert.equal(isInert(addMenu), false);
  assert.equal(isInert(routeHome), false);
  assert.equal(isInert(gatefold), false);
});

test('applyInert: a layer with no container (or one not actually in the tree) falls back to inerting the whole root, the same as before this behavior existed', () => {
  const wrap = makeTreeEl('wrap');
  const body = makeTreeEl('body', [wrap]);
  initNavStack(body);
  openLayer('no-container', () => {});
  assert.equal(isInert(body), true);
  closeLayer('no-container');
  assert.equal(isInert(body), false);
});

// Regression coverage for the real bug this fixes: the Sundown sheet
// (src/shell/sundown-sheet.js) is made of two separate top-level siblings
// — the sheet itself and its own scrim — not one container with the other
// nested inside it, the way every .edit-overlay/.share-overlay in this app
// is. Passing only the sheet as `container` used to mark the scrim inert
// as "just another background sibling," which silently disabled the
// scrim's own CSS `pointer-events:auto` rule (`inert`'s UA style always
// wins over author CSS) — so tapping the dimmed backdrop to dismiss the
// sheet stopped working. `opts.container` must accept an array and protect
// every element in it.
test('applyInert: an array container (the Sundown sheet + its own separate scrim sibling) keeps every one of them reachable, not just the first', () => {
  const sheet = makeTreeEl('sundownSheet');
  const scrim = makeTreeEl('sundownSheetScrim');
  const wrap = makeTreeEl('wrap');
  const miniPlayer = makeTreeEl('miniPlayer');
  const body = makeTreeEl('body', [wrap, miniPlayer, scrim, sheet]);

  initNavStack(body);
  openLayer('sundown-sheet', () => {}, { container: [sheet, scrim] });

  assert.equal(isInert(sheet), false, 'the sheet itself must stay reachable');
  assert.equal(isInert(scrim), false, 'the scrim must stay reachable too, or its own tap-to-dismiss silently breaks');
  assert.equal(isInert(wrap), true);
  assert.equal(isInert(miniPlayer), true);

  closeLayer('sundown-sheet');
  assert.equal(isInert(wrap), false);
  assert.equal(isInert(miniPlayer), false);
});
