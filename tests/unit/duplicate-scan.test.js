import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/library/duplicate-scan.js imports deleteTracks from ./delete.js,
// whose own real chain is wide (transport.js, clock.js, history/sessions,
// crate/tiers.js/model.js, library/view.js, ...) -- mocked directly here,
// the usual "stop the chain at the door" reasoning, since none of it is
// needed to test duplicateNamesElement, a pure DOM builder with no other
// imports.
mock.module(new URL('../../src/library/delete.js', import.meta.url).href, {
  namedExports: { deleteTracks: async () => {} },
});

// duplicateNamesElement calls the bare document.createElement/createTextNode
// globals directly (not util/dom.js's el()) -- stubbed with a minimal fake
// DOM that tracks real parent/child structure and keeps text-node data
// separate from element tags, so a test can tell "stored as literal text"
// apart from "parsed as markup" without pulling in a real DOM/jsdom
// dependency this suite doesn't otherwise use.
function fakeElement(tag){
  return { tagName: tag.toUpperCase(), style: {}, className: '', children: [],
    appendChild(c){ this.children.push(c); return c; } };
}
function fakeTextNode(data){ return { nodeType: 3, data }; }
globalThis.document = {
  createElement: fakeElement,
  createTextNode: fakeTextNode,
};

function collectText(node){
  if(node.nodeType === 3) return node.data;
  return (node.children || []).map(collectText).join('');
}
function collectTagNames(node, out = []){
  if(node.tagName) out.push(node.tagName);
  (node.children || []).forEach(c => collectTagNames(c, out));
  return out;
}

const { duplicateNamesElement } = await import('../../src/library/duplicate-scan.js');

test('duplicateNamesElement: a track title/artist containing HTML renders as literal text', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const tracks = [
    { tags: { title: payload, artist: 'Artist A' } },
    { tags: { title: 'Normal Title', artist: 'Artist B' } },
  ];
  const el = duplicateNamesElement(tracks);
  const text = collectText(el);
  assert.ok(text.includes(payload + ' — Artist A'), 'the malicious title survives as literal text');
  assert.ok(text.includes('Normal Title — Artist B'));
  // never interpreted as markup -- no <img> (or any other) element was
  // created out of the tag text, only text nodes plus the <br> separator
  // this function itself builds
  assert.deepEqual(collectTagNames(el).filter(t => t !== 'DIV' && t !== 'BR'), []);
});

test('duplicateNamesElement: separates multiple tracks with a real <br>, not a joined string', () => {
  const tracks = [
    { tags: { title: 'A', artist: 'X' } },
    { tags: { title: 'B', artist: 'Y' } },
  ];
  const el = duplicateNamesElement(tracks);
  assert.deepEqual(collectTagNames(el), ['DIV', 'BR']);
});
