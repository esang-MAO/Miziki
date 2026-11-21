import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/ui/house-sleeve.js's own module-load-time code touches no DOM, and
// the pure functions this file tests (houseSleeveKind/plainSleeveKind)
// never call into its DOM-building functions -- but it still statically
// imports ui/wordmark.js and ui/sleeve-fermata.js, and each of those has
// its own top-level `?raw` SVG asset import, a Vite-only feature node:test
// can't resolve at all. Mocked away here, same reasoning share.test.js/
// launch.test.js already give for every other `?raw`-importing module --
// nothing in this file ever calls buildHouseSleeve(), so what these two
// mocks return doesn't matter.
mock.module(new URL('../../src/ui/wordmark.js', import.meta.url).href, {
  namedExports: { wordmarkEl(){ return {}; }, wordmarkMarkup(){ return '<svg></svg>'; } },
});
mock.module(new URL('../../src/ui/sleeve-fermata.js', import.meta.url).href, {
  namedExports: { sleeveFermataEl(){ return {}; }, sleeveFermataGroupEl(){ return {}; } },
});
const { houseSleeveKind, plainSleeveKind } = await import('../../src/ui/house-sleeve.js');
const { VARIANT_DEFS } = await import('../../src/record-art/tiers.js');

// a plain `'Artist ' + i`/`'Album ' + i` series shares too much of its
// prefix for hash32's own avalanche (the same weakness record-art/tiers.js's
// own fmix32() comment describes for a trailing-byte-only key change), so a
// synthetic album name here is seeded instead -- deterministic (same run,
// same numbers, every time) but with enough spread per album to actually
// exercise the hash the way 1,000 real, distinct album names would.
function mulberry32(seed){
  let a = seed;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function syntheticAlbumName(rand){ return Math.floor(rand() * 1e9).toString(36); }

test('houseSleeveKind: deterministic for the same artist and album', () => {
  const a = houseSleeveKind('Boards of Canada', 'Geogaddi');
  const b = houseSleeveKind('Boards of Canada', 'Geogaddi');
  assert.equal(a, b);
});

test('houseSleeveKind: ignores case and whitespace like normKey', () => {
  const a = houseSleeveKind('Boards of Canada', 'Geogaddi');
  const b = houseSleeveKind('  BOARDS   OF    canada  ', '  geogaddi  ');
  assert.equal(a, b);
});

test('houseSleeveKind: different albums can draw different kinds', () => {
  const rand = mulberry32(2);
  const kinds = new Set();
  for(let i = 0; i < 200; i++) kinds.add(houseSleeveKind('Artist ' + syntheticAlbumName(rand), 'Album ' + syntheticAlbumName(rand)));
  // over 200 draws across a 10-slot, 4-kind table, every kind should turn up
  assert.ok(kinds.size === 4, 'expected all four kinds to appear, got ' + [...kinds].join(','));
});

test('houseSleeveKind: lands near the documented 30/30/20/20 split over 1000 synthetic albums', () => {
  const rand = mulberry32(1);
  const counts = { wordmark: 0, emboss: 0, house: 0, diecut: 0 };
  for(let i = 0; i < 1000; i++){
    const kind = houseSleeveKind('Artist ' + syntheticAlbumName(rand), 'Album ' + syntheticAlbumName(rand));
    counts[kind]++;
  }
  // generous tolerance -- this is a hash distribution check, not an exact-draw test
  assert.ok(Math.abs(counts.wordmark - 300) < 60, 'wordmark: ' + counts.wordmark);
  assert.ok(Math.abs(counts.emboss - 300) < 60, 'emboss: ' + counts.emboss);
  assert.ok(Math.abs(counts.house - 200) < 60, 'house: ' + counts.house);
  assert.ok(Math.abs(counts.diecut - 200) < 60, 'diecut: ' + counts.diecut);
});

test('houseSleeveKind: die-cut falls back to house for an ochre-family pressing', () => {
  // find an artist/album pair that would otherwise draw 'diecut' with no pressingDef...
  const rand = mulberry32(3);
  let pair = null;
  for(let i = 0; i < 2000; i++){
    const artist = 'Artist ' + syntheticAlbumName(rand), album = 'Album ' + syntheticAlbumName(rand);
    if(houseSleeveKind(artist, album) === 'diecut'){ pair = { artist, album }; break; }
  }
  assert.ok(pair != null, 'expected at least one diecut draw in 2000 tries');
  // ...then the same draw, with an ochre-family pressing def, falls back to house
  const ochrePressing = VARIANT_DEFS.ochre;
  const kind = houseSleeveKind(pair.artist, pair.album, ochrePressing);
  assert.equal(kind, 'house');
});

test('houseSleeveKind: a pressing with plenty of contrast against ochre keeps its diecut draw', () => {
  const rand = mulberry32(3);
  let pair = null;
  for(let i = 0; i < 2000; i++){
    const artist = 'Artist ' + syntheticAlbumName(rand), album = 'Album ' + syntheticAlbumName(rand);
    if(houseSleeveKind(artist, album) === 'diecut'){ pair = { artist, album }; break; }
  }
  assert.ok(pair != null, 'expected at least one diecut draw in 2000 tries');
  const bluePressing = VARIANT_DEFS.prussian;
  const kind = houseSleeveKind(pair.artist, pair.album, bluePressing);
  assert.equal(kind, 'diecut');
});

test('plainSleeveKind: cycles all four kinds in a fixed order', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map(plainSleeveKind),
    ['wordmark', 'house', 'emboss', 'diecut'],
  );
  // and repeats
  assert.equal(plainSleeveKind(4), plainSleeveKind(0));
  assert.equal(plainSleeveKind(5), plainSleeveKind(1));
});

test('plainSleeveKind: handles negative indices the same cyclic way', () => {
  assert.equal(plainSleeveKind(-1), plainSleeveKind(3));
});
