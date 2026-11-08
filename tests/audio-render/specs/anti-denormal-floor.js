// Anti-denormal floor (Ken, 2026-11-08: hiss that builds up over long
// playback, clears the instant he pauses and plays again). engine.js's
// buildGraph() now feeds a tiny, always-on, inaudible tone into n.wobble
// (every Vinyl-only filter downstream) and n.master (the EQ/balance/
// limiter chain both modes always run) -- see that file's own comment for
// the full theory: a biquad's internal state can decay into the subnormal
// float range on a long quiet passage, which real hardware computes much
// slower than normal floats, and that CPU pressure on the audio thread is
// a plausible cause of a hiss that builds over time and vanishes the
// instant playback briefly goes to true silence (pause) and starts again.
//
// This spec can't reproduce the hardware-level subnormal slowdown itself
// (OfflineAudioContext rendering doesn't model real CPU cost) -- what it
// proves instead is the fix's own two load-bearing properties: the floor
// is actually present (so the filters really do have something nonzero
// to chew on through total silence) and it is nowhere near audible, in
// both modes, and that it hasn't quietly broken PL5's own output-stage
// null test (docs/19_PLAYER.md item 8) in the process.
import { S } from '../../../src/state.js';
import { buildGraph, routeSource, applyEQ, applyLoudnessNorm, applyMonoBalance, applyDeviceVolume } from '../../../src/audio/engine.js';
import { defaultEqState } from '../../../src/audio/eq.js';
import { linearToDb } from '../../../src/audio/loudness.js';

const SAMPLE_RATE = 44100;
const DURATION_SEC = 3;

function resetS(mode){
  S.mode = mode;
  S.rate = 1;
  S.platterRate = 1;
  S.recordFormat = { size: '12"', speed: 33.333 };
  S.char = { wow: 0, sat: 0, soft: 0, comp: 0, scratch: false };
  S.charDrift = 'off';
  S.mono = false;
  S.balance = 0;
  S.deviceVolume = 1;
  S.loudnessMode = 'off';
  S.tracks = [];
  S.index = 0;
  S.queue = [];
  S.shuffle = false;
  S.eq = defaultEqState();
}

// Renders DURATION_SEC of true digital silence (a zeroed buffer) through
// the real, shipped graph and returns the rendered output's own peak, in
// dB -- the floor's whole signature, since nothing else in the graph has
// anything to produce.
async function renderSilenceFloorDb(mode){
  resetS(mode);
  const ctx = new OfflineAudioContext(2, Math.round(SAMPLE_RATE * DURATION_SEC), SAMPLE_RATE);
  S.ctx = ctx;
  S.nodes = await buildGraph(ctx);
  applyEQ(0);
  applyLoudnessNorm(0);
  applyMonoBalance(0);
  applyDeviceVolume(0);

  const n = Math.round(DURATION_SEC * SAMPLE_RATE);
  const buf = ctx.createBuffer(2, n, SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buf; // both channels already zero-filled -- true silence in
  routeSource(src);
  src.start(0);

  const rendered = await ctx.startRendering();
  let peak = 0;
  for(let ch = 0; ch < 2; ch++){
    const out = rendered.getChannelData(ch);
    // Skip a short settle margin at the very start -- the limiter's own
    // lookahead ring is still zero-filled there, same precedent as
    // pl5-transparent-output.js's own LOOKAHEAD_SAMPLES skip.
    for(let i = 200; i < out.length; i++){ const a = Math.abs(out[i]); if(a > peak) peak = a; }
  }
  return peak > 0 ? linearToDb(peak) : -Infinity;
}

// Deliberately identical to pl5-transparent-output.js's own test signal
// and residual measure -- this is the exact regression that fix must not
// touch: Pure, EQ off, normalization off, residual against the dry source
// still comfortably below -100dBFS.
function buildTestSignal(ch, n){
  const out = new Float32Array(n);
  const freqs = ch === 0 ? [220, 1000, 3300] : [330, 1500, 5000];
  for(let i = 0; i < n; i++){
    let v = 0;
    for(const f of freqs) v += Math.sin(2 * Math.PI * f * i / SAMPLE_RATE);
    v /= freqs.length;
    out[i] = v * 0.3;
  }
  return out;
}

async function nullTestStillHolds(){
  resetS('pure');
  const ctx = new OfflineAudioContext(2, Math.round(SAMPLE_RATE * DURATION_SEC), SAMPLE_RATE);
  S.ctx = ctx;
  S.nodes = await buildGraph(ctx);
  applyEQ(0);
  applyLoudnessNorm(0);
  applyMonoBalance(0);
  applyDeviceVolume(0);

  const n = Math.round(DURATION_SEC * SAMPLE_RATE);
  const sourceL = buildTestSignal(0, n), sourceR = buildTestSignal(1, n);
  const buf = ctx.createBuffer(2, n, SAMPLE_RATE);
  buf.copyToChannel(sourceL, 0);
  buf.copyToChannel(sourceR, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  routeSource(src);
  src.start(0);

  const rendered = await ctx.startRendering();
  const LOOKAHEAD_SAMPLES = Math.round(0.002 * SAMPLE_RATE);
  let peak = 0;
  for(let ch = 0; ch < 2; ch++){
    const out = rendered.getChannelData(ch);
    const source = ch === 0 ? sourceL : sourceR;
    for(let i = LOOKAHEAD_SAMPLES + 8; i < n - 8; i++){
      const diff = Math.abs(out[i] - source[i - LOOKAHEAD_SAMPLES]);
      if(diff > peak) peak = diff;
    }
  }
  return peak > 0 ? linearToDb(peak) : -Infinity;
}

export async function run(){
  const pureFloorDb = await renderSilenceFloorDb('pure');
  const vinylFloorDb = await renderSilenceFloorDb('vinyl');
  const nullResidualDb = await nullTestStillHolds();

  const checks = [
    { name: 'Pure: true silence renders a nonzero floor (filters have something to chew on)', value: pureFloorDb, pass: pureFloorDb > -Infinity && pureFloorDb < -60 },
    { name: 'Pure: that floor stays far below audible (< -150dBFS)', value: pureFloorDb, pass: pureFloorDb < -150 },
    { name: 'Vinyl: true silence renders a nonzero floor', value: vinylFloorDb, pass: vinylFloorDb > -Infinity && vinylFloorDb < -60 },
    { name: 'Vinyl: that floor stays far below audible (< -150dBFS)', value: vinylFloorDb, pass: vinylFloorDb < -150 },
    { name: 'PL5 null test (Pure, EQ off, normalization off) still holds: residual below -100dBFS', value: nullResidualDb, pass: nullResidualDb < -100 },
  ];
  return { checks, pass: checks.every(c => c.pass) };
}
