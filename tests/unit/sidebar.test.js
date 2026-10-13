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
function fakeEl(tag, cls, text){ return { tag, className: cls, textContent: text }; }

let host;
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { $(sel){ return sel === '#sidebarPlaylists' ? host : null; }, el: fakeEl },
});

const { renderSidebarPlaylists } = await import('../../src/shell/sidebar.js');
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
