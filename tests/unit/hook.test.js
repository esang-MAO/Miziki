import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  downmixMono, resampleLinear, nextPow2, hannWindow, fftRadix2, freqToChroma,
  chromaFrame, computeChromaFrames, findRepeatedSegment, detectHook,
} from '../../src/audio/hook.js';

// src/audio/hook.js has no imports of its own (same leaf shape as
// audio/loudness.js/level-match.js — see that file's own header comment)
// -- nothing here needs mocking.

test('downmixMono: averages channels, passes a single channel through unchanged', () => {
  const l = new Float32Array([1, 0, -1]);
  const r = new Float32Array([0.5, 0.5, 0.5]);
  const mono = downmixMono([l, r]);
  assert.deepEqual(Array.from(mono), [0.75, 0.25, -0.25]);
  const single = downmixMono([l]);
  assert.deepEqual(Array.from(single), Array.from(l));
});

test('resampleLinear: same rate is a no-op; downsampling preserves start/end', () => {
  const ramp = new Float32Array(1000);
  for(let i = 0; i < ramp.length; i++) ramp[i] = i / ramp.length;
  assert.equal(resampleLinear(ramp, 44100, 44100), ramp);
  const down = resampleLinear(ramp, 44100, 11025);
  assert.ok(down.length < ramp.length);
  assert.ok(Math.abs(down[0] - ramp[0]) < 1e-6);
  assert.ok(Math.abs(down[down.length - 1] - ramp[ramp.length - 1]) < 0.01);
});

test('nextPow2: smallest power of two at or above n', () => {
  assert.equal(nextPow2(1), 1);
  assert.equal(nextPow2(2), 2);
  assert.equal(nextPow2(5), 8);
  assert.equal(nextPow2(1024), 1024);
  assert.equal(nextPow2(1025), 2048);
});

test('hannWindow: zero at both edges, peak of 1 at center, length n', () => {
  const w = hannWindow(9);
  assert.equal(w.length, 9);
  assert.ok(w[0] < 1e-9);
  assert.ok(w[8] < 1e-9);
  assert.ok(Math.abs(w[4] - 1) < 1e-9);
});

test('fftRadix2: a pure DC signal has all its energy in bin 0', () => {
  const n = 64;
  const re = new Float32Array(n).fill(1);
  const im = new Float32Array(n);
  fftRadix2(re, im);
  assert.ok(Math.abs(re[0] - n) < 1e-6);
  for(let i = 1; i < n; i++) assert.ok(Math.hypot(re[i], im[i]) < 1e-6);
});

test('freqToChroma: octave-equivalent frequencies share a pitch class', () => {
  const a4 = freqToChroma(440);
  const a5 = freqToChroma(880);
  const a3 = freqToChroma(220);
  assert.equal(a4, a5);
  assert.equal(a4, a3);
});

test('chromaFrame: a pure tone peaks at its own pitch class', () => {
  const sr = 11025;
  const n = Math.round(sr * 0.4);
  const samples = new Float32Array(n);
  const freq = 440; // A
  for(let i = 0; i < n; i++) samples[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  const chroma = chromaFrame(samples, sr);
  const expected = freqToChroma(freq);
  let maxIdx = 0;
  for(let i = 1; i < 12; i++) if(chroma[i] > chroma[maxIdx]) maxIdx = i;
  assert.equal(maxIdx, expected);
});

test('chromaFrame: silence reads as the zero vector, not NaN', () => {
  const chroma = chromaFrame(new Float32Array(2048), 11025);
  for(let i = 0; i < 12; i++) assert.equal(chroma[i], 0);
});

test('computeChromaFrames: one 12-length vector per hop, within the signal length', () => {
  const sr = 11025;
  const seconds = 10;
  const samples = new Float32Array(sr * seconds);
  const {frames, hopSec} = computeChromaFrames(samples, sr, {hopSec: 0.2, frameSec: 0.4});
  assert.equal(hopSec, 0.2);
  assert.ok(frames.length > 0);
  for(const f of frames) assert.equal(f.length, 12);
  // the last frame must fit entirely inside the signal
  assert.ok((frames.length - 1) * 0.2 * sr + 0.4 * sr <= samples.length + 1);
});

// Deterministic PRNG (mulberry32) so the self-similarity search test below
// is reproducible without needing an adversarially exact construction —
// see src/audio/hook.js's own header comment for why a near-orthogonal
// random background is what gives the inserted, byte-identical repeat its
// statistical separation from chance matches.
function mulberry32(seed){
  let a = seed;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomChromaVector(rng){
  const v = new Float32Array(12);
  let norm = 0;
  for(let i = 0; i < 12; i++){ v[i] = rng() * 2 - 1; norm += v[i] * v[i]; }
  norm = Math.sqrt(norm);
  for(let i = 0; i < 12; i++) v[i] /= norm;
  return v;
}

test('findRepeatedSegment: finds an inserted, exact repeat against a random background', () => {
  const rng = mulberry32(42);
  const hopSec = 0.2;
  const N = 150; // 30s of frames
  const frames = [];
  for(let i = 0; i < N; i++) frames.push(randomChromaVector(rng));
  // a 3s (15-frame) pattern, placed once at frame 20 and again, byte
  // identical, at frame 90 (a lag of 70 frames, well clear of either copy)
  const patternLen = 15;
  const pattern = [];
  for(let i = 0; i < patternLen; i++) pattern.push(randomChromaVector(rng));
  for(let i = 0; i < patternLen; i++){ frames[20 + i] = pattern[i]; frames[90 + i] = pattern[i]; }

  const seg = findRepeatedSegment(frames, hopSec, {minSec: 2, maxSec: 6});
  assert.ok(seg, 'expected a repeat to be found');
  // byte-identical frames score exactly 1 (cosine similarity of a vector
  // with itself) -- a random background's own average dot product is far
  // below that (mean 0, std well under 0.3 for 12-dim unit vectors), so
  // this is not a near call.
  assert.ok(seg.score > 0.95, `score too low: ${seg.score}`);
  // the found window should start inside (or very near) one of the two
  // insertion points -- 20 or 90 frames in, i.e. 4.0s or 18.0s.
  const startFrame = seg.startSec / hopSec;
  const nearFirst = Math.abs(startFrame - 20) <= 2;
  const nearSecond = Math.abs(startFrame - 90) <= 2;
  assert.ok(nearFirst || nearSecond, `unexpected start frame: ${startFrame}`);
});

test('findRepeatedSegment: too short for twice the minimum length returns null', () => {
  const frames = [new Float32Array(12), new Float32Array(12)];
  assert.equal(findRepeatedSegment(frames, 0.2, {minSec: 8, maxSec: 30}), null);
});

test('findRepeatedSegment: an empty frame list returns null', () => {
  assert.equal(findRepeatedSegment([], 0.2), null);
});

test('detectHook: a track shorter than twice the minimum length returns null', () => {
  const sr = 11025;
  const channels = [new Float32Array(sr * 5)]; // 5s, well under 2*8s
  assert.equal(detectHook(channels, sr, {minSec: 8, maxSec: 30}), null);
});

test('detectHook: no channel data returns null, never throws', () => {
  assert.equal(detectHook(null, 11025), null);
  assert.equal(detectHook([], 11025), null);
});

test('detectHook: finds a repeated melody in a synthetic track end to end', () => {
  const sr = 11025;
  // A short four-note "melody" (0.5s per note, 2s total), each note a pure
  // tone at a distinct pitch class so the chroma pipeline can tell them
  // apart cleanly.
  const notes = [440, 523.25, 659.25, 349.23]; // A, C5, E5, F4
  function tone(freq, seconds){
    const n = Math.round(seconds * sr);
    const out = new Float32Array(n);
    for(let i = 0; i < n; i++) out[i] = 0.3 * Math.sin((2 * Math.PI * freq * i) / sr);
    return out;
  }
  function concat(arrays){
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Float32Array(total);
    let off = 0;
    for(const a of arrays){ out.set(a, off); off += a.length; }
    return out;
  }
  const melody = concat(notes.map(f => tone(f, 0.5)));
  // Filler elsewhere in the track uses distinct, non-repeating pitches
  // (each used exactly once) so the melody's own two occurrences are the
  // *only* repeat anywhere in the signal -- otherwise a filler pitch that
  // happens to recur could score just as well as the real hook and the
  // test would be checking the wrong thing.
  const filler = freq => tone(freq, 1);
  const track = concat([
    filler(196.00), filler(246.94), filler(277.18),              // ~3s of unique filler
    melody,                                                       // first occurrence (2s)
    filler(293.66), filler(329.63), filler(369.99), filler(415.30), // ~4s more unique filler
    melody,                                                       // second occurrence (2s)
    filler(493.88),                                               // ~1s tail
  ]);
  const hook = detectHook([track], sr, {minSec: 1.5, maxSec: 3, hopSec: 0.2, frameSec: 0.4});
  assert.ok(hook, 'expected a hook to be detected');
  assert.ok(hook.hookEnd > hook.hookStart);
  const span = hook.hookEnd - hook.hookStart;
  assert.ok(span >= 1.4 && span <= 3.1, `unexpected span: ${span}`);
  // the detected start should land inside one of the two melody
  // occurrences (first starts at 3s, second at 3+2+4=9s), not in the
  // unrelated filler.
  const nearFirst = hook.hookStart >= 2.5 && hook.hookStart <= 5.5;
  const nearSecond = hook.hookStart >= 8.5 && hook.hookStart <= 11.5;
  assert.ok(nearFirst || nearSecond, `unexpected hook start: ${hook.hookStart}`);
});
