// PL5 (docs/19_PLAYER.md item 8): the output stage's own null test --
// "with EQ off and normalization set to Off, Pure output equals the
// decoded file." Exercises the real, shipped output-stage graph
// (buildGraph()/routeSource()/applyEQ()/applyLoudnessNorm()/
// applyMonoBalance()/applyDeviceVolume(), src/audio/engine.js) against a
// real OfflineAudioContext, in whichever browser engine is running this
// harness.
//
// Scaled down from the doc's own "30s" framing to a few seconds --
// OfflineAudioContext is sample-accurate regardless of real-world
// duration (pl2-anchor-position.js's own precedent), so this proves the
// same property, just faster to run.
//
// The limiter worklet (src/audio/limiter-processor.js) delays everything
// by its own fixed lookahead window even at unity gain -- it reads the
// sample that's now exactly `lookaheadSamples` ticks old out of its ring
// every tick, so a transparent pass-through is still a *delayed* copy of
// the source, not an undelayed one. LOOKAHEAD_SAMPLES below mirrors that
// file's own LOOKAHEAD_SEC exactly (it's a classic script with no exports
// to import the real constant from), and every comparison below shifts
// by it.
import { S } from '../../../src/state.js';
import {
  buildGraph, routeSource, applyEQ, applyLoudnessNorm, applyMonoBalance, applyDeviceVolume,
} from '../../../src/audio/engine.js';
import { defaultEqState } from '../../../src/audio/eq.js';
import { estimateTruePeakDb, linearToDb } from '../../../src/audio/loudness.js';

const SAMPLE_RATE = 44100;
const LOOKAHEAD_SEC = 0.002; // mirrors limiter-processor.js's own LOOKAHEAD_SEC (PL5 item 3)
const LOOKAHEAD_SAMPLES = Math.round(LOOKAHEAD_SEC * SAMPLE_RATE);

function resetS(){
  S.mode = 'pure';
  S.rate = 1;
  S.recordFormat = null;
  S.char = { wow: 0, sat: 0, soft: 0, comp: 0 };
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

// Deliberately not a single pure tone -- a few sines at different
// frequencies plus a touch of cheap, deterministic pseudo-noise (no
// Math.random(), so runs are repeatable) -- so a phase-sensitive bug (an
// unwanted filter, an extra sample of delay somewhere) can't hide behind
// one frequency's own zero crossings the way a single sine sometimes can.
function buildTestSignal(ch, n){
  const out = new Float32Array(n);
  const freqs = ch === 0 ? [220, 1000, 3300] : [330, 1500, 5000];
  for(let i = 0; i < n; i++){
    let v = 0;
    for(const f of freqs) v += Math.sin(2 * Math.PI * f * i / SAMPLE_RATE);
    v /= freqs.length;
    const noise = Math.sin(i * 12.9898 + ch * 78.233) * 43758.5453;
    v += (noise - Math.floor(noise) - 0.5) * 0.02;
    out[i] = v * 0.3; // comfortably under the limiter's -1dBFS ceiling
  }
  return out;
}

async function renderThroughPure({ durationSec, eqSetup }){
  resetS();
  if(eqSetup) S.eq = eqSetup();
  const ctx = new OfflineAudioContext(2, Math.round(SAMPLE_RATE * (durationSec + LOOKAHEAD_SEC + 0.01)), SAMPLE_RATE);
  S.ctx = ctx;
  S.nodes = await buildGraph(ctx);

  const n = Math.round(durationSec * SAMPLE_RATE);
  const sourceL = buildTestSignal(0, n);
  const sourceR = buildTestSignal(1, n);
  const buf = ctx.createBuffer(2, n, SAMPLE_RATE);
  buf.copyToChannel(sourceL, 0);
  buf.copyToChannel(sourceR, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;

  applyEQ(0);
  applyLoudnessNorm(0);
  applyMonoBalance(0);
  applyDeviceVolume(0);

  routeSource(src);
  src.start(0);

  const rendered = await ctx.startRendering();
  return { rendered, sourceL, sourceR, n };
}

// Max absolute sample-to-sample residual, in dB, between the rendered
// output and the source shifted by the limiter's own fixed lookahead
// delay -- across both channels, skipping a small settle margin at
// either end (the delay buffer's own zero-fill before the first real
// sample arrives, and whatever's left of the lookahead window past the
// source's own end).
function residualDb({ rendered, sourceL, sourceR, n }){
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

async function nullTestEqOff(){
  return residualDb(await renderThroughPure({ durationSec: 3 }));
}

async function nullTestEqOnEveryBandZero(){
  const graphic = await renderThroughPure({
    durationSec: 3,
    eqSetup: () => Object.assign(defaultEqState(), { enabled: true, mode: 'graphic', tilt: 0 }),
  });
  const parametric = await renderThroughPure({
    durationSec: 3,
    eqSetup: () => Object.assign(defaultEqState(), {
      enabled: true, mode: 'parametric',
      parametricBands: [{ type: 'peak', freq: 1000, q: 0.7, gainDb: 0 }],
    }),
  });
  return Math.max(residualDb(graphic), residualDb(parametric));
}

// A track that reads as quiet in LUFS terms (so normalization wants to
// push it up toward REFERENCE_LUFS, +6dB) but whose actual measured peak
// is already close to full scale -- clampGainDbForPeak() (loudness.js) is
// what's supposed to catch exactly this, the limiter the final backstop
// regardless of whether that clamp did its job.
async function hotFileStaysUnderCeiling(){
  resetS();
  S.loudnessMode = 'track';
  const amp = 0.9;
  S.tracks = [{
    tags: { album: 'Test Album', artist: 'Test Artist', title: 'Test Track' },
    details: { loudness: { lufs: -20, truePeakDb: linearToDb(amp) } },
  }];
  S.index = 0;

  const durationSec = 2;
  const ctx = new OfflineAudioContext(2, Math.round(SAMPLE_RATE * (durationSec + LOOKAHEAD_SEC + 0.01)), SAMPLE_RATE);
  S.ctx = ctx;
  S.nodes = await buildGraph(ctx);

  const n = Math.round(durationSec * SAMPLE_RATE);
  const sourceL = new Float32Array(n), sourceR = new Float32Array(n);
  for(let i = 0; i < n; i++){
    const v = amp * Math.sin(2 * Math.PI * 500 * i / SAMPLE_RATE);
    sourceL[i] = v; sourceR[i] = v;
  }
  const buf = ctx.createBuffer(2, n, SAMPLE_RATE);
  buf.copyToChannel(sourceL, 0);
  buf.copyToChannel(sourceR, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;

  applyEQ(0);
  applyLoudnessNorm(0);
  applyMonoBalance(0);
  applyDeviceVolume(0);

  routeSource(src);
  src.start(0);

  const rendered = await ctx.startRendering();
  return estimateTruePeakDb([rendered.getChannelData(0), rendered.getChannelData(1)]);
}

export async function run(){
  const eqOffResidualDb = await nullTestEqOff();
  const eqOnZeroResidualDb = await nullTestEqOnEveryBandZero();
  const hotFileTruePeakDb = await hotFileStaysUnderCeiling();

  const checks = [
    { name: 'Pure, EQ off, normalization off: residual below -100dBFS', value: eqOffResidualDb, pass: eqOffResidualDb < -100 },
    { name: 'Pure, EQ on with every band at 0 (graphic + parametric): residual below -100dBFS', value: eqOnZeroResidualDb, pass: eqOnZeroResidualDb < -100 },
    { name: 'a +6dB-hot file with normalization on: true peak never above -1dBTP', value: hotFileTruePeakDb, pass: hotFileTruePeakDb <= -1 + 1e-2 },
  ];
  return { checks, pass: checks.every(c => c.pass) };
}
