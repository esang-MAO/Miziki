import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// limiter-processor.js is a plain classic script on purpose (see its own top
// comment, and scratch-processor.test.js's own entry above it) -- no import,
// no export -- so it's loaded the same way scratch-processor.test.js loads
// its own subject: read as text and run with Node's vm module in a sandbox
// that stubs the AudioWorkletGlobalScope globals it expects
// (AudioWorkletProcessor, registerProcessor, a bare sampleRate).
const srcPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/audio/limiter-processor.js');
const source = fs.readFileSync(srcPath, 'utf8');

class FakeAudioWorkletProcessor {}
let registered = null;
const SR = 48000;
const sandbox = {
  AudioWorkletProcessor: FakeAudioWorkletProcessor,
  registerProcessor: (name, Cls) => { registered = { name, Cls }; },
  sampleRate: SR,
  console,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'limiter-processor.js' });

test('registers itself as "limiter-processor"', () => {
  assert.equal(registered.name, 'limiter-processor');
});

function makeProcessor(){ return new registered.Cls(); }

// Feeds a stereo (2-channel) constant-level signal of `frames` samples at
// `amp` and returns the processor's own stereo output.
function runConstant(proc, amp, frames){
  const inL = new Float32Array(frames).fill(amp);
  const inR = new Float32Array(frames).fill(amp);
  const outL = new Float32Array(frames);
  const outR = new Float32Array(frames);
  proc.process([[inL, inR]], [[outL, outR]]);
  return [outL, outR];
}

const THRESHOLD_LIN = Math.pow(10, -1 / 20); // -1dBFS ceiling, docs/16_AUDIO.md §2.3

test('a signal under the -1dBFS threshold passes through at unity gain (after the lookahead delay)', () => {
  const proc = makeProcessor();
  // feed well past the lookahead window so the ring is fully "primed" and
  // every output sample reflects the same constant input level
  const frames = proc.lookaheadSamples * 4;
  const amp = 0.3; // well under THRESHOLD_LIN (~0.891)
  const [outL] = runConstant(proc, amp, frames);
  // once past the lookahead delay, every sample should read back the input
  // level essentially unchanged (gain settles at 1)
  for(let i = proc.lookaheadSamples * 2; i < frames; i++){
    assert.ok(Math.abs(outL[i] - amp) < 1e-6, `sample ${i}: ${outL[i]} !== ${amp}`);
  }
});

test('a signal over the -1dBFS threshold is brought down to the ceiling, not just attenuated by some fixed amount', () => {
  const proc = makeProcessor();
  const frames = proc.lookaheadSamples * 6;
  const amp = 1.0; // well over THRESHOLD_LIN
  const [outL] = runConstant(proc, amp, frames);
  // after attack has fully settled (several lookahead windows + release
  // time worth of samples in), the output should sit at essentially the
  // threshold, not above it
  const settledFrom = frames - proc.lookaheadSamples;
  for(let i = settledFrom; i < frames; i++){
    assert.ok(outL[i] <= THRESHOLD_LIN + 1e-4, `sample ${i}: ${outL[i]} exceeds the ceiling ${THRESHOLD_LIN}`);
  }
  // and it should have actually been pulled close to the ceiling, not left
  // far below it by an overly conservative gain
  assert.ok(outL[frames - 1] > THRESHOLD_LIN * 0.9);
});

test('the limiter reacts to a transient before it reaches the output (true lookahead)', () => {
  const proc = makeProcessor();
  const N = proc.lookaheadSamples;
  // silence, then one single full-scale spike, then silence again --
  // long enough on both sides to see gain settle fully back to 1
  const frames = N * 6;
  const inL = new Float32Array(frames);
  const inR = new Float32Array(frames);
  const spikeAt = N * 3;
  inL[spikeAt] = 1.0; inR[spikeAt] = 1.0;
  const outL = new Float32Array(frames);
  const outR = new Float32Array(frames);
  proc.process([[inL, inR]], [[outL, outR]]);

  // The spike enters the peak ring at tick spikeAt and is read back out
  // (delayed) at tick spikeAt+N -- but the gain's one-pole attack has had
  // the full N-sample lookahead window to react to it by then, well before
  // the delayed sample is ever emitted. Without real lookahead, nothing
  // would start attenuating until the spike itself appeared at the output
  // (i.e. gain would still read ~1 right at spikeAt+N); with it, the gain
  // is already substantially pulled down by that point.
  const delayedSpikeIdx = spikeAt + N;
  assert.ok(delayedSpikeIdx < frames, 'fixture too short to observe the delayed spike');
  assert.ok(outL[delayedSpikeIdx] < 0.95,
    `delayed spike sample ${outL[delayedSpikeIdx]} shows no sign of pre-emptive attenuation -- limiter reacted too late`);
  // and a little further in, attack has had time to fully settle at the ceiling
  assert.ok(outL[delayedSpikeIdx + N] <= THRESHOLD_LIN + 1e-3,
    `sample ${outL[delayedSpikeIdx + N]} still above the ceiling after a full lookahead window of settling`);
});

test('never produces an output above unity gain -- silence stays silence, no gain ever exceeds 1', () => {
  const proc = makeProcessor();
  const frames = proc.lookaheadSamples * 3;
  const [outL, outR] = runConstant(proc, 0, frames);
  for(let i = 0; i < frames; i++){
    assert.equal(outL[i], 0);
    assert.equal(outR[i], 0);
  }
  assert.ok(proc.gain <= 1 + 1e-9);
});
