import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPHIC_BANDS_HZ, GRAPHIC_BAND_MAX_DB, TILT_MAX_DB, MAX_PARAMETRIC_BANDS,
  PARAMETRIC_BAND_MAX_DB, PREAMP_MIN_DB, PREAMP_MAX_DB, EQ_PRESETS, EQ_PRESET_KEYS,
  clamp, clampTiltDb, clampGraphicBandDb, clampParametricGainDb, clampPreampDb,
  clampFreqHz, clampQ, autoPreampDbFromPeak, combineDbCurve, sampleFrequenciesLog,
  matchPreset, sanitizeParametricBand, sanitizeParametricBands,
  defaultEqState,
} from '../../src/audio/eq.js';

test('clamp helpers hold every value inside their own stated range', () => {
  assert.equal(clampTiltDb(100), TILT_MAX_DB);
  assert.equal(clampTiltDb(-100), -TILT_MAX_DB);
  assert.equal(clampTiltDb(3), 3);
  assert.equal(clampGraphicBandDb(100), GRAPHIC_BAND_MAX_DB);
  assert.equal(clampGraphicBandDb(-100), -GRAPHIC_BAND_MAX_DB);
  assert.equal(clampParametricGainDb(100), PARAMETRIC_BAND_MAX_DB);
  assert.equal(clampPreampDb(100), PREAMP_MAX_DB);
  assert.equal(clampPreampDb(-100), PREAMP_MIN_DB);
  assert.equal(clampFreqHz(5), 20);
  assert.equal(clampFreqHz(99999), 20000);
  assert.equal(clampQ(0), 0.1);
  assert.equal(clampQ(999), 18);
  // a non-finite/garbage input never escapes as NaN/Infinity — it reads as
  // the range's own low end, same "bad input, leave something safe" shape
  // every other defensive check in this codebase already uses.
  assert.equal(clamp(NaN, -1, 1), -1);
  assert.equal(clamp(undefined, -1, 1), -1);
  assert.equal(clamp('x', -1, 1), -1);
});

test('autoPreampDbFromPeak: lowers the preamp by exactly the curve\'s own peak, never raises it', () => {
  assert.equal(autoPreampDbFromPeak(4), -4);
  assert.equal(autoPreampDbFromPeak(0), 0);
  // a curve that never rises above 0dB (all cuts) needs no attenuation —
  // the doc's own "when the combined curve rises above 0dB anywhere" gate.
  assert.equal(autoPreampDbFromPeak(-6), 0);
  assert.equal(autoPreampDbFromPeak(NaN), 0);
});

test('combineDbCurve: filters in series sum their dB curves point by point', () => {
  const a = [1, 2, 3];
  const b = [10, -5, 0];
  assert.deepEqual(combineDbCurve([a, b]), [11, -3, 3]);
  assert.deepEqual(combineDbCurve([]), []);
  assert.deepEqual(combineDbCurve([a]), a);
});

test('sampleFrequenciesLog: endpoints match, strictly increasing, log-spaced', () => {
  const freqs = sampleFrequenciesLog(10, 20, 20000);
  assert.equal(freqs.length, 10);
  assert.ok(Math.abs(freqs[0] - 20) < 1e-6);
  assert.ok(Math.abs(freqs[freqs.length - 1] - 20000) < 1e-6);
  for(let i = 1; i < freqs.length; i++) assert.ok(freqs[i] > freqs[i-1]);
  // log-spaced: the ratio between consecutive points is constant, not the
  // (much larger near the top) linear difference.
  const ratio = freqs[1] / freqs[0];
  for(let i = 2; i < freqs.length; i++){
    assert.ok(Math.abs(freqs[i] / freqs[i-1] - ratio) < 1e-6);
  }
});

test('matchPreset: every built-in preset matches its own definition exactly', () => {
  for(const key of EQ_PRESET_KEYS){
    const preset = EQ_PRESETS[key];
    assert.equal(matchPreset(preset.graphicBands, preset.tilt), key);
  }
});

test('matchPreset: a moved slider reads as no match (CUSTOM) even by a tiny amount', () => {
  const flat = EQ_PRESETS.flat.graphicBands.slice();
  flat[3] = 0.5;
  assert.equal(matchPreset(flat, 0), null);
});

test('matchPreset: any nonzero tilt always reads as no match — presets never touch tilt', () => {
  assert.equal(matchPreset(EQ_PRESETS.flat.graphicBands, 1), null);
  assert.equal(matchPreset(EQ_PRESETS.flat.graphicBands, -0.5), null);
});

test('sanitizeParametricBand: a valid peak band round-trips with every field clamped', () => {
  const band = sanitizeParametricBand({ type: 'peak', freq: 500, gainDb: 999, q: 0.7 });
  assert.equal(band.type, 'peak');
  assert.equal(band.freq, 500);
  assert.equal(band.gainDb, PARAMETRIC_BAND_MAX_DB);
  assert.equal(band.q, 0.7);
});

test('sanitizeParametricBand: a cut-type band always reads gainDb 0, regardless of what was saved', () => {
  const band = sanitizeParametricBand({ type: 'lowcut', freq: 80, gainDb: 6, q: 0.7 });
  assert.equal(band.gainDb, 0);
});

test('sanitizeParametricBand: missing/unrecognized type, or not an object at all, returns null', () => {
  assert.equal(sanitizeParametricBand(null), null);
  assert.equal(sanitizeParametricBand('nope'), null);
  assert.equal(sanitizeParametricBand({ type: 'bogus', freq: 500 }), null);
  assert.equal(sanitizeParametricBand({ freq: 500 }), null);
});

test('sanitizeParametricBand: a missing freq/q falls back to a sane default rather than NaN', () => {
  const band = sanitizeParametricBand({ type: 'peak' });
  assert.equal(band.freq, 1000);
  assert.equal(band.q, 0.7);
  assert.equal(band.gainDb, 0);
});

test('sanitizeParametricBands: caps at MAX_PARAMETRIC_BANDS and drops invalid entries', () => {
  const raw = [
    { type: 'peak', freq: 100 }, { type: 'peak', freq: 200 }, { type: 'bogus' },
    { type: 'peak', freq: 300 }, { type: 'peak', freq: 400 }, { type: 'peak', freq: 500 },
    { type: 'peak', freq: 600 }, { type: 'peak', freq: 700 },
  ];
  const cleaned = sanitizeParametricBands(raw);
  assert.equal(cleaned.length, MAX_PARAMETRIC_BANDS);
  assert.ok(cleaned.every(b => b.type === 'peak'));
});

test('sanitizeParametricBands: not an array at all returns an empty list, never throws', () => {
  assert.deepEqual(sanitizeParametricBands(null), []);
  assert.deepEqual(sanitizeParametricBands('nope'), []);
});

test('defaultEqState: off, flat, graphic mode, auto preamp on', () => {
  const eq = defaultEqState();
  assert.equal(eq.enabled, false);
  assert.equal(eq.mode, 'graphic');
  assert.equal(eq.tilt, 0);
  assert.equal(eq.graphicBands.length, GRAPHIC_BANDS_HZ.length);
  assert.ok(eq.graphicBands.every(v => v === 0));
  assert.deepEqual(eq.parametricBands, []);
  assert.equal(eq.autoPreamp, true);
  assert.equal(eq.preampDb, 0);
  assert.deepEqual(eq.savedPresets, {});
});

test('defaultEqState: returns a fresh object every call — mutating one never leaks into the next', () => {
  const a = defaultEqState();
  a.graphicBands[0] = 12;
  a.enabled = true;
  const b = defaultEqState();
  assert.equal(b.graphicBands[0], 0);
  assert.equal(b.enabled, false);
});

test('every built-in preset stays zero or negative — "favor cuts over boosts"', () => {
  for(const key of EQ_PRESET_KEYS){
    for(const db of EQ_PRESETS[key].graphicBands) assert.ok(db <= 0, `${key} band ${db} is a boost, not a cut`);
  }
});
