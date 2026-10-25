import { S } from '../state.js';
import { applyVolume } from '../sundown/location.js';
import { applyOutputRoute } from '../player/background.js';
import { nowClock } from '../sundown/solar.js';
import { effectiveCharAt } from '../sundown/arc.js';
import { makeupGainFor } from './level-match.js';

// AU3 (docs/16_AUDIO.md §2.3): "wowOsc.frequency = (rpm / 60) × S.rate" —
// 0.556 Hz at 33⅓ and full speed. Matches the 33.333 RPM readout constant
// player/transport.js's own arc-text line already uses.
const RPM_33 = 33.333;
const wowHzFor = rate => (RPM_33 / 60) * (rate || 1);

// AU3 §2.3: "a -3dB pad in front of the Vinyl chain, made up after the
// compressor" — a fixed linear gain, never touched by applyCharacter().
const PAD_DB = -3;
const PAD_GAIN = Math.pow(10, PAD_DB / 20);

const LIMITER_WORKLET_URL = new URL('./limiter-processor.js', import.meta.url);
let limiterModuleLoadedCtx = null;

async function ensureLimiterModule(ctx){
  if(limiterModuleLoadedCtx === ctx) return true;
  if(!ctx.audioWorklet) return false;
  try{
    await ctx.audioWorklet.addModule(LIMITER_WORKLET_URL);
    limiterModuleLoadedCtx = ctx;
    return true;
  }catch(err){
    console.warn('Limiter worklet unavailable; output stage falls back to an unlimited passthrough.', err);
    return false;
  }
}

/* ================= audio graph ================= */
// AU3 (docs/16_AUDIO.md §2.3): "create the AudioContext once, at the
// device's own rate (no sampleRate option), and never rebuild it for a
// track" — decodeAudioData resamples to the context's own rate regardless,
// so there's nothing to gain by matching a file's own rate at creation.
export function makeContext(){
  const AC = window.AudioContext || window.webkitAudioContext;
  return new AC();
}

// AU3 §1: the output stage ends `master -> limiter -> out`. norm/preamp/EQ
// bands/mono-balance/volume (also §1) are each a later PR's own node,
// inserted between master and limiter once they exist — n.out is the one
// stable attachment point applyOutputRoute() needs, so none of those
// future insertions will ever require retargeting background routing
// again. Async because loading the limiter's AudioWorklet module is.
export async function buildGraph(ctx){
  const n = {};
  // mechanical: platter wobble as modulated delay -> real pitch variation
  n.wobble = ctx.createDelay(0.05); n.wobble.delayTime.value = 0.012;
  n.wowOsc = ctx.createOscillator(); n.wowOsc.frequency.value = wowHzFor(S.rate);
  n.wowAmt = ctx.createGain();
  n.flutOsc = ctx.createOscillator(); n.flutOsc.frequency.value = 6.3;
  n.flutAmt = ctx.createGain();
  n.wowOsc.connect(n.wowAmt).connect(n.wobble.delayTime);
  n.flutOsc.connect(n.flutAmt).connect(n.wobble.delayTime);
  n.wowOsc.start(); n.flutOsc.start();
  // electrical colorations
  n.sat = ctx.createWaveShaper(); n.sat.oversample = '4x';
  n.satTrim = ctx.createGain();
  n.dc = ctx.createBiquadFilter(); n.dc.type='highpass'; n.dc.frequency.value=14; n.dc.Q.value=0.7;
  n.tone = ctx.createBiquadFilter(); n.tone.type='highshelf'; n.tone.frequency.value=7000; n.tone.gain.value=0;
  n.comp = ctx.createDynamicsCompressor();
  n.comp.knee.value = 12; n.comp.attack.value = 0.012; n.comp.release.value = 0.26;
  n.makeup = ctx.createGain();
  n.master = ctx.createGain(); n.master.gain.value = 1;
  // docs/15_SURFACE_NOISE.md §3 (needle-lift skipping): a single
  // always-present gain node the current track's source alone passes
  // through, upstream of wobble/master, so a skip can fade *just the
  // music* over 80ms without touching the Surface Noise sounds that join
  // the chain at n.wobble (src/audio/surface-noise.js's startBuffer()) --
  // those keep playing at full volume through the lift. routeSource()
  // below is the only thing that (re)connects it.
  n.trackGain = ctx.createGain(); n.trackGain.gain.value = 1;

  // AU3 §2.3: a -3dB pad in front of the Vinyl chain, permanently wired
  // ahead of wobble the same way every other Vinyl-chain node already is
  // — routeSource() below is the only thing that connects trackGain to it
  // (Vinyl) or straight to master (Pure).
  n.pad = ctx.createGain(); n.pad.gain.value = PAD_GAIN;
  n.pad.connect(n.wobble);

  n.wobble.connect(n.sat).connect(n.satTrim).connect(n.dc).connect(n.tone).connect(n.comp).connect(n.makeup).connect(n.master);

  n.limiter = null;
  if(await ensureLimiterModule(ctx)){
    try{
      n.limiter = new AudioWorkletNode(ctx, 'limiter-processor', {numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2]});
    }catch(err){
      console.warn('Limiter node unavailable; output stage falls back to an unlimited passthrough.', err);
      n.limiter = null;
    }
  }
  n.out = ctx.createGain(); n.out.gain.value = 1;
  if(n.limiter) n.master.connect(n.limiter).connect(n.out);
  else n.master.connect(n.out);
  n.out.connect(ctx.destination);
  return n;
}

export function satCurve(amount){
  const N = 2049, c = new Float32Array(N);
  if(amount < 0.005){ for(let i=0;i<N;i++) c[i] = (i*2)/(N-1) - 1; return {curve:c, trim:1}; }
  // gentle soft clip blended with the dry signal; the x² term is the asymmetry
  // that makes even harmonics rather than the harsher odd-order kind
  const mix = amount*0.8, k = 1 + amount*2.2, asym = amount*0.18, norm = Math.tanh(k);
  for(let i=0;i<N;i++){
    const x = (i*2)/(N-1) - 1;
    c[i] = (1 - mix)*x + mix * Math.tanh(k*(x + asym*x*x)) / norm;
  }
  return {curve:c, trim: 1/(1 + amount*0.5)};
}

// DA2 (docs/DAY_ARC.md): the one effective-value gate for the whole day
// arc's character drift, the same single-place shape F1's own Pure-rate
// rule has in solar.js's computeRate() — Pure means untouched, so drift is
// forced to 'off' before intensity is even read, regardless of S.charDrift,
// rather than relying only on routeSource() bypassing these nodes in Pure:
// a slider moved (or a mode switch back to Vinyl) while in Pure should
// never leave a drifted value sitting on a node Pure doesn't even route
// through, waiting to surprise the next Vinyl switch.
//
// Day Arc v2 (DAY_ARC_BRIEF.md, PR 3): the effective value now comes from
// arc.js's effectiveCharAt() (warmth-based, §3.4) instead of drift.js's
// effectiveChar() (DA2's 7-phase anchor table) — same gate, same S.charDrift
// setting (reused per Q1: the Sound view's own control is relabeled
// Off/Subtle/Full rather than borrowing the "Pure" name), new source model.
// nowClock() (not a bare currentDayPosition()/`new Date()`) is what keeps
// Preview the day audible here, same reasoning as solar.js's computeRate().
// Known, accepted gap until the new Sound view ships (brief §8 PR 6): the
// *old* Sundown/Character screen's own per-slider "now" badge (clock.js's
// drawSun(), still reading drift.js's effectiveChar()) no longer matches
// what's actually audible — the same class of temporary UI/audio
// discrepancy already accepted in PR 2 for the rate readout, until the
// screens that show it are themselves replaced.
//
// `ramp` defaults to the same 50ms every existing call site here already
// used before DA2 (a slider drag, a preset click, a mode switch, restoring
// saved prefs) — none of those should suddenly feel sluggish just because
// drift now rides along with them. src/wiring/character.js's own ~30s
// drift-recompute timer (the one new call site DA2 adds) passes a longer
// ~2s time constant instead, per the doc's own "ramping with a longer time
// constant, so the drift is never audible as a change" — that line is
// about the drift's own slow background movement, not about making a
// direct user edit laggy.
let lastAppliedSat = null;

// RF28 ("what am I hearing"): Sound › Advanced's press-and-hold audition
// controls. `auditioning` is non-null only while a hold is actually in
// progress — applyCharacter() no-ops while it's set, so neither the ~30s
// drift recompute (scheduleDriftRecompute(), below) nor a slider dragged
// with a different finger can quietly undo the bypass mid-hold. Release
// clears it and calls applyCharacter() once, which is the only "restore"
// this needs: it reads whatever the sliders/drift/mode say *right now*,
// never a remembered snapshot, so nothing can go stale while held.
let auditioning = null;
const STAGE_KEYS = ['wow', 'sat', 'soft', 'comp'];

function bypassStage(stage, ramp){
  if(!S.nodes) return;
  const n = S.nodes, t = S.ctx.currentTime;
  if(stage === 'wow'){
    n.wowAmt.gain.setTargetAtTime(0, t, ramp);
    n.flutAmt.gain.setTargetAtTime(0, t, ramp);
  } else if(stage === 'sat'){
    const s = satCurve(0);
    n.sat.curve = s.curve;
    n.satTrim.gain.setTargetAtTime(s.trim, t, ramp);
    lastAppliedSat = 0;
  } else if(stage === 'soft'){
    n.tone.gain.setTargetAtTime(0, t, ramp);
  } else if(stage === 'comp'){
    n.comp.threshold.setTargetAtTime(0, t, ramp);
    n.comp.ratio.setTargetAtTime(1, t, ramp);
    n.makeup.gain.setTargetAtTime(1, t, ramp);
  }
}

const AUDITION_RAMP = 0.02;

// Held: every stage except `stage` reads as fully untouched; `stage`
// itself is left exactly as applyCharacter() last set it.
export function auditionStageAlone(stage){
  if(!S.nodes || !STAGE_KEYS.includes(stage)) return;
  auditioning = stage;
  for(const k of STAGE_KEYS) if(k !== stage) bypassStage(k, AUDITION_RAMP);
}

// Held: the whole chain reads as untouched — the per-stage holds above,
// all four at once. Scoped to coloration only (this is Sound's own
// "what am I hearing", not Sundown's rate) — Pure's own rate-always-1
// rule (solar.js's computeRate()) is untouched by this.
export function auditionComparePure(){
  if(!S.nodes) return;
  auditioning = 'pure';
  for(const k of STAGE_KEYS) bypassStage(k, AUDITION_RAMP);
}

export function releaseAudition(){
  if(auditioning === null) return;
  auditioning = null;
  applyCharacter(AUDITION_RAMP);
}

export function applyCharacter(ramp = 0.05){
  if(!S.nodes || !S.ctx || auditioning !== null) return;
  const n = S.nodes, t = S.ctx.currentTime;
  const intensity = S.mode === 'pure' ? 'off' : S.charDrift;
  const c = effectiveCharAt(S.char, nowClock(), S.sun, intensity);
  n.wowAmt.gain.setTargetAtTime(0.00050 * c.wow, t, ramp);
  n.flutAmt.gain.setTargetAtTime(0.000015 * c.wow, t, ramp);
  // satCurve() builds a brand-new Float32Array every call — only worth it
  // once the effective value has actually moved enough to matter, per the
  // doc's own "only rebuild when the effective sat moves by more than
  // 0.005" instruction; satTrim's own gain still glides every call either
  // way, since that's a cheap setTargetAtTime, not a curve rebuild.
  if(lastAppliedSat === null || Math.abs(c.sat - lastAppliedSat) > 0.005){
    const s = satCurve(c.sat);
    n.sat.curve = s.curve;
    n.satTrim.gain.setTargetAtTime(s.trim, t, ramp);
    lastAppliedSat = c.sat;
  }
  n.tone.gain.setTargetAtTime(-9 * c.soft, t, ramp);
  n.comp.threshold.setTargetAtTime(-6 - 18*c.comp, t, ramp);
  n.comp.ratio.setTargetAtTime(1 + 3*c.comp, t, ramp);
  // AU3 §2.3 (finding 4): the old `1 + 0.4*c.comp` here, on top of
  // DynamicsCompressorNode's own automatic makeup gain and the pad's own
  // -3dB, is why Vinyl played louder than Pure. makeupGainFor() is the
  // offline-derived table (scripts/derive-makeup-table.mjs) that instead
  // lands Vinyl within 0.5dB of Pure's own integrated loudness at every
  // Character setting — it already accounts for the pad, so nothing here
  // needs to compensate for PAD_GAIN separately.
  n.makeup.gain.setTargetAtTime(makeupGainFor(c), t, ramp);
}

export function routeSource(src){
  src.disconnect();
  src.connect(S.nodes.trackGain);
  S.nodes.trackGain.disconnect();
  S.nodes.trackGain.connect(S.mode === 'pure' ? S.nodes.master : S.nodes.pad);
}

// AU3 §2.3: "updated wherever S.rate changes" — player/clock.js's tick()
// is the one place S.rate is ever reassigned.
export function applyWobbleRate(rate){
  if(!S.nodes || !S.ctx) return;
  S.nodes.wowOsc.frequency.setTargetAtTime(wowHzFor(rate), S.ctx.currentTime, 0.08);
}

// DA2 (docs/DAY_ARC.md): "recompute about every 30s" — called once from
// main.js's boot sequence, the same "set it up once, the function re-arms
// on its own" shape sundown/location.js's scheduleMidnightRecompute() has,
// just on a plain setInterval rather than a recursive setTimeout, since
// there's no wall-clock boundary to stay anchored to here the way midnight
// is — "about every 30s" tolerates ordinary setInterval drift just fine.
// Passes the slow ~2s ramp (applyCharacter()'s own default stays the fast
// 50ms every pre-existing call site already used) — this is drift moving
// on its own, not a direct user edit, so it's exactly the kind of change
// the doc's own "never audible as a change" instruction is about.
export function scheduleDriftRecompute(){
  setInterval(() => applyCharacter(2), 30000);
}

// AU3 §2.3: "create the AudioContext once... and never rebuild it for a
// track" — this used to close and recreate S.ctx whenever a file's own
// rate differed from the context's (finding 2: a gap, a possible click,
// and every node reset). Now it only ever builds once, lazily, the first
// time anything needs a context, and resumes it every other time.
export async function ensureContext(){
  if(S.ctx){ await S.ctx.resume(); return; }
  // A fresh context means fresh nodes — any in-progress audition hold
  // belonged to the old graph and can't mean anything here.
  auditioning = null;
  S.ctx = makeContext();
  S.nodes = await buildGraph(S.ctx);
  applyCharacter();
  applyVolume();
  applyOutputRoute();
  await S.ctx.resume();
}
