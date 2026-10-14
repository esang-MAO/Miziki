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
  recordRoute, onRouteRestore, initNavStack, _debugLayers,
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
