import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  integratedLoudnessLUFS, estimateTruePeakDb, countClippingRuns, peakToLoudnessRatio,
  dbToLinear, linearToDb, measureTrack, trackGainDb, albumGainDb, clampGainDbForPeak,
  classifyDynamics, loudnessCaptionFor, formatGainDb, REFERENCE_LUFS, TRUE_PEAK_VERSION,
} from '../../src/audio/loudness.js';

// src/audio/loudness.js has no imports of its own (same leaf shape as
// sundown/rhythm.js / audio/level-match.js — see that file's own header
// comment) -- nothing here needs mocking.

const SR = 48000;
function sine(freq, amp, seconds, sr = SR){
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for(let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
  return out;
}

test('integratedLoudnessLUFS: silence reads -Infinity', () => {
  const ch = new Float32Array(SR); // 1s of zeros
  assert.equal(integratedLoudnessLUFS([ch], SR), -Infinity);
});

test('integratedLoudnessLUFS: empty/missing input reads -Infinity', () => {
  assert.equal(integratedLoudnessLUFS([], SR), -Infinity);
  assert.equal(integratedLoudnessLUFS(null, SR), -Infinity);
  assert.equal(integratedLoudnessLUFS([new Float32Array(0)], SR), -Infinity);
});

test('integratedLoudnessLUFS: halving amplitude lowers loudness by ~6dB', () => {
  const full = sine(1000, 0.5, 2);
  const half = sine(1000, 0.25, 2);
  const lufsFull = integratedLoudnessLUFS([full, full], SR);
  const lufsHalf = integratedLoudnessLUFS([half, half], SR);
  assert.ok(isFinite(lufsFull) && isFinite(lufsHalf));
  // a gain change shifts loudness by exactly 20*log10(gain) dB -- the same
  // relationship scripts/derive-makeup-table.mjs's own header comment
  // relies on to avoid an iterative solve.
  assert.ok(Math.abs((lufsFull - lufsHalf) - 6.0206) < 0.1);
});

test('integratedLoudnessLUFS: a too-short signal still returns a finite number (ungated fallback)', () => {
  const short = sine(1000, 0.5, 0.05); // 50ms, well under the 400ms block
  const lufs = integratedLoudnessLUFS([short], SR);
  assert.ok(isFinite(lufs));
});

test('estimateTruePeakDb: a full-scale signal reads ~0dBFS', () => {
  const ch = new Float32Array([0, 1, 0, -1, 0]);
  assert.ok(Math.abs(estimateTruePeakDb([ch])) < 0.01);
});

test('estimateTruePeakDb: scales with amplitude', () => {
  const half = new Float32Array([0, 0.5, 0, -0.5, 0]);
  assert.ok(Math.abs(estimateTruePeakDb([half]) - linearToDb(0.5)) < 0.01);
});

test('estimateTruePeakDb: no channels reads -Infinity', () => {
  assert.equal(estimateTruePeakDb([]), -Infinity);
  assert.equal(estimateTruePeakDb(null), -Infinity);
});

// PL5 item 4: the whole point of a real oversampled estimate is catching
// a peak that sits *between* samples, which a plain sample scan (and the
// old 4x linear-interpolation guess, which can never exceed the two
// samples it sat between) would miss. A unit-amplitude sine at exactly
// Fs/4, phase-shifted so its true continuous peak falls exactly halfway
// between two samples, is the textbook case: no single sample ever
// reaches 1.0 (every sample reads ±1/√2, about -3dB), but the signal's
// real peak is the full 0dBFS.
test('estimateTruePeakDb: catches an inter-sample overshoot a plain sample scan would miss', () => {
  const freq = SR / 4;
  const n = 40;
  const ch = new Float32Array(n);
  for(let i = 0; i < n; i++) ch[i] = Math.sin(2 * Math.PI * freq * i / SR + Math.PI / 4);
  let sampleOnlyPeak = 0;
  for(let i = 0; i < n; i++) sampleOnlyPeak = Math.max(sampleOnlyPeak, Math.abs(ch[i]));
  const sampleOnlyDb = linearToDb(sampleOnlyPeak);
  const trueDb = estimateTruePeakDb([ch]);
  assert.ok(trueDb > sampleOnlyDb + 2,
    `true peak ${trueDb} should clear the raw sample peak ${sampleOnlyDb} by a wide margin`);
  assert.ok(trueDb < 0.5, `true peak ${trueDb} should stay close to the sine's real 0dBFS peak`);
});

test('countClippingRuns: a run of exactly the minimum length counts once', () => {
  const ch = new Float32Array([0, 1, 1, 1, 0, 0]);
  assert.equal(countClippingRuns([ch]), 1);
});

test('countClippingRuns: a run shorter than the minimum does not count', () => {
  const ch = new Float32Array([0, 1, 1, 0, 0]);
  assert.equal(countClippingRuns([ch]), 0);
});

test('countClippingRuns: a run touching the very end of the buffer still counts', () => {
  const ch = new Float32Array([0, 0, 1, 1, 1]);
  assert.equal(countClippingRuns([ch]), 1);
});

test('countClippingRuns: multiple channels sum independently', () => {
  const chA = new Float32Array([1, 1, 1, 0]);
  const chB = new Float32Array([0, -1, -1, -1]);
  assert.equal(countClippingRuns([chA, chB]), 2);
});

test('peakToLoudnessRatio: plain subtraction; null for non-finite input', () => {
  assert.equal(peakToLoudnessRatio(-1, -18), 17);
  assert.equal(peakToLoudnessRatio(-Infinity, -18), null);
  assert.equal(peakToLoudnessRatio(-1, NaN), null);
});

test('dbToLinear/linearToDb round-trip', () => {
  assert.ok(Math.abs(linearToDb(dbToLinear(-6)) - -6) < 1e-9);
  assert.equal(linearToDb(0), -Infinity);
});

test('measureTrack: returns a measured, finite reading for a real signal', () => {
  const ch = sine(1000, 0.5, 1);
  const m = measureTrack([ch], SR);
  assert.equal(m.measured, true);
  assert.ok(isFinite(m.lufs));
  assert.ok(isFinite(m.truePeakDb));
  assert.equal(m.clipRuns, 0);
  assert.ok(isFinite(m.plr));
  assert.equal(m.truePeakVersion, TRUE_PEAK_VERSION);
});

test('measureTrack: a clipped signal is detected', () => {
  const ch = new Float32Array(2000).fill(1);
  const m = measureTrack([ch], SR);
  assert.ok(m.clipRuns > 0);
});

test('trackGainDb: prefers a tagged track gain over the measured value', () => {
  const details = {replayGain: {trackGain: -3.2, trackPeak: null, albumGain: null, albumPeak: null}, loudness: {lufs: -20, measured: true}};
  assert.equal(trackGainDb(details), -3.2);
});

test('trackGainDb: falls back to REFERENCE_LUFS minus the measured LUFS', () => {
  const details = {replayGain: {trackGain: null}, loudness: {lufs: -22, measured: true}};
  assert.equal(trackGainDb(details), REFERENCE_LUFS - -22);
});

test('trackGainDb: null when neither a tag nor a measurement is available', () => {
  assert.equal(trackGainDb(null), null);
  assert.equal(trackGainDb({}), null);
  assert.equal(trackGainDb({replayGain: {trackGain: null}, loudness: null}), null);
});

test('albumGainDb: prefers a tagged album gain found on any track', () => {
  const entries = [
    {details: {replayGain: {albumGain: null}, loudness: {lufs: -20, measured: true}}, duration: 180},
    {details: {replayGain: {albumGain: -5.1}, loudness: null}, duration: 200},
  ];
  assert.equal(albumGainDb(entries), -5.1);
});

test('albumGainDb: duration-weighted energy average when no tag is present', () => {
  // two tracks at the same LUFS -> the album gain should equal what a
  // single track at that LUFS would give, regardless of their durations
  const sameLufs = -20;
  const entries = [
    {details: {loudness: {lufs: sameLufs, measured: true}}, duration: 100},
    {details: {loudness: {lufs: sameLufs, measured: true}}, duration: 300},
  ];
  assert.ok(Math.abs(albumGainDb(entries) - (REFERENCE_LUFS - sameLufs)) < 0.01);
});

test('albumGainDb: null with no usable data at all', () => {
  assert.equal(albumGainDb([]), null);
  assert.equal(albumGainDb([{details: null, duration: 0}]), null);
});

test('clampGainDbForPeak: clamps a gain that would push the peak past -1dBFS', () => {
  // peak at -2dBFS, a +3dB gain would land at +1dBFS -- must clamp to +1dB
  const peakLinear = dbToLinear(-2);
  const clamped = clampGainDbForPeak(3, peakLinear);
  assert.ok(Math.abs(clamped - 1) < 1e-9);
});

test('clampGainDbForPeak: leaves a safe gain untouched', () => {
  const peakLinear = dbToLinear(-10);
  assert.equal(clampGainDbForPeak(2, peakLinear), 2);
});

test('clampGainDbForPeak: no clamp when the peak is unknown', () => {
  assert.equal(clampGainDbForPeak(5, null), 5);
  assert.equal(clampGainDbForPeak(5, undefined), 5);
  assert.equal(clampGainDbForPeak(5, -1), 5);
});

test('classifyDynamics: clipping always wins, regardless of PLR', () => {
  const d = classifyDynamics({clipRuns: 1, plr: 20});
  assert.equal(d.label, 'Clipped master');
});

test('classifyDynamics: a low peak-to-loudness ratio reads Compressed', () => {
  const d = classifyDynamics({clipRuns: 0, plr: 5});
  assert.equal(d.label, 'Compressed');
});

test('classifyDynamics: otherwise Dynamic', () => {
  const d = classifyDynamics({clipRuns: 0, plr: 14});
  assert.equal(d.label, 'Dynamic');
  assert.equal(d.sentence, 'Plenty of room between the quiet and loud parts. No clipping found.');
});

test('loudnessCaptionFor: one caption per mode, a sane default for anything else', () => {
  assert.match(loudnessCaptionFor('off'), /own level/);
  assert.match(loudnessCaptionFor('track'), /individual songs/);
  assert.match(loudnessCaptionFor('album'), /records/);
  assert.match(loudnessCaptionFor('auto'), /Auto/);
  assert.match(loudnessCaptionFor('nonsense'), /Auto/);
});

test('formatGainDb: the doc\'s own exact shape, sign included', () => {
  assert.equal(formatGainDb('album gain', -4.2), 'ALBUM GAIN -4.2 DB');
  assert.equal(formatGainDb('album gain', 1.5), 'ALBUM GAIN +1.5 DB');
  assert.equal(formatGainDb('album gain', null), '');
});
