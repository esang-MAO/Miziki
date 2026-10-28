// PL8 item 12 (docs/19_PLAYER.md): "Measure the defaults (render tests,
// WebKit and Chromium): frequency response of the full Vinyl chain on a
// sweep; THD+N and harmonic profile of a 1kHz sine at -1dBFS and -20dBFS;
// wow and flutter in % (weighted RMS) from a 3150Hz tone; how often and
// how deep the compressor acts on a dynamic test track. Record them in
// docs/perf/BASELINE.md."
//
// Measurement only -- no production code change. This is the "before"
// picture items 13/14 retune against.
//
// WebKit note: unlike pl8-resample-quality.js (browser-implementation-
// defined resampling), every node this chain uses -- BiquadFilterNode,
// WaveShaperNode (we supply the curve ourselves), DynamicsCompressorNode
// -- has an exact algorithm fixed by the Web Audio spec, so Chromium and
// WebKit should measure the same chain near-identically here. Still
// Chromium-only in this container (WebKit can't be installed -- see
// pl8-resample-quality.js's header for why) but with a materially
// different, weaker, reason to doubt it transfers.
import { S } from '../../../src/state.js';
import { buildGraph, routeSource, applyCharacter, applyEQ, applyLoudnessNorm, applyMonoBalance, applyDeviceVolume } from '../../../src/audio/engine.js';
import { defaultEqState } from '../../../src/audio/eq.js';
import { linearToDb } from '../../../src/audio/loudness.js';

const SAMPLE_RATE = 44100;
const DEFAULT_CHAR = { wow: 0.30, sat: 0.35, soft: 0.40, comp: 0.35 }; // today's shipped defaults

function resetS(){
  S.mode = 'vinyl';
  S.rate = 1;
  S.recordFormat = null; // falls back to 33 RPM
  S.char = { ...DEFAULT_CHAR };
  S.charDrift = 'off';
  S.mono = false;
  S.balance = 0;
  S.deviceVolume = 1;
  S.loudnessMode = 'off';
  S.eq = defaultEqState();
  S.tracks = [];
  S.index = 0;
  S.queue = [];
  S.shuffle = false;
}

function projectAtFrequency(signal, freqHz, sampleRate){
  const n = signal.length;
  const w = (2 * Math.PI * freqHz) / sampleRate;
  let c = 0, s = 0;
  for(let i = 0; i < n; i++){ c += signal[i] * Math.cos(w * i); s += signal[i] * Math.sin(w * i); }
  c *= 2 / n; s *= 2 / n;
  return { c, s, amplitude: Math.hypot(c, s) };
}

function residualDb(signal, freqHz, sampleRate){
  const { c, s } = projectAtFrequency(signal, freqHz, sampleRate);
  const w = (2 * Math.PI * freqHz) / sampleRate;
  let sumSqResidual = 0, sumSqFundamental = 0;
  for(let i = 0; i < signal.length; i++){
    const fundamental = c * Math.cos(w * i) + s * Math.sin(w * i);
    const residual = signal[i] - fundamental;
    sumSqResidual += residual * residual; sumSqFundamental += fundamental * fundamental;
  }
  return linearToDb(Math.sqrt(sumSqResidual / signal.length) / Math.sqrt(sumSqFundamental / signal.length));
}

async function buildChain(mode, { disableComp = false } = {}){
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  S.ctx = ctx;
  S.nodes = await buildGraph(ctx);
  S.mode = mode;
  applyCharacter(0);
  applyEQ(0);
  applyLoudnessNorm(0);
  applyMonoBalance(0);
  applyDeviceVolume(0);
  if(disableComp){
    // isolate the compressor's own dynamic action, holding makeup (keyed
    // on c.comp, already set by applyCharacter() above) fixed -- NOT
    // bypassStage()'s shape, which also resets makeup to 1.
    S.nodes.comp.threshold.setTargetAtTime(0, ctx.currentTime, 0);
    S.nodes.comp.ratio.setTargetAtTime(1, ctx.currentTime, 0);
  }
  return ctx;
}

async function renderTone(mode, freqHz, amplitude, durationSec, { settleSec = 0.3, disableComp = false, charOverride = null } = {}){
  resetS();
  if(charOverride) S.char = { ...S.char, ...charOverride };
  const bufferN = Math.round(SAMPLE_RATE * (settleSec + durationSec));
  const ctx = new OfflineAudioContext(2, bufferN + 64, SAMPLE_RATE);
  S.ctx = ctx;
  S.nodes = await buildGraph(ctx);
  S.mode = mode;
  applyCharacter(0);
  applyEQ(0);
  applyLoudnessNorm(0);
  applyMonoBalance(0);
  applyDeviceVolume(0);
  if(disableComp){
    S.nodes.comp.threshold.setTargetAtTime(0, ctx.currentTime, 0);
    S.nodes.comp.ratio.setTargetAtTime(1, ctx.currentTime, 0);
  }
  const n = Math.round(SAMPLE_RATE * (settleSec + durationSec));
  const src = new Float32Array(n);
  for(let i = 0; i < n; i++) src[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE);
  const buf = ctx.createBuffer(2, n, SAMPLE_RATE);
  buf.copyToChannel(src, 0); buf.copyToChannel(src, 1);
  const node = ctx.createBufferSource();
  node.buffer = buf;
  routeSource(node);
  node.start(0);
  const rendered = await ctx.startRendering();
  const full = rendered.getChannelData(0);
  const settleN = Math.round(SAMPLE_RATE * settleSec);
  return full.slice(settleN, settleN + Math.round(SAMPLE_RATE * durationSec));
}

// ---- 1. Frequency response of the full Vinyl chain, 0dB referenced to
// its own 1kHz point (so pad/makeup's overall level offset doesn't show
// up as "non-flatness" -- only the chain's own frequency-dependent shape
// does, which is what items 13/14's targets are about).
//
// wow=0 for this measurement specifically: wow/flutter is delay (phase)
// modulation, not an amplitude/tonal effect, so it doesn't change how
// much energy a tone has -- it redistributes some of that energy into FM
// sidebands around the tone's own frequency (phase deviation grows with
// frequency for a fixed delay-time deviation, same reason FM sideband
// spread grows with carrier frequency). A single-bin projection only sees
// the carrier bin, so it reads that redistribution as a bogus, frequency-
// dependent "attenuation" that has nothing to do with the chain's actual
// tonal shaping (confirmed by isolating each stage: wow alone measured
// -14.6dB "rolloff" at 15kHz with sat/soft/comp all off, which cannot be
// real given wow's own gain nodes are tiny fractions of a sample of delay
// variation). Wow & flutter has its own dedicated measurement below;
// mixing the two here would make neither number mean anything.
const RESPONSE_FREQS_HZ = [30, 100, 300, 1000, 3000, 7000, 10000, 15000, 20000];
const RESPONSE_PROBE_AMPLITUDE = 0.1; // -20dBFS: quiet enough that the compressor barely engages

async function measureFrequencyResponse(){
  const levels = {};
  for(const freqHz of RESPONSE_FREQS_HZ){
    const analysis = await renderTone('vinyl', freqHz, RESPONSE_PROBE_AMPLITUDE, 1.0, { charOverride: { wow: 0 } });
    levels[freqHz] = linearToDb(projectAtFrequency(analysis, freqHz, SAMPLE_RATE).amplitude / RESPONSE_PROBE_AMPLITUDE);
  }
  const ref = levels[1000];
  return RESPONSE_FREQS_HZ.map(freqHz => ({ freqHz, relativeDb: levels[freqHz] - ref }));
}

// ---- 2. THD+N and harmonic profile of a 1kHz sine, full chain (sat + dc
// + tone + comp), at two levels. wow=0 here too -- same reasoning as the
// frequency-response measurement above: wow's own FM sidebands would
// otherwise land in the "+N" residual bucket and muddy a number this doc
// specifically wants attributed to saturation's harmonic profile.
async function measureThdAndHarmonics(amplitude, label){
  const analysis = await renderTone('vinyl', 1000, amplitude, 1.0, { settleSec: 1.0, charOverride: { wow: 0 } }); // long settle: comp release = 260ms
  const fundamentalDb = linearToDb(projectAtFrequency(analysis, 1000, SAMPLE_RATE).amplitude / amplitude);
  const h2Db = linearToDb(projectAtFrequency(analysis, 2000, SAMPLE_RATE).amplitude / amplitude) - fundamentalDb;
  const h3Db = linearToDb(projectAtFrequency(analysis, 3000, SAMPLE_RATE).amplitude / amplitude) - fundamentalDb;
  const thdNDb = residualDb(analysis, 1000, SAMPLE_RATE);
  return { label, thdNDb, h2Db, h3Db };
}

// ---- 3. Wow & flutter, simplified: zero-crossing instantaneous-frequency
// tracking on a 3150Hz tone (the chain's own wowOsc 0.556Hz + flutOsc
// 6.3Hz FM, via the wobble DelayNode). Linear-interpolated sub-sample
// crossing times for sub-Hz resolution. This is a plain RMS of the %
// frequency deviation across all detected cycles -- not the IEC-weighted
// standard (which band-limits and weights the deviation spectrum, peaking
// near 4Hz); documented here as a simplified proxy, not a certified
// wow-and-flutter-meter number.
async function measureWowFlutter(){
  const NOMINAL_HZ = 3150;
  const analysis = await renderTone('vinyl', NOMINAL_HZ, 0.3, 3.0, { settleSec: 0.3 });
  const crossings = [];
  for(let i = 1; i < analysis.length; i++){
    if(analysis[i - 1] < 0 && analysis[i] >= 0){
      const frac = -analysis[i - 1] / (analysis[i] - analysis[i - 1]);
      crossings.push((i - 1 + frac) / SAMPLE_RATE);
    }
  }
  const periods = [];
  for(let i = 1; i < crossings.length; i++) periods.push(crossings[i] - crossings[i - 1]);
  const instFreqs = periods.map(p => 1 / p);
  const deviationsPct = instFreqs.map(f => ((f - NOMINAL_HZ) / NOMINAL_HZ) * 100);
  const rmsPct = Math.sqrt(deviationsPct.reduce((sum, d) => sum + d * d, 0) / deviationsPct.length);
  const peakPct = Math.max(...deviationsPct.map(Math.abs));
  return { rmsPct, peakPct, cyclesMeasured: deviationsPct.length };
}

// ---- 4. Compressor gain reduction on a dynamic test track: alternating
// quiet (-20dBFS) / loud (-6dBFS) 1kHz segments, long enough per segment
// for attack (12ms) and release (260ms) to settle. GR = how much quieter
// the loud segment is WITH the compressor than WITHOUT it, at the same
// makeup gain (so only the dynamic action itself is being measured).
const SEGMENT_SEC = 0.6;
const SEGMENTS = [-20, -6, -20, -6]; // dBFS, alternating
const MEASURE_SEGMENT_INDEX = 3; // last loud segment -- fully settled either way by then

async function renderDynamicTrack(disableComp){
  resetS();
  const totalSec = SEGMENT_SEC * SEGMENTS.length;
  const n = Math.round(SAMPLE_RATE * totalSec);
  const ctx = new OfflineAudioContext(2, n + 64, SAMPLE_RATE);
  S.ctx = ctx;
  S.nodes = await buildGraph(ctx);
  S.mode = 'vinyl';
  applyCharacter(0);
  applyEQ(0);
  applyLoudnessNorm(0);
  applyMonoBalance(0);
  applyDeviceVolume(0);
  if(disableComp){
    S.nodes.comp.threshold.setTargetAtTime(0, ctx.currentTime, 0);
    S.nodes.comp.ratio.setTargetAtTime(1, ctx.currentTime, 0);
  }
  const src = new Float32Array(n);
  for(let seg = 0; seg < SEGMENTS.length; seg++){
    const amp = Math.pow(10, SEGMENTS[seg] / 20);
    const start = Math.round(seg * SEGMENT_SEC * SAMPLE_RATE);
    const end = Math.round((seg + 1) * SEGMENT_SEC * SAMPLE_RATE);
    for(let i = start; i < end && i < n; i++) src[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
  }
  const buf = ctx.createBuffer(2, n, SAMPLE_RATE);
  buf.copyToChannel(src, 0); buf.copyToChannel(src, 1);
  const node = ctx.createBufferSource();
  node.buffer = buf;
  routeSource(node);
  node.start(0);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

async function measureCompressorGainReduction(){
  const withComp = await renderDynamicTrack(false);
  const withoutComp = await renderDynamicTrack(true);
  // measure the back half of the chosen segment, well clear of its own attack edge
  const segStart = MEASURE_SEGMENT_INDEX * SEGMENT_SEC;
  const measureStart = segStart + SEGMENT_SEC * 0.5;
  const measureLen = SEGMENT_SEC * 0.4;
  const rms = (data, startSec, lenSec) => {
    const start = Math.round(startSec * SAMPLE_RATE), end = Math.round((startSec + lenSec) * SAMPLE_RATE);
    let sum = 0;
    for(let i = start; i < end; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / (end - start));
  };
  const withDb = linearToDb(rms(withComp, measureStart, measureLen));
  const withoutDb = linearToDb(rms(withoutComp, measureStart, measureLen));
  return { gainReductionDb: withoutDb - withDb, withDb, withoutDb };
}

export async function run(){
  const response = await measureFrequencyResponse();
  const thdLoud = await measureThdAndHarmonics(Math.pow(10, -1 / 20), '-1dBFS');
  const thdQuiet = await measureThdAndHarmonics(Math.pow(10, -20 / 20), '-20dBFS');
  const wowFlutter = await measureWowFlutter();
  const compGr = await measureCompressorGainReduction();

  const worstResponseDeviation = Math.max(...response.filter(r => r.freqHz <= 15000).map(r => Math.abs(r.relativeDb)));
  const at20k = response.find(r => r.freqHz === 20000).relativeDb;

  const checks = [
    {
      name: 'baseline: Vinyl chain frequency response, relative to its own 1kHz (measurement only -- no pass/fail target yet, that is item 13)',
      value: worstResponseDeviation,
      pass: true,
      detail: response.map(r => `${r.freqHz}Hz: ${r.relativeDb >= 0 ? '+' : ''}${r.relativeDb.toFixed(2)}dB`)
        .concat([`30Hz-15kHz worst deviation: ${worstResponseDeviation.toFixed(2)}dB (item 13 target: <=1dB)`, `20kHz: ${at20k.toFixed(2)}dB (item 13 target: >=-2dB)`]),
    },
    {
      name: 'baseline: THD+N and 2nd/3rd harmonic profile at -1dBFS and -20dBFS (measurement only)',
      value: thdLoud.thdNDb,
      pass: true,
      detail: [thdLoud, thdQuiet].map(r => `${r.label}: THD+N ${r.thdNDb.toFixed(2)}dB, H2 ${r.h2Db.toFixed(2)}dB rel. fundamental, H3 ${r.h3Db.toFixed(2)}dB rel. fundamental`)
        .concat(['item 13 target: <0.3% THD at -1dBFS (-50.5dB), low-order (H2-dominant) only']),
    },
    {
      name: 'baseline: wow & flutter, simplified zero-crossing RMS % deviation at 3150Hz (measurement only, not IEC-weighted)',
      value: wowFlutter.rmsPct,
      pass: true,
      detail: [`RMS ${wowFlutter.rmsPct.toFixed(4)}%, peak ${wowFlutter.peakPct.toFixed(4)}%, over ${wowFlutter.cyclesMeasured} cycles`, 'item 13 target: ~0.03% weighted RMS (this is an unweighted proxy, not directly comparable 1:1)'],
    },
    {
      name: 'baseline: compressor gain reduction on alternating -20/-6dBFS program material (measurement only)',
      value: compGr.gainReductionDb,
      pass: true,
      detail: [`${compGr.gainReductionDb.toFixed(2)}dB GR on the loud segment (with-comp ${compGr.withDb.toFixed(2)}dBFS vs without-comp ${compGr.withoutDb.toFixed(2)}dBFS)`, 'item 13 target: <=1-2dB GR on normal material'],
    },
  ];
  return { checks, pass: checks.every(c => c.pass) };
}
