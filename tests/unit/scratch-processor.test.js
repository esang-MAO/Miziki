import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// scratch-processor.js is a plain classic script on purpose (see its own
// top comment) — no import, no export — because Safari's AudioWorklet
// module loader has not reliably supported ES module syntax in the
// processor file itself. That means it can't be loaded with a normal ESM
// `import` here either, so instead its source is read as text and run with
// Node's vm module in a sandbox that stubs the AudioWorkletGlobalScope
// globals it expects (AudioWorkletProcessor, registerProcessor, a bare
// `sampleRate`). A classic script's top-level `function` declarations
// become properties of the global object it runs against, which is how the
// pure helpers below (clampIndex, sampleAt, onePole, velocityEnvelopeTarget)
// end up reachable as `sandbox.<name>` afterward — `class` declarations
// don't do that, so ScratchProcessor itself is only reachable through the
// registerProcessor() call it makes, same as in the real AudioWorklet.
const srcPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/audio/scratch-processor.js');
const source = fs.readFileSync(srcPath, 'utf8');

class FakeAudioWorkletProcessor {
  constructor(){ this.port = { onmessage: null, postMessage(){} }; }
}
let registered = null;
const sandbox = {
  AudioWorkletProcessor: FakeAudioWorkletProcessor,
  registerProcessor: (name, Cls) => { registered = { name, Cls }; },
  sampleRate: 44100,
  console,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'scratch-processor.js' });

const { clampIndex, sampleAt, onePole, velocityEnvelopeTarget } = sandbox;

test('registers itself as "scratch-processor"', () => {
  assert.equal(registered.name, 'scratch-processor');
});

function makeProcessor(){ return new registered.Cls(); }

// a ramp so the sample value at index i is i itself — makes it easy to tell
// which index was actually read back out
function rampChannel(length){ return Float32Array.from({ length }, (_, i) => i); }

function loadWindow(proc, { channel, sampleRate: sr, windowStart = 0, trackDuration }){
  proc.onMessage({ type:'window', channels:[channel.buffer], sampleRate: sr, windowStart, trackDuration });
}

function runFrames(proc, n){
  const out = new Float32Array(n);
  proc.process([], [[out]]);
  return out;
}

// Mimics a real gesture: pointermove keeps sending a new target every frame
// (here, every single-sample "frame" for simplicity) rather than one target
// set once and then left alone — a single step settles toward silence once
// the playhead catches up (that's the "holding still" test below), so
// sustained motion needs a target that keeps moving, same as a real scratch.
function simulateContinuousMotion(proc, { startPos, stepPerFrame, frames }){
  proc.onMessage({ type:'start', position: startPos });
  let target = startPos;
  const outputs = [];
  for (let i = 0; i < frames; i++){
    target += stepPerFrame;
    proc.onMessage({ type:'target', target });
    outputs.push(runFrames(proc, 1)[0]);
  }
  return outputs;
}

test('clampIndex keeps an index within [0, length-1]', () => {
  assert.equal(clampIndex(-5, 10), 0);
  assert.equal(clampIndex(5, 10), 5);
  assert.equal(clampIndex(50, 10), 9);
  assert.equal(clampIndex(3, 0), 0);
});

test('sampleAt linearly interpolates, landing between its two neighbors', () => {
  const ch = Float32Array.from([0, 10, 20, 30]);
  assert.equal(sampleAt(ch, 1.5), 15);
  assert.equal(sampleAt(ch, 0), 0);
  assert.equal(sampleAt(ch, 1), 10);
});

test('sampleAt clamps a fractional index past either end of the array', () => {
  const ch = Float32Array.from([5, 6, 7]);
  assert.equal(sampleAt(ch, -3), 5);
  assert.equal(sampleAt(ch, 99), 7);
});

test('onePole moves monotonically toward target and never overshoots it', () => {
  let v = 0;
  for (let i = 0; i < 50; i++) v = onePole(v, 10, 0.01, 0.05);
  assert.ok(v > 0 && v <= 10);
});

test('velocityEnvelopeTarget is 0 at rest and clamps to 1 well above the floor', () => {
  assert.equal(velocityEnvelopeTarget(0, 0.05), 0);
  assert.equal(velocityEnvelopeTarget(50, 0.05), 1);
  assert.ok(velocityEnvelopeTarget(0.025, 0.05) < 1);
});

test('process: a target that keeps moving ahead produces forward motion', () => {
  const proc = makeProcessor();
  loadWindow(proc, { channel: rampChannel(5000), sampleRate: 100, trackDuration: 50 });
  const out = simulateContinuousMotion(proc, { startPos: 1, stepPerFrame: 0.1, frames: 60 });
  // skip the first several frames (envelope/follower still ramping up from silence)
  assert.ok(out[55] > out[20], `expected later output clearly ahead of earlier, got ${out[20]} then ${out[55]}`);
  assert.ok(out[55] > 50, 'expected a clearly audible (non-silent) level once moving steadily');
});

test('process: a target that keeps moving behind produces reverse motion', () => {
  const proc = makeProcessor();
  loadWindow(proc, { channel: rampChannel(5000), sampleRate: 100, trackDuration: 50 });
  const out = simulateContinuousMotion(proc, { startPos: 40, stepPerFrame: -0.1, frames: 60 });
  assert.ok(out[55] < out[20], `expected later output clearly behind earlier, got ${out[20]} then ${out[55]}`);
  assert.ok(out[55] > 50, 'expected a clearly audible (non-silent) level once moving steadily');
});

test('process: holding the target still settles the output to silence', () => {
  const proc = makeProcessor();
  loadWindow(proc, { channel: rampChannel(5000), sampleRate: 100, trackDuration: 50 });
  proc.onMessage({ type:'start', position: 5 });
  proc.onMessage({ type:'target', target: 6 }); // one small move, then held fixed
  runFrames(proc, 100); // let the transient pass
  const settled = runFrames(proc, 50);
  for (const v of settled) assert.ok(Math.abs(v) < 0.5, `expected near-silence once still, got ${v}`);
});

test('process: the playhead and its reads never go outside the loaded window or the track', () => {
  const proc = makeProcessor();
  loadWindow(proc, { channel: rampChannel(50), sampleRate: 10, trackDuration: 5 }); // window covers 0..5s
  const out = simulateContinuousMotion(proc, { startPos: 0, stepPerFrame: 5, frames: 80 }); // way past the end
  for (const v of out) assert.ok(Number.isFinite(v) && Math.abs(v) <= 50, `out-of-window read: ${v}`);
  assert.ok(proc.playhead <= proc.trackDuration, 'playhead exceeded the track duration');
  assert.ok(proc.playhead >= 0, 'playhead went negative');
});
