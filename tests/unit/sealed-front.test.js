import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// GF8 (docs/29_GATEFOLD.md): util/motion.js's REDUCED is read once, at
// module load, from window.matchMedia -- stubbed here the same way every
// other gatefold test file does, before anything imports the real
// sealed-front.js.
globalThis.window = { matchMedia(){ return { matches: false }; } };
// openSealedFront()'s own requestAnimationFrame call (for the show-class
// transition) has nothing to do with this file's own subject -- run its
// callback synchronously rather than stub around it everywhere it's read.
globalThis.requestAnimationFrame = fn => fn();

// gatefold/view.js's own real chain (shell/start-sequence.js, shell/
// player-overlay.js, shell/handoff.js and more) has nothing to do with
// this file's own subject (the peel gesture/wrap state) -- mocked
// directly, the usual "stop the chain at the door" reasoning.
const openGatefoldMock = mock.fn();
mock.module(new URL('../../src/gatefold/view.js', import.meta.url).href, {
  namedExports: {
    openGatefold: openGatefoldMock,
    gatefoldTrackIndices(item){ return item.idx; },
    gatefoldItemFormat(){ return { size: '12"', speed: 33.333 }; },
  },
});
// GF5/GF6: back-cover.js's own buildBackCoverEl imports ui/wordmark.js, a
// ?raw asset import node:test can't resolve -- mocked here too.
const getAlbumBackCoverBlobMock = mock.fn(async () => null);
mock.module(new URL('../../src/gatefold/back-cover.js', import.meta.url).href, {
  namedExports: {
    buildBackCoverEl(){ return { tagName: 'DIV' }; },
    buildBackCoverImageEl(){ return { tagName: 'DIV' }; },
    getAlbumBackCoverBlob: getAlbumBackCoverBlobMock,
  },
});
// library/sealed.js's breakSeal() is this file's own one-way hand-off --
// mocked so a commit can be asserted without library/sealed.js's own
// wider chain (player/queue.js, shell/start-sequence.js) having to load.
const breakSealMock = mock.fn();
mock.module(new URL('../../src/library/sealed.js', import.meta.url).href, {
  namedExports: { breakSeal: breakSealMock },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { thumbURL: {} },
});
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { getCrateArtURL: async () => null },
});
// shell/nav-stack.js registers the real history-based layer stack, which
// reads the real browser history/document -- stubbed to a tiny stand-in
// that just tracks the open layer's own close callback, so closeLayer()
// below can actually run it (the same trigger commitPeel()/the Crate
// button use), the same shape queue.test.js's own nav-stack stub uses.
let registeredClose = null;
mock.module(new URL('../../src/shell/nav-stack.js', import.meta.url).href, {
  namedExports: {
    openLayer(_id, onClose){ registeredClose = onClose; },
    closeLayer(){ if(registeredClose){ const fn = registeredClose; registeredClose = null; fn(); } },
  },
});

function fakeEl(){
  const classes = new Set();
  const listeners = {};
  return {
    textContent: '', style: {}, value: '', innerHTML: '',
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
    appendChild(child){ return child; },
    getBoundingClientRect(){ return { width: 350, height: 350 }; },
    setPointerCapture(){},
    focus(){},
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn){
      if(!listeners[type]) return;
      listeners[type] = listeners[type].filter(f => f !== fn);
    },
    fire(type, evt){ (listeners[type] || []).slice().forEach(fn => fn(evt || {})); },
  };
}
const elCache = new Map();
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ if(!elCache.has(sel)) elCache.set(sel, fakeEl()); return elCache.get(sel); },
  },
});
globalThis.document = {
  activeElement: null,
  contains(){ return false; },
  createElement(){ return fakeEl(); },
};

const {
  openSealedFront, closeSealedFront, isSealedFrontOpen, toggleSealedFrontTurnedOver,
} = await import('../../src/gatefold/sealed-front.js');
const { S } = await import('../../src/state.js');

function fakeItem(overrides){
  return Object.assign({
    albumId: 'al1', album: 'Test Album', artist: 'Test Artist', year: 2024,
    idx: [0, 1],
  }, overrides);
}

async function resetAll(){
  await closeSealedFront();   // leaves no FRONT state from a prior test
  elCache.clear();
  registeredClose = null;
  openGatefoldMock.mock.resetCalls();
  breakSealMock.mock.resetCalls();
  getAlbumBackCoverBlobMock.mock.resetCalls();
  S.tracks = [
    { tags: { title: 'One' }, duration: 180, art: null },
    { tags: { title: 'Two' }, duration: 200, art: null },
  ];
}

test('isSealedFrontOpen reflects open/close state', async () => {
  await resetAll();
  assert.equal(isSealedFrontOpen(), false);
  openSealedFront(fakeItem());
  assert.equal(isSealedFrontOpen(), true);
  await closeSealedFront();
  assert.equal(isSealedFrontOpen(), false);
});

test('openSealedFront paints the title/artist/format text', async () => {
  await resetAll();
  openSealedFront(fakeItem());
  assert.equal(elCache.get('#sealedFrontCoverTitle').textContent, 'Test Album');
  assert.equal(elCache.get('#sealedFrontArtist').textContent, 'Test Artist · 2024');
  assert.match(elCache.get('#sealedFrontFormat').textContent, /12″ LP/);
});

// GF8 point 1/4: "Peeling breaks the seal, the same as a first play does
// today" -- a completed drag past the commit threshold calls breakSeal()
// and only then hands off to the real gatefold, never the other order
// (a sealed record must never reach the gatefold without the seal having
// broken first).
test('a completed corner drag past the commit threshold breaks the seal, then opens the gatefold', async () => {
  await resetAll();
  const item = fakeItem();
  openSealedFront(item);
  const hotspot = elCache.get('#sealedFrontHotspot');
  hotspot.fire('pointerdown', { clientX: 300, clientY: 100, pointerId: 1 });
  // drag down-and-left off the top-right corner, well past PEEL_COMMIT
  hotspot.fire('pointermove', { clientX: 50, clientY: 400, preventDefault(){} });
  // the commit awaits the ~400ms detach animation before breakSeal()/
  // closeLayer()/openGatefold() run (REDUCED is off in this file).
  await new Promise(r => setTimeout(r, 450));
  assert.equal(breakSealMock.mock.calls.length, 1);
  assert.equal(breakSealMock.mock.calls[0].arguments[0], 'al1');
  assert.equal(openGatefoldMock.mock.calls.length, 1);
  assert.equal(openGatefoldMock.mock.calls[0].arguments[0], item);
  assert.equal(isSealedFrontOpen(), false);
});

test('a drag released short of the threshold does not break the seal', async () => {
  await resetAll();
  openSealedFront(fakeItem());
  const hotspot = elCache.get('#sealedFrontHotspot');
  hotspot.fire('pointerdown', { clientX: 300, clientY: 100, pointerId: 1 });
  hotspot.fire('pointermove', { clientX: 280, clientY: 120, preventDefault(){} });   // barely moved
  hotspot.fire('pointerup', {});
  assert.equal(breakSealMock.mock.calls.length, 0);
  assert.equal(openGatefoldMock.mock.calls.length, 0);
  assert.equal(isSealedFrontOpen(), true);
});

// GF8 point 3: "Turn it over first" shows the back through the same wrap,
// without breaking anything.
test('toggleSealedFrontTurnedOver flips the button label and reads the back cover, without breaking the seal', async () => {
  await resetAll();
  openSealedFront(fakeItem());
  toggleSealedFrontTurnedOver();
  assert.equal(elCache.get('#sealedFrontTurnBtn').textContent, 'Turn it back over');
  assert.equal(getAlbumBackCoverBlobMock.mock.calls.length, 1);
  assert.equal(breakSealMock.mock.calls.length, 0);
  toggleSealedFrontTurnedOver();
  assert.equal(elCache.get('#sealedFrontTurnBtn').textContent, 'Turn it over first');
});

test('closeSealedFront (the Crate back button) never breaks the seal or opens the gatefold', async () => {
  await resetAll();
  openSealedFront(fakeItem());
  await closeSealedFront();
  assert.equal(breakSealMock.mock.calls.length, 0);
  assert.equal(openGatefoldMock.mock.calls.length, 0);
});
