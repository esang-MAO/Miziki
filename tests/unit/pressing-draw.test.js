import { test } from 'node:test';
import assert from 'node:assert/strict';

// PRESSING_DRAW (docs/31_PRESSINGS_AND_LOOKS.md, PR A): before this PR,
// frac32() appended the salt to the end of the key, and FNV-1a's last step
// (`(h ^ c) * 16777619`) barely moves when only the final character
// changes -- so the five draws (tier mix, band, colour, rare, zoetrope)
// came out nearly identical, and over half the chart could never turn up.
// This is the test that would have caught that bug: every pressing in
// every pool must be reachable, over a large, fixed (never Math.random())
// sample of synthetic album names.
const {
  selectVariantForAlbum, selectRareVariant, selectZoetropeVariant,
  SOLID_IDS, EFFECT_IDS, RARE_IDS, ZOETROPE_IDS, VARIANT_DEFS, albumKey,
} = await import('../../src/record-art/tiers.js');

const N = 50000;
const NAMES = Array.from({ length: N }, (_, i) => 'album ' + i);

function fakeTrack(name){ return { tags: { album: name } }; }

test('pressing draw: every solid is reachable at tier 2', () => {
  const seen = new Set();
  for(const name of NAMES){
    const { variant } = selectVariantForAlbum('Fixed Artist', name, 2);
    seen.add(variant);
  }
  const missing = SOLID_IDS.filter(id => !seen.has(id));
  assert.deepEqual(missing, [], `never drawn at tier 2: ${missing.join(', ')}`);
});

test('pressing draw: every effect is reachable at tier 3', () => {
  const seen = new Set();
  for(const name of NAMES){
    const { variant } = selectVariantForAlbum('Fixed Artist', name, 3);
    seen.add(variant);
  }
  const missing = EFFECT_IDS.filter(id => !seen.has(id));
  assert.deepEqual(missing, [], `never drawn at tier 3: ${missing.join(', ')}`);
});

test('pressing draw: every rare is reachable', () => {
  const seen = new Set();
  for(const name of NAMES) seen.add(selectRareVariant(fakeTrack(name)));
  const missing = RARE_IDS.filter(id => !seen.has(id));
  assert.deepEqual(missing, [], `never drawn as rare: ${missing.join(', ')}`);
});

test('pressing draw: every zoetrope is reachable', () => {
  const seen = new Set();
  for(const name of NAMES) seen.add(selectZoetropeVariant(fakeTrack(name)));
  const missing = ZOETROPE_IDS.filter(id => !seen.has(id));
  assert.deepEqual(missing, [], `never drawn as zoetrope: ${missing.join(', ')}`);
});

function withinTolerance(actual, expected, tolerancePct){
  assert.ok(Math.abs(actual - expected) <= tolerancePct,
    `expected ~${(expected * 100).toFixed(1)}%, got ${(actual * 100).toFixed(1)}%`);
}

test('pressing draw: tier-2 mix is ~15% Jet / 85% solid', () => {
  let jet = 0;
  for(const name of NAMES){
    if(selectVariantForAlbum('Fixed Artist', name, 2).variant === 'jet') jet++;
  }
  withinTolerance(jet / N, 0.15, 0.02);
});

test('pressing draw: tier-3 mix is ~5% Jet / 40% solid / 55% effect', () => {
  let jet = 0, solid = 0, effect = 0;
  for(const name of NAMES){
    const { variant } = selectVariantForAlbum('Fixed Artist', name, 3);
    if(variant === 'jet') jet++;
    else if(SOLID_IDS.includes(variant)) solid++;
    else effect++;
  }
  withinTolerance(jet / N, 0.05, 0.02);
  withinTolerance(solid / N, 0.40, 0.02);
  withinTolerance(effect / N, 0.55, 0.02);
});

test('pressing draw: among non-Jet tier-2 draws, bands split ~50/35/15', () => {
  const counts = { common: 0, uncommon: 0, scarce: 0 };
  let total = 0;
  for(const name of NAMES){
    const { variant } = selectVariantForAlbum('Fixed Artist', name, 2);
    if(variant === 'jet') continue;
    counts[VARIANT_DEFS[variant].band]++;
    total++;
  }
  withinTolerance(counts.common / total, 0.50, 0.02);
  withinTolerance(counts.uncommon / total, 0.35, 0.02);
  withinTolerance(counts.scarce / total, 0.15, 0.02);
});

test('pressing draw: band and colour draws are independent -- the whole common list is reachable, not a slice of it', () => {
  const commonIds = SOLID_IDS.filter(id => VARIANT_DEFS[id].band === 'common');
  const firstCommon = commonIds[0];
  const lastCommon = commonIds[commonIds.length - 1];
  let firstCount = 0, lastCount = 0, commonTotal = 0;
  for(const name of NAMES){
    const { variant } = selectVariantForAlbum('Fixed Artist', name, 2);
    if(VARIANT_DEFS[variant] && VARIANT_DEFS[variant].band === 'common'){
      commonTotal++;
      if(variant === firstCommon) firstCount++;
      if(variant === lastCommon) lastCount++;
    }
  }
  // per 1,000 common draws, at least one hit each -- comfortably covered
  // by a 50,000-name sample unless the band and colour draws are still
  // correlated the old, broken way.
  assert.ok(firstCount >= commonTotal / 1000, `first common colour (${firstCommon}) barely reachable: ${firstCount}/${commonTotal}`);
  assert.ok(lastCount >= commonTotal / 1000, `last common colour (${lastCommon}) barely reachable: ${lastCount}/${commonTotal}`);
});

test('pressing draw: deterministic -- the same album name draws the same variant every time', () => {
  for(const name of ['Repeat Me', 'Another Album', 'Zzz']){
    const a = selectVariantForAlbum('Fixed Artist', name, 3);
    const b = selectVariantForAlbum('Fixed Artist', name, 3);
    assert.deepEqual(a, b);
  }
});

test('pressing draw: two keys that normalize the same way draw the same variant', () => {
  const a = selectVariantForAlbum('  The Artist  ', '  The Album  ', 3);
  const b = selectVariantForAlbum('the artist', 'the album', 3);
  assert.deepEqual(a, b);
  assert.equal(albumKey({ tags: { album: '  The Album  ' } }), albumKey({ tags: { album: 'the album' } }));
});
