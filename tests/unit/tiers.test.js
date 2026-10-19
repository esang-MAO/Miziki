import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trackTier, albumKey, VARIANT_DEFS, OLD_VARIANT_ID_MAP, BAND_NAMES,
  selectVariant, selectRareVariant, resolveVariantId, getVariantDef, variantBackground,
} from '../../src/record-art/tiers.js';

function track(meta){ return { meta, tags: {} }; }
function albumTrack(name, meta){ return { meta, tags: { album: name } }; }

test('trackTier: lossy is tier 1', () => {
  assert.equal(trackTier(track({ lossless: false, bits: 16, rate: 44100 })), 1);
});

test('trackTier: lossless 16-bit/44.1kHz is tier 2', () => {
  assert.equal(trackTier(track({ lossless: true, bits: 16, rate: 44100 })), 2);
});

test('trackTier: lossless 24-bit is tier 3', () => {
  assert.equal(trackTier(track({ lossless: true, bits: 24, rate: 44100 })), 3);
});

test('trackTier: lossless 96kHz is tier 3', () => {
  assert.equal(trackTier(track({ lossless: true, bits: 16, rate: 96000 })), 3);
});

test('trackTier: missing metadata never reaches tier 3', () => {
  assert.equal(trackTier(track({ lossless: true })), 2);
  assert.equal(trackTier(track({})), 1);
  assert.equal(trackTier(track(undefined)), 1);
});

/* ================= CR7: pressings and finishes (docs/13_CRATE.md) ================= */

const SOLID_DEFS = Object.values(VARIANT_DEFS).filter(d => d.family !== 'effects' && d.family !== 'rare' && d.family !== 'jet');
const EFFECT_DEFS = Object.values(VARIANT_DEFS).filter(d => d.family === 'effects');
const RARE_DEFS = Object.values(VARIANT_DEFS).filter(d => d.family === 'rare');

test('CR7 catalogue: every solid/effect has a band, jet and rares do not', () => {
  for(const d of SOLID_DEFS) assert.ok(BAND_NAMES.includes(d.band), d.name + ' missing a band');
  for(const d of EFFECT_DEFS) assert.ok(BAND_NAMES.includes(d.band), d.name + ' missing a band');
  assert.equal(VARIANT_DEFS.jet.band, null);
  for(const d of RARE_DEFS) assert.equal(d.band, null);
});

test('CR7 catalogue: README counts hold (20/14/6 solids, 16/11/5 effects)', () => {
  const countBand = (defs, band) => defs.filter(d => d.band === band).length;
  assert.equal(SOLID_DEFS.length, 40);
  assert.equal(countBand(SOLID_DEFS, 'common'), 20);
  assert.equal(countBand(SOLID_DEFS, 'uncommon'), 14);
  assert.equal(countBand(SOLID_DEFS, 'scarce'), 6);
  assert.equal(EFFECT_DEFS.length, 32);
  assert.equal(countBand(EFFECT_DEFS, 'common'), 16);
  assert.equal(countBand(EFFECT_DEFS, 'uncommon'), 11);
  assert.equal(countBand(EFFECT_DEFS, 'scarce'), 5);
  assert.equal(RARE_DEFS.length, 4);
});

test('CR7 draw: the same album always lands on the same variant', () => {
  const t = albumTrack('Repeat Offender', { lossless: true, bits: 24, rate: 96000 });
  const first = selectVariant(t);
  for(let i=0;i<20;i++) assert.deepEqual(selectVariant(t), first);
  const r1 = selectRareVariant(t);
  for(let i=0;i<20;i++) assert.equal(selectRareVariant(t), r1);
});

test('CR7 draw: band shares converge to 60/30/10 over a large synthetic library', () => {
  const tally = { common: 0, uncommon: 0, scarce: 0 };
  const N = 6000;
  for(let i=0;i<N;i++){
    const t = albumTrack('Synthetic Album ' + i, { lossless: true, bits: 24, rate: 96000 });
    const { variant } = selectVariant(t);
    const def = VARIANT_DEFS[variant];
    if(def.band) tally[def.band]++;
  }
  const total = tally.common + tally.uncommon + tally.scarce;
  assert.ok(total > N * 0.9, 'most hi-res draws should land in a banded pool');
  assert.ok(Math.abs(tally.common / total - 0.6) < 0.04);
  assert.ok(Math.abs(tally.uncommon / total - 0.3) < 0.04);
  assert.ok(Math.abs(tally.scarce / total - 0.1) < 0.03);
});

test('CR7 tier mixes: lossy is always Jet, lossless/hi-res mixes sum to 100', () => {
  const N = 6000;
  // tier 1: always Jet, no draw involved at all
  for(let i=0;i<20;i++){
    const t = albumTrack('Lossy ' + i, { lossless: false, bits: 16, rate: 44100 });
    assert.deepEqual(selectVariant(t), { tier: 1, variant: 'jet' });
  }
  // tier 2: 85% solid / 15% Jet
  let jet2 = 0, solid2 = 0;
  for(let i=0;i<N;i++){
    const t = albumTrack('Lossless ' + i, { lossless: true, bits: 16, rate: 44100 });
    const { tier, variant } = selectVariant(t);
    assert.equal(tier, 2);
    if(variant === 'jet') jet2++; else solid2++;
  }
  assert.ok(Math.abs(jet2 / N - 0.15) < 0.03);
  assert.ok(Math.abs(solid2 / N - 0.85) < 0.03);
  assert.equal(jet2 + solid2, N);
  // tier 3: 70% effect / 25% solid / 5% Jet
  let jet3 = 0, solid3 = 0, effect3 = 0;
  for(let i=0;i<N;i++){
    const t = albumTrack('HiRes ' + i, { lossless: true, bits: 24, rate: 96000 });
    const { tier, variant } = selectVariant(t);
    assert.equal(tier, 3);
    if(variant === 'jet') jet3++;
    else if(VARIANT_DEFS[variant].family === 'effects') effect3++;
    else solid3++;
  }
  assert.ok(Math.abs(jet3 / N - 0.05) < 0.02);
  assert.ok(Math.abs(solid3 / N - 0.25) < 0.03);
  assert.ok(Math.abs(effect3 / N - 0.70) < 0.03);
  assert.equal(jet3 + solid3 + effect3, N);
});

test('CR7 render: every catalogue def produces a non-empty background string', () => {
  for(const id of Object.keys(VARIANT_DEFS)){
    const bg = variantBackground(VARIANT_DEFS[id]);
    assert.ok(typeof bg === 'string' && bg.length > 0, id + ' produced no background');
  }
});

function luminance(hex){
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if(!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test('CR7 render: translucent finishes read lighter in the body than the rim', () => {
  const translucent = [...SOLID_DEFS, ...EFFECT_DEFS].filter(d => d.finish === 'translucent');
  assert.ok(translucent.length > 0);
  for(const d of translucent){
    const [, body, rim] = d.colors;
    const lb = luminance(body), lr = luminance(rim);
    if(lb === null || lr === null) continue; // a rim built from color-mix()/an ink array, not a flat hex
    assert.ok(lb > lr, d.name + ': body should read lighter than its rim');
  }
});

test('CR7 migration: every old id resolves to a valid, current catalogue entry', () => {
  const oldIds = Object.keys(OLD_VARIANT_ID_MAP);
  assert.equal(oldIds.length, 12);
  for(const oldId of oldIds){
    const resolved = resolveVariantId(oldId);
    assert.ok(VARIANT_DEFS[resolved], oldId + ' -> ' + resolved + ' is not a real def');
    assert.equal(getVariantDef(oldId), VARIANT_DEFS[resolved]);
  }
  // a truly unrecognized id never throws, and falls back to Jet
  assert.equal(resolveVariantId('totally-made-up-id'), 'jet');
  assert.equal(getVariantDef('totally-made-up-id'), VARIANT_DEFS.jet);
});

test('CR7: albumKey-based hashing is untouched by the catalogue rewrite', () => {
  const a = albumTrack('Same Album', { lossless: true, bits: 24, rate: 96000 });
  const b = albumTrack('Same Album', { lossless: true, bits: 24, rate: 96000 });
  assert.equal(albumKey(a), albumKey(b));
  assert.deepEqual(selectVariant(a), selectVariant(b));
});
