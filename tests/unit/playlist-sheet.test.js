// LB2 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 2): the playlist name
// sheet. playlistNameCollides() is pure and tested directly; the sheet
// itself (src/library/playlist-sheet.js) is tested with a minimal fake
// DOM + a nav-stack stub that actually calls back on closeLayer() (unlike
// tests/unit/queue.test.js's own no-op stub, which only needs to prove
// saveQueueAsPlaylist() *calls* the sheet, not how the sheet itself
// resolves) -- same "stop the chain at the door, but keep this one module
// real" posture as tests/unit/duplicate-scan.test.js's duplicateNamesElement.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// --- minimal fake DOM: enough for sheetHeader()/.p-btn building + real
// click/keydown dispatch, same shape as queue.test.js's own fakeEl() but
// with working addEventListener/dispatch so a button click or an Enter
// keydown can actually be driven from a test. ---
function fakeEl(){
  const listeners = {};
  return {
    children: [], style: {}, dataset: {}, value: '', hidden: false, disabled: false,
    textContent: '', className: '', _html: '',
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html = v; this.children = []; },
    classList: {
      add(){}, remove(){}, contains(){ return false; },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    appendChild(c){ this.children.push(c); return c; },
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    dispatch(type, ev = {}){ (listeners[type] || []).forEach(fn => fn(ev)); },
    focus(){},
  };
}
const elCache = new Map();
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = fakeEl(); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});

// nav-stack: openLayer() just remembers the close callback; closeLayer()
// actually calls it (and clears it), so the sheet's own teardown ->
// resolve(name) path is real here, unlike every other suite's no-op stub.
let pendingClose = null;
let openLayerCalls = [];
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: {
    openLayer(id, close){ openLayerCalls.push(id); pendingClose = close; },
    closeLayer(){ const c = pendingClose; pendingClose = null; if(c) c(); },
  },
});

const { openPlaylistNameSheet, playlistNameCollides } = await import('../../src/library/playlist-sheet.js');

function findAll(node, pred, out = []){
  if(!node) return out;
  if(pred(node)) out.push(node);
  (node.children || []).forEach(c => findAll(c, pred, out));
  return out;
}
function bodyEl(){ return elCache.get('#plNameBody'); }
function input(){ return findAll(bodyEl(), n => n.className === 'pl-input')[0]; }
function primaryBtn(){ return findAll(bodyEl(), n => n.className === 'p-btn p-btn--primary')[0]; }
function errorLine(){ return findAll(bodyEl(), n => n.className === 'note warn')[0]; }

function resetFakeDom(){
  elCache.clear();
  pendingClose = null;
  openLayerCalls = [];
}

// --- playlistNameCollides (pure) ---

test('playlistNameCollides: no match against an empty or unrelated list', () => {
  assert.equal(playlistNameCollides('Road trip', []), false);
  assert.equal(playlistNameCollides('Road trip', ['Sunday morning']), false);
});

test('playlistNameCollides: exact match collides', () => {
  assert.equal(playlistNameCollides('Road trip', ['Road trip']), true);
});

test('playlistNameCollides: case-insensitive and trims whitespace on both sides', () => {
  assert.equal(playlistNameCollides('road trip', ['Road Trip']), true);
  assert.equal(playlistNameCollides('  Road trip  ', ['Road trip']), true);
});

test('playlistNameCollides: an empty name never collides (nothing to refuse)', () => {
  assert.equal(playlistNameCollides('', ['Road trip']), false);
  assert.equal(playlistNameCollides('   ', ['Road trip']), false);
});

// --- the sheet itself ---

test('openPlaylistNameSheet: registers one nav-stack layer and resolves null when closed via the × button', async () => {
  resetFakeDom();
  const promise = openPlaylistNameSheet({ title: 'New playlist', confirmLabel: 'Create playlist' });
  assert.deepEqual(openLayerCalls, ['playlist-name']);
  const head = elCache.get('#plNameHead');
  const closeBtn = findAll(head, n => typeof n.textContent === 'string' && n.textContent === '✕')[0];
  closeBtn.dispatch('click');
  assert.equal(await promise, null);
});

test('openPlaylistNameSheet: the primary button starts disabled and enables once text is typed', async () => {
  resetFakeDom();
  const promise = openPlaylistNameSheet({ title: 'New playlist', confirmLabel: 'Create playlist' });
  const btn = primaryBtn();
  assert.equal(btn.disabled, true);
  const field = input();
  field.value = 'Road trip';
  field.dispatch('input');
  assert.equal(btn.disabled, false);
  btn.dispatch('click');
  assert.equal(await promise, 'Road trip');
});

test('openPlaylistNameSheet: Enter in the field submits exactly like the primary button', async () => {
  resetFakeDom();
  const promise = openPlaylistNameSheet({ title: 'New playlist', confirmLabel: 'Create playlist' });
  const field = input();
  field.value = 'Night drive';
  field.dispatch('input');
  field.dispatch('keydown', { key: 'Enter' });
  assert.equal(await promise, 'Night drive');
});

test('openPlaylistNameSheet: a name already in use is refused inline, without closing the sheet', async () => {
  resetFakeDom();
  const promise = openPlaylistNameSheet({
    title: 'New playlist', confirmLabel: 'Create playlist', existingNames: ['Road trip'],
  });
  const field = input();
  field.value = 'road trip';
  field.dispatch('input');
  primaryBtn().dispatch('click');
  assert.equal(openLayerCalls.length, 1, 'the sheet is still open -- closeLayer was never called');
  assert.equal(errorLine().hidden, false);
  assert.equal(errorLine().textContent, 'You already have a playlist called road trip.');
  // fixing the name past the collision still works
  field.value = 'Road trip 2';
  field.dispatch('input');
  assert.equal(errorLine().hidden, true, 'typing again clears the refusal');
  primaryBtn().dispatch('click');
  assert.equal(await promise, 'Road trip 2');
});

test('openPlaylistNameSheet: passes the note/title/confirmLabel straight through to the header and body', async () => {
  resetFakeDom();
  const promise = openPlaylistNameSheet({
    title: 'Rename playlist', confirmLabel: 'Save', note: 'Starts with the 5 songs in your queue.',
  });
  const head = elCache.get('#plNameHead');
  assert.ok(findAll(head, n => n.textContent === 'Rename playlist').length > 0);
  const btn = primaryBtn();
  assert.equal(btn.textContent, 'Save');
  assert.ok(findAll(bodyEl(), n => n.textContent === 'Starts with the 5 songs in your queue.').length > 0);
  btn.dispatch('click'); // still disabled (no name typed) -- resolves nothing yet
  assert.equal(btn.disabled, true);
  input().value = 'x'; input().dispatch('input');
  btn.dispatch('click');
  assert.equal(await promise, 'x');
});
