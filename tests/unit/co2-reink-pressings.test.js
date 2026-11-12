import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VARIANT_DEFS, CHART_VERSION, selectVariantForAlbum } from '../../src/record-art/tiers.js';
import { WADA } from '../../src/ui/palette-ref.js';

// CO2 (docs/37_COLOUR.md, recommendation 2): re-ink each pressing's white
// partner to a Wada pale. Keys, bands, patterns, rims and solids are
// untouched; only the pale ink, `colors`, name and note change.

const RE_INKED = {
  'prussian-bone': { pale: '#F5F5B8', wada: 'Sulphur Yellow' },
  'oxblood-split': { pale: '#EBD999', wada: 'Ivory Buff' },
  'tyrian-split': { pale: '#FFCFC4', wada: 'Seashell Pink' },
  'grape-chalk': { pale: '#BFFFE6', wada: 'Nile Blue' },
  'pine-split': { pale: '#EBD999', wada: 'Ivory Buff' },
  'rose-split': { pale: '#B5D1CC', wada: 'Neutral Gray' },
  'madder-pinwheel': { pale: '#EBD999', wada: 'Ivory Buff' },
  'teal-pinwheel': { pale: '#FFF59E', wada: 'Pale Lemon Yellow' },
  'grape-pinwheel': { pale: '#BFFFE6', wada: 'Nile Blue' },
  'sienna-pinwheel': { pale: '#FFF59E', wada: 'Pale Lemon Yellow' },
};
const RE_INKED_MIDDLE = {
  'vermilion-chalk-pine': { pale: '#BFFFE6', wada: 'Nile Blue' },
  'cobalt-bone-madder': { pale: '#F5F5B8', wada: 'Sulphur Yellow' },
};
const ALL_KEYS = { ...RE_INKED, ...RE_INKED_MIDDLE };

const OLD_KEYS = [
  'prussian-bone', 'oxblood-split', 'tyrian-split', 'grape-chalk', 'pine-split',
  'rose-split', 'madder-pinwheel', 'teal-pinwheel', 'grape-pinwheel', 'sienna-pinwheel',
  'vermilion-chalk-pine', 'cobalt-bone-madder', 'jet-bone', 'mauve-measles', 'soot',
];

test('CO2: every old pressing key still exists', () => {
  for (const key of OLD_KEYS) {
    assert.ok(VARIANT_DEFS[key], `missing key: ${key}`);
  }
});

test('CO2: CHART_VERSION is unchanged by the re-ink', () => {
  assert.equal(CHART_VERSION, 4);
});

test('CO2: every re-inked pale equals its WADA hex in palette-ref.js', () => {
  const byName = new Map(WADA.map((c) => [c.name, c.hex]));
  for (const [key, { pale, wada }] of Object.entries(ALL_KEYS)) {
    assert.equal(byName.get(wada)?.toLowerCase(), pale.toLowerCase(), `${key}: ${wada} mismatch`);
  }
});

test('CO2: two-ink pressings carry the new pale in inks[1] and colors[1]', () => {
  for (const [key, { pale }] of Object.entries(RE_INKED)) {
    const def = VARIANT_DEFS[key];
    assert.equal(def.inks[1].toUpperCase(), pale.toUpperCase(), `${key} inks[1]`);
    if (def.pattern !== 'pinwheel') {
      assert.equal(def.colors[1].toUpperCase(), pale.toUpperCase(), `${key} colors[1]`);
    }
  }
});

test('CO2: tri-split pressings carry the new pale as the middle ink', () => {
  for (const [key, { pale }] of Object.entries(RE_INKED_MIDDLE)) {
    const def = VARIANT_DEFS[key];
    assert.equal(def.inks[1].toUpperCase(), pale.toUpperCase(), `${key} inks[1]`);
    assert.equal(def.colors[1].toUpperCase(), pale.toUpperCase(), `${key} colors[1]`);
  }
});

test("CO2: Jet & Bone, Mauve Measles and Soot are untouched (kept as they are)", () => {
  assert.equal(VARIANT_DEFS['jet-bone'].inks[1], '#DED7C7');
  assert.equal(VARIANT_DEFS['mauve-measles'].base, '#DCCDB0');
  assert.equal(VARIANT_DEFS.soot.base, '#E6E2DA');
});

test('CO2: solids are not touched', () => {
  assert.equal(VARIANT_DEFS.chalk.colors[1], '#E6E2DA');
  assert.equal(VARIANT_DEFS.isabelline.colors[1], '#DCCDB0');
  assert.equal(VARIANT_DEFS.bone.colors[1], '#DED7C7');
});

test('CO2: a snapshot of the variant drawn for 20 fixed album ids is unchanged', () => {
  // Draw stability only — re-inking a pressing's colours must never move
  // which key an album draws (CHART_VERSION stays 4, the hash input is
  // unchanged). The 20 ids below are illustrative, fixed synthetic names.
  const snapshot = [];
  for (let i = 0; i < 20; i++) {
    const { variant } = selectVariantForAlbum('Fixed Artist', `album ${i}`, 3);
    snapshot.push(variant);
  }
  assert.deepEqual(snapshot, [
    'ultramarine-verdigris', 'indigo-galaxy', 'pine-split', 'turquoise', 'olive',
    'sodalite', 'tyrian-burst', 'mauve', 'malachite', 'isabelline',
    'blush', 'viridian-ochre', 'indigo', 'jet', 'viridian',
    'madder', 'isabelline', 'verdigris', 'prussian', 'ochre-in-jet',
  ], 'tier-3 draw for fixed album ids moved — CO2 must not change which key is drawn');
});
