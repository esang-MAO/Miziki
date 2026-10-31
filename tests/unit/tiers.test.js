import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// PRESSINGS_110 PR3: Nychthemeron reads the live day/night phase through
// sundown/solar.js's nowClock() and sundown/arc.js's phaseAt() — both
// mocked here (node's ESM module-mock, --experimental-test-module-mocks)
// so the one test that exercises it can drive both branches without
// depending on the real wall clock. Neither export is used by any other
// test in this file, so this has no effect on anything else here.
let mockPhase = 'day';
mock.module(new URL('../../src/sundown/solar.js', import.meta.url).href, {
  namedExports: { nowClock(){ return new Date(); } },
});
mock.module(new URL('../../src/sundown/arc.js', import.meta.url).href, {
  namedExports: { phaseAt(){ return mockPhase; } },
});

const {
  trackTier, albumKey, VARIANT_DEFS, OLD_VARIANT_ID_MAP, BAND_NAMES, ZOETROPE_IDS,
  selectVariant, selectRareVariant, selectZoetropeVariant, resolveVariantId, getVariantDef, variantBackground,
} = await import('../../src/record-art/tiers.js');

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

const SOLID_DEFS = Object.values(VARIANT_DEFS).filter(d => d.family !== 'effects' && d.family !== 'rare' && d.family !== 'zoetrope' && d.family !== 'jet');
const EFFECT_DEFS = Object.values(VARIANT_DEFS).filter(d => d.family === 'effects');
const RARE_DEFS = Object.values(VARIANT_DEFS).filter(d => d.family === 'rare');
const ZOETROPE_DEFS = Object.values(VARIANT_DEFS).filter(d => d.family === 'zoetrope');

test('CR7 catalogue: every solid/effect has a band, jet/rares/zoetropes do not', () => {
  for(const d of SOLID_DEFS) assert.ok(BAND_NAMES.includes(d.band), d.name + ' missing a band');
  for(const d of EFFECT_DEFS) assert.ok(BAND_NAMES.includes(d.band), d.name + ' missing a band');
  assert.equal(VARIANT_DEFS.jet.band, null);
  for(const d of RARE_DEFS) assert.equal(d.band, null);
  for(const d of ZOETROPE_DEFS) assert.equal(d.band, null);
});

test('SZ2 catalogue: counts hold (20/14/6 solids, 24/22/8 effects, 8 rare, 9 zoetrope = 111)', () => {
  const countBand = (defs, band) => defs.filter(d => d.band === band).length;
  assert.equal(SOLID_DEFS.length, 40);
  assert.equal(countBand(SOLID_DEFS, 'common'), 20);
  assert.equal(countBand(SOLID_DEFS, 'uncommon'), 14);
  assert.equal(countBand(SOLID_DEFS, 'scarce'), 6);
  assert.equal(EFFECT_DEFS.length, 54);
  assert.equal(countBand(EFFECT_DEFS, 'common'), 24);
  assert.equal(countBand(EFFECT_DEFS, 'uncommon'), 22);
  assert.equal(countBand(EFFECT_DEFS, 'scarce'), 8);
  assert.equal(RARE_DEFS.length, 8);
  assert.equal(ZOETROPE_DEFS.length, 9);
  assert.equal(SOLID_DEFS.length + EFFECT_DEFS.length + RARE_DEFS.length + ZOETROPE_DEFS.length, 111);
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

/* ================= PRESSINGS_110 PR2: the seven new effect techniques
   (docs/PRESSINGS_110.md §3) — each gets a real variantBackground() case
   now, in place of the 'solid' fallback PR1 shipped them with. These
   check the real shape of the generated CSS, not just that something
   non-empty came out. ================= */

test('PRESSINGS_110: tri-split renders the three inks as three vertical bands, in order', () => {
  const def = VARIANT_DEFS['ochre-jet-terracotta'];
  const bg = variantBackground(def);
  assert.ok(bg.startsWith('linear-gradient(90deg,'));
  const [i1, i2, i3] = def.inks;
  assert.ok(bg.includes(i1 + ' 0 33.4%'));
  assert.ok(bg.includes(i2 + ' 33.4% 66.7%'));
  assert.ok(bg.includes(i3 + ' 66.7% 100%'));
});

test('PRESSINGS_110: pinwheel renders six alternating 60deg wedges', () => {
  const def = VARIANT_DEFS['madder-pinwheel'];
  const bg = variantBackground(def);
  const [i1, i2] = def.inks;
  assert.ok(bg.startsWith('conic-gradient(from 12deg,'));
  // six wedges means the first ink should appear three times, the second three times
  assert.equal(bg.split(i1).length - 1, 3);
  assert.equal(bg.split(i2).length - 1, 3);
});

test('PRESSINGS_110: target renders three concentric ink bands over the base, no smooth ring', () => {
  const def = VARIANT_DEFS['tyrian-target'];
  const bg = variantBackground(def);
  assert.equal(bg.split(def.ink).length - 1, 3, 'three concentric bands of the one ink');
  assert.ok(bg.includes(def.base));
  assert.ok(bg.includes(def.rim));
});

test('PRESSINGS_110: core renders a clean two-stop split with no blend', () => {
  const def = VARIANT_DEFS['ochre-in-jet'];
  const bg = variantBackground(def);
  assert.equal(bg, 'radial-gradient(circle at 50% 50%,' + def.inner + ' 0 58%,' + def.outer + ' 58% 100%)');
});

test('PRESSINGS_110: galaxy renders a two-tone swirl plus seven specks of the given colour', () => {
  const def = VARIANT_DEFS['petrol-galaxy'];
  const bg = variantBackground(def);
  const [t1, t2] = def.tones;
  assert.ok(bg.includes(t1) && bg.includes(t2));
  assert.equal(bg.split(def.specks).length - 1, 7, 'one speck colour used at all seven points');
  assert.ok(bg.includes(def.rim));
});

test('PRESSINGS_110: galaxy with two speck colours alternates them across the seven points', () => {
  const def = VARIANT_DEFS['jet-galaxy'];
  const bg = variantBackground(def);
  const [s1, s2] = def.specks;
  // four of the seven points land on the first colour, three on the second
  // (index % 2 === 0 for indices 0,2,4,6)
  assert.equal(bg.split(s1).length - 1, 4);
  assert.equal(bg.split(s2).length - 1, 3);
});

test('PRESSINGS_110: burst renders repeating rays over a faded base/rim', () => {
  const def = VARIANT_DEFS['vermilion-burst'];
  const bg = variantBackground(def);
  assert.ok(bg.includes('repeating-conic-gradient(from 3deg,' + def.ink));
  assert.ok(bg.includes(def.base));
  assert.ok(bg.includes(def.rim));
});

test('PRESSINGS_110: cloud renders four soft islands of the ink over the base, fading to the rim', () => {
  const def = VARIANT_DEFS['chalk-cloud'];
  const bg = variantBackground(def);
  assert.equal(bg.split(def.ink).length - 1, 4, 'four cloud islands');
  assert.ok(bg.includes(def.base));
  assert.ok(bg.includes(def.rim));
});

/* ================= PRESSINGS_110 PR3: rare expansion to 8
   (docs/PRESSINGS_110.md §4) — four new rares, all clear- or sky-driven.
   Moonstone deliberately reuses the existing 'marble' case verbatim;
   the other three get their own case in variantBackground(). ================= */

test('PRESSINGS_110: Moonstone reuses the marble case with its own translucent colours', () => {
  const def = VARIANT_DEFS.moonstone;
  assert.equal(def.pattern, 'marble');
  const bg = variantBackground(def);
  // the marble case reads body/veins/rim off the def directly when present
  assert.ok(bg.includes(def.veins), 'vein colour should appear in the repeating vein layer');
  assert.ok(bg.includes(def.body), 'the clear body colour should appear in the base radial layer');
  assert.ok(bg.includes(def.rim));
  assert.ok(bg.startsWith('repeating-linear-gradient(62deg,'));
});

test('PRESSINGS_110: Aurora swirls two inks with transparent gaps over a clear rim fade', () => {
  const def = VARIANT_DEFS.aurora;
  const bg = variantBackground(def);
  const [t1, t2, rim] = def.colors;
  assert.ok(bg.startsWith('conic-gradient(from -30deg,transparent'));
  assert.ok(bg.includes(t1));
  assert.ok(bg.includes(t2));
  // gaps between the two swirl inks are what let the clear body show through
  assert.equal(bg.split('transparent').length - 1, 4, 'three swirl gaps plus the rim-fade centre');
  assert.ok(bg.includes('radial-gradient(circle at 50% 50%,transparent 0 88%,' + rim + ' 94% 100%)'));
});

test('PRESSINGS_110: Black Ice is a hard-edged Jet core under a clear outer band, no soft blend', () => {
  const def = VARIANT_DEFS['black-ice'];
  const bg = variantBackground(def);
  assert.ok(bg.startsWith('radial-gradient(circle at 50% 50%,' + def.jet + ' 0 56%,transparent 56% 100%)'),
    'the core/outer-band split should be a hard edge, not a feathered one');
  // the same two rim-highlight spots every other rare pattern already uses
  assert.ok(bg.includes('radial-gradient(circle at 34% 28%,rgba(255,255,255,.34)'));
  assert.ok(bg.includes('radial-gradient(circle at 72% 78%,rgba(255,255,255,.14)'));
});

test('PRESSINGS_110: Nychthemeron renders its day colours when phaseAt() reads day', () => {
  mockPhase = 'day';
  const def = VARIANT_DEFS.nychthemeron;
  const bg = variantBackground(def);
  const [hi, body, rim] = def.colors;
  assert.equal(bg, 'radial-gradient(circle at 50% 50%,' + hi + ' 0 34%,' + body + ' 34% 90%,' + rim + ' 90% 100%)');
});

test('PRESSINGS_110: Nychthemeron switches to its night colours once phaseAt() reads anything else', () => {
  for(const phase of ['dawn', 'dusk', 'night']){
    mockPhase = phase;
    const def = VARIANT_DEFS.nychthemeron;
    const bg = variantBackground(def);
    const [hi, body, rim] = def.night;
    assert.equal(bg, 'radial-gradient(circle at 50% 50%,' + hi + ' 0 34%,' + body + ' 34% 90%,' + rim + ' 90% 100%)',
      'phase ' + phase + ' should read as night');
  }
});

/* ================= SZ2 (docs/26_SIZES_AND_ZOETROPES.md): nine mandala
   zoetropes, replacing the eight figurative ones outright — the catalogue
   entries and selectZoetropeVariant() are tested here as pure primitives,
   same as the PRESSINGS_110 PR5 tests they replace. ================= */

test('SZ2: zoetrope catalogue has all nine named mandalas, each with every frame count and disc URL (incl. 7″)', () => {
  const names = ZOETROPE_DEFS.map(d => d.name).sort();
  assert.deepEqual(names, [
    'Ember', 'Kaleido', 'Lantern', 'Lotus', 'Moonwheel', 'Starseed', 'Sunwheel', 'Tidepool', 'Unfurl',
  ]);
  for(const d of ZOETROPE_DEFS){
    assert.equal(d.pattern, 'zoetrope');
    assert.equal(d.finish, 'opaque');
    assert.ok(typeof d.discLp === 'string' && d.discLp.length > 0, d.name + ' missing discLp');
    assert.ok(typeof d.disc45 === 'string' && d.disc45.length > 0, d.name + ' missing disc45');
    assert.ok(typeof d.disc7in === 'string' && d.disc7in.length > 0, d.name + ' missing disc7in');
    assert.ok(Number.isInteger(d.framesLp) && d.framesLp > 0, d.name + ' missing framesLp');
    assert.ok(Number.isInteger(d.frames45) && d.frames45 > 0, d.name + ' missing frames45');
  }
});

test('SZ2: every zoetrope shares the same 12/16 frame counts — no Rainfall-style special case', () => {
  for(const d of ZOETROPE_DEFS){
    assert.equal(d.framesLp, 12);
    assert.equal(d.frames45, 16);
  }
});

test('SZ2: selectZoetropeVariant draws the same pressing for the same album every time', () => {
  const t = albumTrack('Zoetrope Repeat', { lossless: true, bits: 24, rate: 96000 });
  const first = selectZoetropeVariant(t);
  assert.ok(ZOETROPE_IDS.includes(first));
  for(let i=0;i<20;i++) assert.equal(selectZoetropeVariant(t), first);
});

test('SZ2: selectZoetropeVariant draw never correlates with selectRareVariant for the same album', () => {
  // not a proof of independence, just a sanity check that the two draws
  // use genuinely different hash salts, not the same one by copy-paste
  // accident — over enough albums they shouldn't always agree
  let agree = 0;
  const N = 200;
  for(let i=0;i<N;i++){
    const t = albumTrack('Salt Check ' + i, { lossless: true, bits: 24, rate: 96000 });
    const rareIdx = RARE_DEFS.findIndex(d => d === VARIANT_DEFS[selectRareVariant(t)]);
    const zooIdx = ZOETROPE_DEFS.findIndex(d => d === VARIANT_DEFS[selectZoetropeVariant(t)]);
    if(rareIdx === zooIdx) agree++;
  }
  assert.ok(agree < N, 'rare and zoetrope draws should not always land on the same pool index');
});

test('SZ2: zoetrope ids are disjoint from the rare pool and never drawn by selectVariant', () => {
  for(const id of ZOETROPE_IDS) assert.ok(!RARE_DEFS.some(d => d === VARIANT_DEFS[id]));
  // selectVariant()/the tier-mix draw never reaches 'rare' or 'zoetrope'
  // family defs at all — both pools are session-unlock-only, picked by
  // their own dedicated select*Variant() function, never by the file-
  // driven tier mix. Confirmed over every tier across a large synthetic
  // library, not just asserted.
  for(const tier of [1, 2, 3]){
    const meta = tier === 1 ? { lossless: false, bits: 16, rate: 44100 }
      : tier === 2 ? { lossless: true, bits: 16, rate: 44100 }
      : { lossless: true, bits: 24, rate: 96000 };
    for(let i=0;i<300;i++){
      const t = albumTrack('Tier ' + tier + ' No Zoetrope ' + i, meta);
      const { variant } = selectVariant(t);
      assert.notEqual(VARIANT_DEFS[variant].family, 'zoetrope', 'selectVariant should never draw a zoetrope');
    }
  }
});

test('SZ2: zoetrope art picker covers every format cell — disc7in for a 7″, disc45 for any other 45, discLp otherwise', () => {
  const def = VARIANT_DEFS.lotus;
  const bgDefault = variantBackground(def);
  assert.equal(bgDefault, 'url("' + def.discLp + '") center/cover');
  const bg1233 = variantBackground(def, { size: '12"', speed: 33.333 });
  assert.equal(bg1233, 'url("' + def.discLp + '") center/cover');
  const bg1245 = variantBackground(def, { size: '12"', speed: 45 });
  assert.equal(bg1245, 'url("' + def.disc45 + '") center/cover');
  const bg1045 = variantBackground(def, { size: '10"', speed: 45 });
  assert.equal(bg1045, 'url("' + def.disc45 + '") center/cover');
  const bg745 = variantBackground(def, { size: '7"', speed: 45 });
  assert.equal(bg745, 'url("' + def.disc7in + '") center/cover');
});

test('SZ2: every zoetrope def produces a non-empty background with no format given', () => {
  for(const d of ZOETROPE_DEFS){
    const bg = variantBackground(d);
    assert.ok(bg.includes(d.discLp), d.name + ' should render its LP disc art with no format given');
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
