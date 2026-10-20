import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/shell/sidebar.js only needs $/el (util/dom.js) and S (state.js) —
// mocked to tiny, DOM-free stubs rather than pulling in a real document,
// the same shape favorites.test.js/edit.test.js already use. fakeHost
// collects whatever el() builds via appendChild, so a test can assert on
// the resulting children directly — which is the whole point of the
// required test case below (docs/DESKTOP_LAYOUT.md's own "feed a
// playlist name containing <img src=x onerror=alert(1)> and assert it
// appears as text"): a fake with no innerHTML parser to misuse in the
// first place means a regression here would show up as the payload
// missing from the collected text, not as a real <img> ever existing.
function fakeHost(){
  return {
    children: [],
    set innerHTML(v){ if(v === '') this.children = []; },
    appendChild(c){ this.children.push(c); },
  };
}
function fakeEl(tag, cls, text){
  const node = { tag, className: cls, textContent: text, dataset: {}, children: [] };
  node.appendChild = c => node.children.push(c);
  return node;
}

let host, binsHost;
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ return sel === '#sidebarPlaylists' ? host : sel === '#sidebarBins' ? binsHost : null; },
    el: fakeEl,
  },
});

// src/shell/sidebar.js's new CR10 (docs/13_CRATE.md point 3) BINS list
// reads the already-built crate model (ensureCrateModel(), crate/model.js)
// rather than computing its own counts — mocked to a tiny, controllable
// stand-in rather than letting the real module load, the same "stop the
// chain at the door" reasoning as every other mock-heavy file in this
// suite: the real crate/model.js real-chains into util/motion.js, whose
// top-level REDUCED read needs a real `window` this file doesn't stub.
let crateModelBins;
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { ensureCrateModel(){ return { items: crateModelBins }; } },
});

const { renderSidebarPlaylists, renderSidebarBins } = await import('../../src/shell/sidebar.js');
const { S } = await import('../../src/state.js');

test('renderSidebarPlaylists: an empty library shows the empty-state row', () => {
  host = fakeHost();
  S.playlists = [];
  renderSidebarPlaylists();
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].textContent, 'No playlists yet');
});

test('renderSidebarPlaylists: a system playlist (Favorites) is pinned first', () => {
  host = fakeHost();
  S.playlists = [
    { name: 'Road Trip', items: [] },
    { name: 'Favorites', items: [], system: 'favorites' },
  ];
  renderSidebarPlaylists();
  assert.deepEqual(host.children.map(c => c.textContent), ['Favorites', 'Road Trip']);
});

// docs/DESKTOP_LAYOUT.md's own required test case, verbatim shape.
test('renderSidebarPlaylists: a playlist name renders as text, never markup', () => {
  host = fakeHost();
  const payload = '<img src=x onerror=alert(1)>';
  S.playlists = [{ name: payload, items: [] }];
  renderSidebarPlaylists();
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].textContent, payload);
});

test('renderSidebarPlaylists: no #sidebarPlaylists host yet (not in the DOM) is a quiet no-op', () => {
  host = null;
  assert.doesNotThrow(() => renderSidebarPlaylists());
});

test('renderSidebarBins: no bins at all shows the empty-state row', () => {
  binsHost = fakeHost();
  crateModelBins = [];
  renderSidebarBins();
  assert.equal(binsHost.children.length, 1);
  assert.equal(binsHost.children[0].textContent, 'No bins yet');
});

test('renderSidebarBins: one row per virtual bin, each carrying its key/label/count', () => {
  binsHost = fakeHost();
  crateModelBins = [
    { type: 'div', kind: 'bin', key: 'new', label: 'NEW ARRIVALS', meta: '3 ALBUMS' },
    { type: 'div', kind: 'bin', key: 'picks', label: 'STAFF PICKS', meta: '1 ALBUM' },
    { type: 'div', kind: 'bin', key: 'sealed', label: 'SEALED', meta: '2 ALBUMS' },
    // a non-bin divider (letter/genre/decade/artist) in the same model
    // must never show up in this list — only kind:'bin' dividers do.
    { type: 'div', kind: 'letter', key: 'A', label: 'A', meta: '5 ALBUMS' },
    { type: 'rec', albumId: 'x' },
  ];
  renderSidebarBins();
  assert.equal(binsHost.children.length, 3);
  const rows = binsHost.children.map(li => li.children[0]);
  assert.deepEqual(rows.map(b => b.dataset.bin), ['new', 'picks', 'sealed']);
  assert.deepEqual(rows.map(b => b.children[0].textContent), ['NEW ARRIVALS', 'STAFF PICKS', 'SEALED']);
  assert.deepEqual(rows.map(b => b.children[1].textContent), ['3 ALBUMS', '1 ALBUM', '2 ALBUMS']);
});

test('renderSidebarBins: no #sidebarBins host yet (not in the DOM) is a quiet no-op', () => {
  binsHost = null;
  crateModelBins = [];
  assert.doesNotThrow(() => renderSidebarBins());
});
