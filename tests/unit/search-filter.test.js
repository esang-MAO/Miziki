import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// NV6 (docs/11_SMOOTH_NAVIGATION.md): "filter the existing rows rather than
// rebuilding when possible." canFilterInPlace()/filterSearchInPlace() are
// new, non-trivial DOM-mutating logic (removing stale rows/section headers,
// re-highlighting the ones that stay, keeping a shared `queue` array's
// contents in step with what's on screen) that deserves direct coverage of
// its own, rather than piggybacking on tests/unit/search.test.js's existing
// fakeEl() (which has no remove()/parentNode/querySelector tree at all,
// just enough for its own call-count-style assertions) -- a separate file,
// with its own small-but-real fake DOM and realistic groupRow/songRow
// stand-ins, is simpler than bolting tree support onto that file's shared
// helper and risking its other 18 tests. Same mock.module preamble as that
// file otherwise (search.js's own real/mocked import chain hasn't changed).
function makeFakeEl(tag){
  const classes = new Set();
  const listeners = {};
  const kids = [];
  const node = {
    tagName: (tag || 'DIV').toUpperCase(), className: '', textContent: '',
    style: {}, value: '', dataset: {}, parentNode: null,
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    addEventListener(type, fn){ listeners[type] = fn; },
    fire(type, ev){ if(listeners[type]) listeners[type](ev || {}); },
    appendChild(child){ child.parentNode = node; kids.push(child); return child; },
    remove(){
      if(!node.parentNode) return;
      const at = node.parentNode.children.indexOf(node);
      if(at >= 0) node.parentNode.children.splice(at, 1);
      node.parentNode = null;
    },
    querySelector(sel){ return queryDescendant(node, sel); },
    children: kids,
  };
  return node;
}
function matchesSimple(el, token){
  if(!el || !el.tagName) return false;
  if(token.startsWith('.')) return (el.className || '').split(/\s+/).includes(token.slice(1));
  return el.tagName === token.toUpperCase();
}
// A tiny, good-enough selector engine for the handful of shapes this file's
// own code ever queries with: a bare class ('.t-idx') or a two-part
// descendant combinator ('.g-text b' / '.t-name b').
function queryDescendant(root, selector){
  const parts = selector.trim().split(/\s+/);
  function search(node, idx){
    for(const child of node.children){
      if(matchesSimple(child, parts[idx])){
        if(idx === parts.length - 1) return child;
        const deeper = search(child, idx + 1);
        if(deeper) return deeper;
      }
      const sameLevel = search(child, idx);
      if(sameLevel) return sameLevel;
    }
    return null;
  }
  return search(root, 0);
}

const elCache = new Map();
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, makeFakeEl()); return elCache.get(sel); },
    el(tag, cls, text){ const e = makeFakeEl(tag); if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
  },
});
globalThis.document = {
  createElement(){ return makeFakeEl(); },
  createTextNode(text){ return { nodeType: 3, textContent: text }; },
  createDocumentFragment(){ return makeFakeEl(); },
  activeElement: null,
};

function fakeGroupRow(label, sub, _idx, onTap){
  const b = makeFakeEl('button');
  b.className = 'grouprow';
  const box = makeFakeEl('span'); box.className = 'g-text';
  const bEl = makeFakeEl('b'); bEl.textContent = label;
  const em = makeFakeEl('em'); em.textContent = sub;
  box.appendChild(bEl); box.appendChild(em);
  b.appendChild(box);
  if(onTap) b.addEventListener('click', onTap);
  return b;
}
function fakeSongRow(i, queue, pos){
  const li = makeFakeEl('li');
  li.dataset.id = 'track-' + i;
  const idxEl = makeFakeEl('span'); idxEl.className = 't-idx'; idxEl.textContent = String(pos + 1).padStart(2, '0');
  li.appendChild(idxEl);
  const name = makeFakeEl('span'); name.className = 't-name';
  const bEl = makeFakeEl('b'); bEl.textContent = 'Title ' + i;
  name.appendChild(bEl);
  li.appendChild(name);
  li.addEventListener('click', () => setQueueMock(queue, queue.indexOf(i), true));
  return li;
}

const setQueueMock = mock.fn();
const queueSaveMock = mock.fn();
const renderTracksMock = mock.fn();
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: {
    renderTracks: renderTracksMock,
    groupRow: fakeGroupRow, songRow: fakeSongRow,
  },
});
mock.module(new URL('../../src/util/motion.js', import.meta.url).href, {
  namedExports: { REDUCED: false },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { closePlayer(){}, openPlayerViaSheet(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute(){} },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence(){} },
});
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; }, clearToRest(){}, performPendingFlip(){ return false; } },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: { shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){} },
});
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave: queueSaveMock, touchBackupField(){} },
});
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, persistable(rec){ return rec; } },
});
// RF23 (docs/12_REFINE.md): credits.js's new, one-directional import of
// openFriendStore (social/screens/friend-store.js) would otherwise reach
// that module's own real chain (profile/storefront.js and everything past
// it) via search.js's own real credits.js import — stopped at that new
// edge, the same way tests/unit/credits.test.js does.
mock.module(new URL('../../src/social/screens/friend-store.js', import.meta.url).href, {
  namedExports: { openFriendStore(){} },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, play(){}, pause(){}, seek(){}, sideLetterFor(){ return ''; }, cancelPendingGapless(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext(){} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

const { canFilterInPlace, filterSearchInPlace, renderSearchResults } = await import('../../src/library/search.js');
const { S } = await import('../../src/state.js');
const { emptyDetails } = await import('../../src/library/tags/index.js');

function fakeTrack(id, overrides){
  return Object.assign({
    id, tags: { title: 'Track ' + id, artist: 'Artist', album: 'Album', albumArtist: 'Artist', track: 1, disc: 1 },
    details: emptyDetails(), meta: { codec: 'FLAC', rate: 44100, bits: 16 }, addedAt: 0,
  }, overrides);
}
function resetState(overrides){
  Object.assign(S, {
    tracks: [], librarySort: 'artist', trackLastPlayed: {}, albumLastPlayed: {},
    sessionCounts: {}, trackPlayCounts: {}, view: { mode: 'albums', group: null, artistAlbum: null },
    albumSort: {}, albumOrder: {}, playlists: [],
  }, overrides);
  elCache.clear();
  setQueueMock.mock.resetCalls();
  queueSaveMock.mock.resetCalls();
  renderTracksMock.mock.resetCalls();
}

// ---- canFilterInPlace: the pure, correctness-critical guard ---------------

test('canFilterInPlace: false with no prior query (nothing to refine)', () => {
  assert.equal(canFilterInPlace(null, 'a'), false);
  assert.equal(canFilterInPlace('', 'a'), false);
});

test('canFilterInPlace: true for a plain-text query extended with more characters', () => {
  assert.equal(canFilterInPlace('pur', 'purp'), true);
  assert.equal(canFilterInPlace('purple', 'purple rain'), true);
});

test('canFilterInPlace: false when the new query is not a continuation (backspace, clear, unrelated text)', () => {
  assert.equal(canFilterInPlace('purple', 'purp'), false); // backspaced
  assert.equal(canFilterInPlace('purple', ''), false);      // cleared
  assert.equal(canFilterInPlace('purple', 'prince'), false); // unrelated
});

test('canFilterInPlace: false once either query carries a field: token (not generally monotonic)', () => {
  assert.equal(canFilterInPlace('artist:prince', 'artist:prince x'), false);
  assert.equal(canFilterInPlace('rain', 'rain year:>2000'), false);
});

test('canFilterInPlace: case/diacritic-insensitive, same as the matching it guards', () => {
  assert.equal(canFilterInPlace('Pur', 'PURP'), true);
});

// ---- filterSearchInPlace / renderSearchResults: the DOM-mutating half ----

test('filterSearchInPlace: with no prior search rendered, there is nothing to refine', () => {
  resetState({ tracks: [fakeTrack('a')] });
  const host = makeFakeEl();
  assert.equal(filterSearchInPlace(host, 'a'), false);
});

test('filterSearchInPlace: a narrowing refinement removes the no-longer-matching song rows in place and renumbers the rest', () => {
  resetState({ tracks: [
    fakeTrack('a', { tags: { title: 'Purple Rain', artist: 'Prince', album: 'Purple Rain', albumArtist: 'Prince', track:1, disc:1 } }),
    fakeTrack('b', { tags: { title: 'Purple Haze', artist: 'Hendrix', album: 'Are You Experienced', albumArtist: 'Hendrix', track:1, disc:1 } }),
    fakeTrack('c', { tags: { title: 'Unrelated Song', artist: 'Someone', album: 'Other', albumArtist: 'Someone', track:1, disc:1 } }),
  ] });
  const host = makeFakeEl();
  renderSearchResults(host, 'purple'); // establishes the bookkeeping the fast path needs
  const ul = host.children.find(c => c.className === 'tracklist');
  assert.equal(ul.children.length, 2, 'both Purple* tracks matched the first query');

  const handled = filterSearchInPlace(host, 'purple rain'); // a strict text extension
  assert.equal(handled, true);
  assert.equal(ul.children.length, 1, 'the Hendrix row no longer matches and was removed, not rebuilt');
  assert.equal(ul.children[0].querySelector('.t-idx').textContent, '01', 'the one remaining row is renumbered to 01');
  assert.equal(renderTracksMock.mock.callCount(), 0, 'renderTracks() is library/view.js\'s own hub -- filtering in place never calls back into it');
});

test('filterSearchInPlace: a kept song row still plays from its own, now-shifted position in the shared queue', () => {
  resetState({ tracks: [
    fakeTrack('a', { tags: { title: 'Purple Haze', artist: 'Hendrix', album: 'Are You Experienced', albumArtist: 'Hendrix', track:1, disc:1 } }),
    fakeTrack('b', { tags: { title: 'Purple Rain', artist: 'Prince', album: 'Purple Rain', albumArtist: 'Prince', track:1, disc:1 } }),
  ] });
  const host = makeFakeEl();
  renderSearchResults(host, 'purple');
  const ul = host.children.find(c => c.className === 'tracklist');
  assert.equal(ul.children.length, 2);

  filterSearchInPlace(host, 'purple rain'); // drops Hendrix (index 0), keeps Prince (was at position 1)
  assert.equal(ul.children.length, 1);
  ul.children[0].fire('click');
  assert.equal(setQueueMock.mock.callCount(), 1);
  const [queueArg, posArg] = setQueueMock.mock.calls[0].arguments;
  assert.equal(posArg, 0, 'the remaining track is now at position 0 in the narrowed queue, not its original 1');
  assert.deepEqual(queueArg, [1]);
});

test('filterSearchInPlace: a group section (e.g. Artists) that narrows to nothing removes its header along with its rows', () => {
  resetState({ tracks: [
    fakeTrack('a', { tags: { title: 'Song One', artist: 'Prince', album: 'Album One', albumArtist: 'Prince', track:1, disc:1 } }),
    fakeTrack('b', { tags: { title: 'Prince Something', artist: 'Someone Else', album: 'Other', albumArtist: 'Someone Else', track:1, disc:1 } }),
  ] });
  const host = makeFakeEl();
  renderSearchResults(host, 'prince');
  const headerLabels = () => host.children.filter(c => c.className === 'note').map(c => c.textContent);
  assert.ok(headerLabels().includes('Artists'));

  filterSearchInPlace(host, 'prince something'); // only track 'b' (title match) still matches; the artist "Prince" no longer does
  assert.ok(!headerLabels().includes('Artists'), 'the Artists section header is removed once its rows all drop out');
});

test('filterSearchInPlace: a query that narrows to literally nothing bails (lets the caller fall back to the "No matches" rebuild)', () => {
  resetState({ tracks: [
    fakeTrack('a', { tags: { title: 'Purple Rain', artist: 'Prince', album: 'Purple Rain', albumArtist: 'Prince', track:1, disc:1 } }),
  ] });
  const host = makeFakeEl();
  renderSearchResults(host, 'purple');
  assert.equal(filterSearchInPlace(host, 'purple zzz'), false);
});

test('filterSearchInPlace: refuses to filter a host that was wiped by something else since the last render (e.g. renderTracksBody\'s own reset)', () => {
  resetState({ tracks: [fakeTrack('a', { tags: { title: 'Purple Rain', artist: 'Prince', album: 'Purple Rain', albumArtist: 'Prince', track:1, disc:1 } })] });
  const host = makeFakeEl();
  renderSearchResults(host, 'purple');
  host.children.slice().forEach(c => c.remove()); // simulate host.innerHTML = '' happening elsewhere
  assert.equal(filterSearchInPlace(host, 'purple rain'), false);
});
