import { test } from 'node:test';
import assert from 'node:assert/strict';

// src/shell/scroll-memory.js has zero imports of its own, so it's testable
// with a tiny fake window/history, the same precedent as nav-stack.test.js.
globalThis.window = { scrollY: 0, scrollTo(x, y){ globalThis.window.scrollY = y; } };
globalThis.history = {};

const { saveScrollPosition, restoreScrollPosition, initScrollRestoration, _debugPositions } =
  await import('../../src/shell/scroll-memory.js');

test('saveScrollPosition/restoreScrollPosition: round-trips a position by key', () => {
  globalThis.window.scrollY = 240;
  saveScrollPosition('route:library');
  globalThis.window.scrollY = 0;
  restoreScrollPosition('route:library');
  assert.equal(globalThis.window.scrollY, 240);
});

test('restoreScrollPosition: an unseen key restores to the top', () => {
  globalThis.window.scrollY = 500;
  restoreScrollPosition('route:never-visited');
  assert.equal(globalThis.window.scrollY, 0);
});

test('saveScrollPosition: a falsy key is a no-op (never throws, never recorded)', () => {
  const before = _debugPositions().size;
  saveScrollPosition(null);
  saveScrollPosition(undefined);
  saveScrollPosition('');
  assert.equal(_debugPositions().size, before);
});

test('two keys keep independent positions', () => {
  globalThis.window.scrollY = 100;
  saveScrollPosition('route:library');
  globalThis.window.scrollY = 999;
  saveScrollPosition('route:sundown');
  restoreScrollPosition('route:library');
  assert.equal(globalThis.window.scrollY, 100);
  restoreScrollPosition('route:sundown');
  assert.equal(globalThis.window.scrollY, 999);
});

test('initScrollRestoration: sets history.scrollRestoration to "manual" when the browser supports it', () => {
  globalThis.history = { scrollRestoration: 'auto' };
  initScrollRestoration();
  assert.equal(globalThis.history.scrollRestoration, 'manual');
});

test('initScrollRestoration: never throws when history/scrollRestoration isn\'t available', () => {
  globalThis.history = undefined;
  assert.doesNotThrow(() => initScrollRestoration());
  globalThis.history = {};
  assert.doesNotThrow(() => initScrollRestoration());
});

test('saveScrollPosition/restoreScrollPosition: never throw when window isn\'t available', () => {
  const realWindow = globalThis.window;
  globalThis.window = undefined;
  assert.doesNotThrow(() => saveScrollPosition('route:library'));
  assert.doesNotThrow(() => restoreScrollPosition('route:library'));
  globalThis.window = realWindow;
});

test('saveScrollPosition/restoreScrollPosition: an element target round-trips its own scrollTop, not window.scrollY', () => {
  globalThis.window.scrollY = 999;
  const host = { scrollTop: 150 };
  saveScrollPosition('lib-view:artists:Boygenius', host);
  host.scrollTop = 0;
  restoreScrollPosition('lib-view:artists:Boygenius', host);
  assert.equal(host.scrollTop, 150);
  assert.equal(globalThis.window.scrollY, 999);
});

test('restoreScrollPosition: an unseen key on an element target restores it to 0', () => {
  const host = { scrollTop: 300 };
  restoreScrollPosition('lib-view:never-visited', host);
  assert.equal(host.scrollTop, 0);
});
