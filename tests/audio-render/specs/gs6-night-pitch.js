// GS6 (docs/30_GROOVES_AND_SHELF.md): offline-render proof for the
// Slowed/Keep-pitch split this PR introduces -- S.rate (the real audio
// rate, computeRate()) vs S.platterRate (the platter's own on-screen
// spin, computePlatterRate(), which always follows the Sundown curve
// regardless of nightPitch). Rule 11 (CLAUDE.md): an audio PR proves its
// claim against a real OfflineAudioContext, not just the return value of
// computeRate() -- this renders an AudioBufferSourceNode at the rate each
// mode actually returns and measures the real output pitch.
import { S } from '../../../src/state.js';
import { computeRate, computePlatterRate } from '../../../src/sundown/solar.js';

const SAMPLE_RATE = 48000;
const TONE_HZ = 1000;
const TARGET = 0.80; // DEPTH_TARGETS.medium
const DURATION_SEC = 1.2;
const ANALYSIS_SEC = 1.0; // exact 1Hz bin spacing -- TONE_HZ and TONE_HZ*TARGET both land on an integer bin
const SETTLE_SEC = 0.1;

// Same exact single-bin DFT as pl8-resample-quality.js.
function projectAtFrequency(signal, freqHz, sampleRate){
  const n = signal.length;
  const w = (2 * Math.PI * freqHz) / sampleRate;
  let c = 0, s = 0;
  for(let i = 0; i < n; i++){
    c += signal[i] * Math.cos(w * i);
    s += signal[i] * Math.sin(w * i);
  }
  c *= 2 / n; s *= 2 / n;
  return Math.hypot(c, s);
}

async function renderAtRate(rate){
  const ctx = new OfflineAudioContext(1, Math.round(SAMPLE_RATE * DURATION_SEC), SAMPLE_RATE);
  // Generous buffer length regardless of rate -- a slower rate consumes
  // fewer source samples per real second, so Math.max(1, rate) already
  // covers the slowed case too.
  const bufLen = Math.round(SAMPLE_RATE * DURATION_SEC * Math.max(1, rate) + SAMPLE_RATE);
  const buf = ctx.createBuffer(1, bufLen, SAMPLE_RATE);
  const data = buf.getChannelData(0);
  for(let i = 0; i < data.length; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(ctx.destination);
  src.start(0);
  const rendered = await ctx.startRendering();
  const full = rendered.getChannelData(0);
  const settleN = Math.round(SAMPLE_RATE * SETTLE_SEC);
  const analysisN = Math.round(SAMPLE_RATE * ANALYSIS_SEC);
  return full.slice(settleN, settleN + analysisN);
}

// Same sun/target shape as tests/unit/solar.test.js's pastDusk fixture --
// well past dusk, fully settled at the target rate.
function setNightWindow(target){
  const now = Date.now();
  S.mode = 'vinyl'; S.auto = true; S.target = target; S.pace = 'window'; S.previewMin = 0;
  S.sun = { lat: 39.20, lon: -76.86, set: new Date(now - 60 * 60000), dusk: new Date(now - 30 * 60000), ok: true };
}

export async function run(){
  setNightWindow(TARGET);
  S.nightPitch = 'true'; // Keep pitch
  const keepRate = computeRate();
  const keepPlatterRate = computePlatterRate();
  const keepSignal = await renderAtRate(keepRate);
  const keepAtTrue = projectAtFrequency(keepSignal, TONE_HZ, SAMPLE_RATE);
  const keepAtSlowed = projectAtFrequency(keepSignal, TONE_HZ * TARGET, SAMPLE_RATE);

  setNightWindow(TARGET);
  S.nightPitch = 'slowed';
  const slowedRate = computeRate();
  const slowedPlatterRate = computePlatterRate();
  const slowedSignal = await renderAtRate(slowedRate);
  const slowedAtTrue = projectAtFrequency(slowedSignal, TONE_HZ, SAMPLE_RATE);
  const slowedAtSlowed = projectAtFrequency(slowedSignal, TONE_HZ * TARGET, SAMPLE_RATE);

  const checks = [
    { name: 'Keep pitch: computeRate() is exactly 1 during a night window', value: keepRate, pass: keepRate === 1 },
    { name: 'Keep pitch: computePlatterRate() still follows the curve (target 0.80)', value: keepPlatterRate, pass: Math.abs(keepPlatterRate - TARGET) < 0.0001 },
    { name: 'Keep pitch: the rendered tone stays at its true 1000Hz pitch', value: keepAtTrue, pass: keepAtTrue > 0.3 },
    { name: 'Keep pitch: no energy shows up at the slowed 800Hz bin', value: keepAtSlowed, pass: keepAtSlowed < 0.05 },
    { name: 'Slowed: computeRate() equals the target rate (0.80)', value: slowedRate, pass: Math.abs(slowedRate - TARGET) < 0.0001 },
    { name: 'Slowed: computePlatterRate() matches computeRate() (both follow the curve)', value: slowedPlatterRate, pass: Math.abs(slowedPlatterRate - slowedRate) < 0.0001 },
    { name: "Slowed: the rendered tone's pitch really drops to 800Hz", value: slowedAtSlowed, pass: slowedAtSlowed > 0.3 },
    { name: 'Slowed: no energy is left at the original 1000Hz', value: slowedAtTrue, pass: slowedAtTrue < 0.05 },
  ];
  return { checks, pass: checks.every(c => c.pass) };
}
