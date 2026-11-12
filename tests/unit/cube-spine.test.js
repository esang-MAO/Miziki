import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// CO5 (docs/37_COLOUR.md, recommendation 6): cubeSpine() (shelf-unit.js)
// builds real DOM via util/dom.js's el(), which node:test has no document
// for -- mocked flat to a tiny fakeEl(), the same shape looks.test.js
// already uses for this exact reason. art-color.js's loadImageEl() is
// mocked too (a real browser Image/canvas), so resolveSpineColor()'s own
// async cover-colour resolution safely falls through to its catch block
// without ever reaching a real network/canvas call -- only the
// synchronous "paint the fallback immediately" half is under test here.
function fakeEl(){
  const classes = new Set();
  const styleProps = {};
  return {
    tagName: '', className: '', textContent: '',
    style: {
      setProperty(k, v){ styleProps[k] = v; },
      getPropertyValue(k){ return styleProps[k]; },
      get backgroundImage(){ return styleProps.backgroundImage; },
      set backgroundImage(v){ styleProps.backgroundImage = v; },
      get height(){ return styleProps.height; },
      set height(v){ styleProps.height = v; },
    },
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      toggle(c, on){ if(on) classes.add(c); else classes.delete(c); },
      contains(c){ return classes.has(c); },
    },
    children: [],
    appendChild(child){ this.children.push(child); return child; },
    setAttribute(k, v){ this['attr_' + k] = v; },
    addEventListener(){},
  };
}
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    el(tag, cls, text){ const e = fakeEl(); e.tagName = tag; if(cls) e.className = cls; if(text !== undefined) e.textContent = text; return e; },
    $(){ return fakeEl(); },
  },
});
mock.module(new URL('../../src/ui/art-color.js', import.meta.url).href, {
  namedExports: {
    loadImageEl: async () => { throw new Error('no real image loading under node:test'); },
    shareDominantColor: () => null,
    spineColor: () => null,
  },
});

const { spineInkIsLight } = await import('../../src/profile/shelf-unit.js');

// cubeSpine() itself isn't exported (an internal leaf of renderShelfUnit()),
// so these drive it the same way real rendering does: build one cube's
// worth of cells via shelfUnitCubes() isn't enough either, since the DOM
// build happens inside renderShelfUnit()'s own shelfCell()/cubeSpine().
// Importing renderShelfUnit() pulls in turntable.js (also el()-only, safe
// under the same mock) for its one call inside the top zone.
const { renderShelfUnit } = await import('../../src/profile/shelf-unit.js');

function findByClass(node, cls, out = []){
  if(node.className && node.className.split(' ').includes(cls)) out.push(node);
  (node.children || []).forEach(c => findByClass(c, cls, out));
  return out;
}

function renderOneSpine(item){
  const unit = renderShelfUnit({
    items: [item], faceOutIds: [], onTapAlbum(){}, model: 'standard',
    turntableInfo: { hasRecord: false }, sleeveArt: null, sleeveName: null, finish: 'walnut', stickers: null,
  });
  return findByClass(unit, 'sp')[0];
}

test('cubeSpine(): an item with art gets a sp-art sliver', () => {
  const sp = renderOneSpine({ id: 'a', name: 'Night Terminal', artist: 'Maria Okafor', art: 'blob:fake', tier: 1 });
  assert.equal(findByClass(sp, 'sp-art').length, 1);
});

test('cubeSpine(): an item with no art gets no sliver at all', () => {
  const sp = renderOneSpine({ id: 'a', name: 'Night Terminal', artist: 'Maria Okafor', art: null, tier: 1 });
  assert.equal(findByClass(sp, 'sp-art').length, 0);
});

test('cubeSpine(): the label carries the artist in its own sp-artist span, then the album', () => {
  const sp = renderOneSpine({ id: 'a', name: 'Harbour Avenue', artist: 'Dj Sola', art: null, tier: 1 });
  const label = findByClass(sp, 'sp-label')[0];
  assert.ok(label, 'expected a sp-label span');
  const artistSpan = findByClass(label, 'sp-artist')[0];
  assert.ok(artistSpan, 'expected a sp-artist span inside the label');
  assert.equal(artistSpan.textContent, 'Dj Sola');
});

test('cubeSpine(): an item with no artist tag shows just the album, no sp-artist span', () => {
  const sp = renderOneSpine({ id: 'a', name: 'Field Recordings', artist: '', art: null, tier: 1 });
  const label = findByClass(sp, 'sp-label')[0];
  assert.equal(findByClass(label, 'sp-artist').length, 0);
});

test('cubeSpine(): a tier-1 (always Jet, dark) spine gets light ink', () => {
  const sp = renderOneSpine({ id: 'a', name: 'Lossy Album', artist: 'Someone', art: null, tier: 1 });
  assert.equal(sp.classList.contains('sp--light-ink'), true);
});

test('spineInkIsLight(): a near-white hex reads as not-light-ink (needs dark text)', () => {
  assert.equal(spineInkIsLight('#E6E2DA'), false);
});

test('spineInkIsLight(): a near-black hex reads as light-ink (needs light text)', () => {
  assert.equal(spineInkIsLight('#1A1716'), true);
});
