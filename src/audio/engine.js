import { S, current } from '../state.js';
import { applyVolume } from '../sundown/location.js';
import { applyOutputRoute } from '../player/background.js';
import { nowClock } from '../sundown/solar.js';
import { effectiveCharAt } from '../sundown/arc.js';
import { makeupGainFor } from './level-match.js';
import { albumKey } from '../record-art/tiers.js';
import { trackGainDb, albumGainDb, clampGainDbForPeak, dbToLinear } from './loudness.js';
import {
  GRAPHIC_BANDS_HZ, GRAPHIC_BAND_Q, TILT_PIVOT_HZ, MAX_PARAMETRIC_BANDS,
  PARAMETRIC_GAIN_TYPES, autoPreampDbFromPeak, combineDbCurve,
  sampleFrequenciesLog, clampTiltDb, clampGraphicBandDb, clampPreampDb,
  defaultEqState,
} from './eq.js';

// AU3 (docs/16_AUDIO.md §2.3): "wowOsc.frequency = (rpm / 60) × S.rate" —
// 0.556 Hz at 33⅓ and full speed. Matches the 33.333 RPM readout constant
// player/transport.js's own arc-text line already uses.
const RPM_33 = 33.333;
const wowHzFor = rate => (RPM_33 / 60) * (rate || 1);

// AU7 (docs/16_AUDIO.md §6): balance is a plain -1..1 (full left .. full
// right); deviceVolume is a plain 0..1 — both clamped the same defensive
// way every other saved numeric setting in this file's own chain is
// (clampTiltDb/clampPreampDb, eq.js), so a malformed or out-of-range saved
// value can never read back as something the UI itself could never reach.
const clampBalance = v => Math.max(-1, Math.min(1, typeof v === 'number' ? v : 0));
const clampDeviceVolume = v => Math.max(0, Math.min(1, typeof v === 'number' ? v : 1));

// The one caption both the Settings → Playback slider's own 'input'
// handler (src/wiring/character.js) and this module's restore-time sync
// (src/storage/meta.js's applyPrefs()) read, the same "one pure mapping,
// two callers" shape sundown/solar.js's depthCaptionFor already
// established for Sundown's own depth seg.
export function balanceCaptionFor(balance){
  const b = clampBalance(balance);
  if(Math.abs(b) < 0.02) return 'Center';
  const pct = Math.round(Math.abs(b) * 100);
  return (b < 0 ? 'L ' : 'R ') + pct + '%';
}

// AU3 §2.3: "a -3dB pad in front of the Vinyl chain, made up after the
// compressor" — a fixed linear gain, never touched by applyCharacter().
const PAD_DB = -3;
const PAD_GAIN = Math.pow(10, PAD_DB / 20);

// AU6 (docs/16_AUDIO.md §3): 'lowcut'/'highcut' are this app's own names
// for a biquad highpass/lowpass -- the two parametric band types whose
// own `gain` AudioParam is simply ignored by the Web Audio spec.
const BIQUAD_TYPE_FOR = { peak: 'peaking', lowshelf: 'lowshelf', highshelf: 'highshelf', lowcut: 'highpass', highcut: 'lowpass' };

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
// again (AU7 fills in the last two: mono-balance and volume). Async
// because loading the limiter's AudioWorklet module is.
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

  // AU5 (docs/16_AUDIO.md §4): "norm" — the one loudness-normalization gain
  // node, inserted between master and limiter exactly where AU3's own
  // comment above said a later PR's node would go. Applies in both modes
  // (§4: "Applies in both modes at norm in §1") — it's a level change
  // downstream of the Pure/Vinyl recording itself, the same category as the
  // sleep-timer fade/user volume, never a change to the recording.
  // applyLoudnessNorm() is what actually sets its gain.
  n.norm = ctx.createGain(); n.norm.gain.value = 1;

  // AU6 (docs/16_AUDIO.md §3): "master -> norm -> preamp -> EQ bands ->
  // mono/balance -> limiter -> volume -> out" — the preamp + EQ-band slot
  // AU5's own norm comment said a later PR would fill. Every gain-bearing
  // node here defaults to a flat response (shelf/peaking gain 0, or a
  // biquad 'allpass' type for an unused parametric slot, whose magnitude
  // response is unity at every frequency regardless of its own frequency/Q)
  // so the chain is inert the moment it's built — applyEQ() is what
  // actually makes it do anything, exactly like applyCharacter() for the
  // Vinyl chain above.
  n.eqPreamp = ctx.createGain(); n.eqPreamp.gain.value = 1;
  n.eqTiltLow = ctx.createBiquadFilter(); n.eqTiltLow.type = 'lowshelf'; n.eqTiltLow.frequency.value = TILT_PIVOT_HZ; n.eqTiltLow.gain.value = 0;
  n.eqTiltHigh = ctx.createBiquadFilter(); n.eqTiltHigh.type = 'highshelf'; n.eqTiltHigh.frequency.value = TILT_PIVOT_HZ; n.eqTiltHigh.gain.value = 0;
  n.eqGraphic = GRAPHIC_BANDS_HZ.map(hz => {
    const f = ctx.createBiquadFilter(); f.type = 'peaking'; f.frequency.value = hz; f.Q.value = GRAPHIC_BAND_Q; f.gain.value = 0;
    return f;
  });
  n.eqParametric = [];
  for(let i = 0; i < MAX_PARAMETRIC_BANDS; i++){
    const f = ctx.createBiquadFilter(); f.type = 'allpass'; f.frequency.value = 1000; f.Q.value = 0.7; f.gain.value = 0;
    n.eqParametric.push(f);
  }
  n.eqPreamp.connect(n.eqTiltLow).connect(n.eqTiltHigh);
  n.eqTail = n.eqTiltHigh;
  for(const f of [...n.eqGraphic, ...n.eqParametric]){ n.eqTail.connect(f); n.eqTail = f; }

  // A second, never-connected bank of the same filter shapes, used only to
  // measure the curve a *configuration* would produce (computeEqCurveDb(),
  // below) — kept separate from the live nodes above so drawing the curve,
  // or computing the auto-preamp offset, never has to touch (or glitch)
  // whatever is actually playing right now.
  n.eqScratch = {
    tiltLow: ctx.createBiquadFilter(), tiltHigh: ctx.createBiquadFilter(),
    graphic: GRAPHIC_BANDS_HZ.map(() => ctx.createBiquadFilter()),
    parametric: [],
  };
  n.eqScratch.tiltLow.type = 'lowshelf'; n.eqScratch.tiltLow.frequency.value = TILT_PIVOT_HZ;
  n.eqScratch.tiltHigh.type = 'highshelf'; n.eqScratch.tiltHigh.frequency.value = TILT_PIVOT_HZ;
  n.eqScratch.graphic.forEach((f, i) => { f.type = 'peaking'; f.frequency.value = GRAPHIC_BANDS_HZ[i]; f.Q.value = GRAPHIC_BAND_Q; });
  for(let i = 0; i < MAX_PARAMETRIC_BANDS; i++){
    const f = ctx.createBiquadFilter(); f.type = 'allpass'; f.frequency.value = 1000; f.Q.value = 0.7;
    n.eqScratch.parametric.push(f);
  }

  // AU7 (docs/16_AUDIO.md §6): "master -> norm -> preamp -> EQ bands ->
  // mono/balance -> limiter -> volume -> out" — the mono-balance slot §1
  // left for this PR. StereoPannerNode already does constant-power L/R
  // balance on a stereo signal natively, so there's nothing to build for
  // that half. Mono is a crossfade between two always-wired paths — a
  // "direct" pair (each channel straight to its own output) and a "sum"
  // pair (each channel split 50/50 into both outputs, i.e. (L+R)/2) —
  // rather than a dynamic reconnect, the same "flat when inactive" shape
  // AU6's own EQ bands already established: mono off leaves the direct
  // gains at 1 and the sum gains at 0, which is a plain, inert passthrough.
  n.balance = ctx.createStereoPanner(); n.balance.pan.value = 0;
  n.monoSplit = ctx.createChannelSplitter(2);
  n.monoMerge = ctx.createChannelMerger(2);
  n.monoDirL = ctx.createGain(); n.monoDirL.gain.value = 1;
  n.monoDirR = ctx.createGain(); n.monoDirR.gain.value = 1;
  n.monoSumL = ctx.createGain(); n.monoSumL.gain.value = 0;
  n.monoSumR = ctx.createGain(); n.monoSumR.gain.value = 0;
  n.monoSplit.connect(n.monoDirL, 0);
  n.monoSplit.connect(n.monoSumL, 0);
  n.monoSplit.connect(n.monoDirR, 1);
  n.monoSplit.connect(n.monoSumR, 1);
  n.monoDirL.connect(n.monoMerge, 0, 0);
  n.monoDirR.connect(n.monoMerge, 0, 1);
  n.monoSumL.connect(n.monoMerge, 0, 0);
  n.monoSumL.connect(n.monoMerge, 0, 1);
  n.monoSumR.connect(n.monoMerge, 0, 0);
  n.monoSumR.connect(n.monoMerge, 0, 1);

  // AU7 §6: "Volume slider on desktop only, after the limiter... Phones
  // keep the system volume." One plain gain node, always wired — the
  // phone simply never shows a control that would ever move it off 1.
  n.deviceVolume = ctx.createGain(); n.deviceVolume.gain.value = 1;

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
  n.master.connect(n.norm);
  n.norm.connect(n.eqPreamp);
  n.eqTail.connect(n.balance);
  n.balance.connect(n.monoSplit);
  if(n.limiter) n.monoMerge.connect(n.limiter).connect(n.deviceVolume).connect(n.out);
  else n.monoMerge.connect(n.deviceVolume).connect(n.out);
  n.out.connect(ctx.destination);
  return n;
}

// AU7 (docs/16_AUDIO.md §6): the one function that ever writes
// n.balance/n.monoDirL/n.monoDirR/n.monoSumL/n.monoSumR, exactly the same
// "ramp, never a bare .value=" convention applyCharacter()/applyLoudness
// Norm()/applyEQ() already use.
export function applyMonoBalance(ramp = 0.05){
  if(!S.nodes) return;
  const n = S.nodes, now = S.ctx.currentTime;
  n.balance.pan.setTargetAtTime(clampBalance(S.balance), now, ramp);
  const mono = !!S.mono;
  n.monoDirL.gain.setTargetAtTime(mono ? 0 : 1, now, ramp);
  n.monoDirR.gain.setTargetAtTime(mono ? 0 : 1, now, ramp);
  n.monoSumL.gain.setTargetAtTime(mono ? 0.5 : 0, now, ramp);
  n.monoSumR.gain.setTargetAtTime(mono ? 0.5 : 0, now, ramp);
}

// AU7 §6: the desktop-only volume slider's own setter — after the
// limiter, so turning it down never changes how hard the limiter works
// (§1). A phone never shows the control that would move S.deviceVolume
// off its default (1), so this needs no platform check of its own.
export function applyDeviceVolume(ramp = 0.05){
  if(!S.nodes) return;
  S.nodes.deviceVolume.gain.setTargetAtTime(clampDeviceVolume(S.deviceVolume), S.ctx.currentTime, ramp);
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

// AU5 (docs/16_AUDIO.md §4): "Auto (default): album gain when playing an
// album in order, track gain on shuffle or a mixed queue." A practical
// heuristic for "in order" — every queued index belongs to the same album
// as the current track, with shuffle off — rather than also checking exact
// track-number sequence; a manually reordered album still reads as "the
// same album, playing through" for this purpose, which is the behavior a
// listener would expect from Auto.
function isPlayingAlbumInOrder(t){
  if(S.shuffle || !S.queue || !S.queue.length) return false;
  const key = albumKey(t);
  return S.queue.every(idx => albumKey(S.tracks[idx]) === key);
}

// §4's gain clamp: "never push into clipping... peak × gain ≤ −1 dBFS."
// Applies whichever gain was actually used to its own peak — a track gain
// clamps against that track's own peak, an album gain against the loudest
// peak among the album's own tracks (the one the album gain is shared
// across), falling back to the limiter alone when no peak is known at all.
export function applyLoudnessNorm(ramp = 0.05){
  if(!S.nodes || !S.ctx) return;
  const mode = S.loudnessMode || 'auto';
  const t = current();
  let gainDb = 0;
  if(mode !== 'off' && t && t.details){
    const key = albumKey(t);
    const useAlbum = mode === 'album' || (mode === 'auto' && isPlayingAlbumInOrder(t));
    if(useAlbum){
      const entries = S.tracks.filter(x => albumKey(x) === key)
        .map(x => ({details: x.details, duration: x.duration}));
      const g = albumGainDb(entries);
      if(g != null){
        const peaks = entries.map(e => e.details && e.details.replayGain && e.details.replayGain.albumPeak)
          .concat(entries.map(e => e.details && e.details.loudness && e.details.loudness.truePeakDb != null ? Math.pow(10, e.details.loudness.truePeakDb/20) : null))
          .filter(p => typeof p === 'number' && isFinite(p));
        const peakLinear = peaks.length ? Math.max(...peaks) : null;
        gainDb = clampGainDbForPeak(g, peakLinear);
      }
    } else {
      const g = trackGainDb(t.details);
      if(g != null){
        const rg = t.details.replayGain;
        const peakLinear = (rg && typeof rg.trackPeak === 'number') ? rg.trackPeak :
          (t.details.loudness && isFinite(t.details.loudness.truePeakDb) ? Math.pow(10, t.details.loudness.truePeakDb/20) : null);
        gainDb = clampGainDbForPeak(g, peakLinear);
      }
    }
  }
  S.nodes.norm.gain.setTargetAtTime(dbToLinear(gainDb), S.ctx.currentTime, ramp);
}

// AU6 (docs/16_AUDIO.md §3): "HOLD TO HEAR FLAT bypasses the bands only
// while held... keeps the auto-preamp offset." Same press-and-hold shape
// as RF28's auditionStageAlone()/releaseAudition() above, but a separate
// flag — the Character audition and the EQ audition are independent
// holds, each scoped to its own stage of the chain (nothing stops a user
// from, in principle, holding both at once).
let eqAuditioningFlat = false;

// Sets the scratch (never-connected) filter bank from a *configured* EQ
// state — mode-dependent active bands only, deliberately ignoring
// `enabled`/any audition hold, since this is "what would this curve be if
// applied," used both for drawing the curve and for the auto-preamp calc
// that has to keep working even while the EQ reads as flat on the wire.
function setScratchFromState(n, eq){
  const mode = eq.mode === 'parametric' ? 'parametric' : 'graphic';
  if(mode === 'graphic'){
    const tiltDb = clampTiltDb(eq.tilt || 0);
    n.eqScratch.tiltLow.gain.value = -tiltDb;
    n.eqScratch.tiltHigh.gain.value = tiltDb;
    const bands = eq.graphicBands || [];
    n.eqScratch.graphic.forEach((f, i) => { f.gain.value = clampGraphicBandDb(bands[i] || 0); });
    n.eqScratch.parametric.forEach(f => { f.type = 'allpass'; });
  } else {
    n.eqScratch.tiltLow.gain.value = 0;
    n.eqScratch.tiltHigh.gain.value = 0;
    n.eqScratch.graphic.forEach(f => { f.gain.value = 0; });
    const bands = (eq.parametricBands || []).slice(0, MAX_PARAMETRIC_BANDS);
    n.eqScratch.parametric.forEach((f, i) => {
      const b = bands[i];
      if(!b){ f.type = 'allpass'; return; }
      f.type = BIQUAD_TYPE_FOR[b.type];
      f.frequency.value = b.freq;
      f.Q.value = b.q;
      f.gain.value = PARAMETRIC_GAIN_TYPES.includes(b.type) ? b.gainDb : 0;
    });
  }
}

// §3's own rule: "Compute the real curve with BiquadFilterNode.
// getFrequencyResponse() across every active band plus preamp, and draw
// that line behind the sliders" — the preamp itself is a flat gain (every
// frequency shifts by the same dB), so it isn't one of the filters sampled
// here; callers that want the preamp folded in just add preampDb to every
// point of the returned curve. `freqs` is a plain array of Hz; returns one
// dB value per frequency, summed across every active filter in series
// (combineDbCurve() — product of magnitudes in series is sum of dB).
export function computeEqCurveDb(eq, freqs){
  if(!S.nodes || !S.nodes.eqScratch || !freqs || !freqs.length) return (freqs || []).map(() => 0);
  setScratchFromState(S.nodes, eq);
  const freqArray = Float32Array.from(freqs);
  const mag = new Float32Array(freqs.length), phase = new Float32Array(freqs.length);
  const dbArrays = [];
  const sc = S.nodes.eqScratch;
  for(const node of [sc.tiltLow, sc.tiltHigh, ...sc.graphic, ...sc.parametric]){
    node.getFrequencyResponse(freqArray, mag, phase);
    dbArrays.push(Array.from(mag, m => 20 * Math.log10(Math.max(m, 1e-8))));
  }
  return combineDbCurve(dbArrays);
}

// AU6 §3: sets every real node from S.eq. The preamp always reflects the
// *configured* curve (computed above) regardless of `enabled`/an audition
// hold — "Both keep the auto-preamp offset, so the comparison is about
// tone, not volume." Only the bands themselves go flat when bypassed.
export function applyEQ(ramp = 0.05){
  if(!S.nodes || !S.ctx) return;
  const eq = S.eq || defaultEqState();
  const n = S.nodes, t = S.ctx.currentTime;

  const curve = computeEqCurveDb(eq, sampleFrequenciesLog());
  const peakDb = curve.length ? Math.max(...curve) : 0;
  const preampDb = eq.autoPreamp !== false ? autoPreampDbFromPeak(peakDb) : clampPreampDb(eq.preampDb || 0);
  n.eqPreamp.gain.setTargetAtTime(dbToLinear(preampDb), t, ramp);

  const bypass = !eq.enabled || eqAuditioningFlat;
  const mode = eq.mode === 'parametric' ? 'parametric' : 'graphic';

  const tiltDb = (!bypass && mode === 'graphic') ? clampTiltDb(eq.tilt || 0) : 0;
  n.eqTiltLow.gain.setTargetAtTime(-tiltDb, t, ramp);
  n.eqTiltHigh.gain.setTargetAtTime(tiltDb, t, ramp);

  const bands = (!bypass && mode === 'graphic') ? (eq.graphicBands || []) : [];
  n.eqGraphic.forEach((f, i) => f.gain.setTargetAtTime(clampGraphicBandDb(bands[i] || 0), t, ramp));

  const pBands = (!bypass && mode === 'parametric') ? (eq.parametricBands || []).slice(0, MAX_PARAMETRIC_BANDS) : [];
  n.eqParametric.forEach((f, i) => {
    const b = pBands[i];
    if(!b){
      f.type = 'allpass';
      f.gain.setTargetAtTime(0, t, ramp);
      return;
    }
    f.type = BIQUAD_TYPE_FOR[b.type];
    f.frequency.setTargetAtTime(b.freq, t, ramp);
    f.Q.setTargetAtTime(b.q, t, ramp);
    f.gain.setTargetAtTime(PARAMETRIC_GAIN_TYPES.includes(b.type) ? b.gainDb : 0, t, ramp);
  });
}

// HOLD TO HEAR FLAT (§3) — same press-and-hold shape as
// auditionStageAlone()/releaseAudition() above, scoped to the EQ bands only.
export function auditionEqFlat(){
  if(!S.nodes) return;
  eqAuditioningFlat = true;
  applyEQ(AUDITION_RAMP);
}
export function releaseEqAudition(){
  if(!eqAuditioningFlat) return;
  eqAuditioningFlat = false;
  applyEQ(AUDITION_RAMP);
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
  eqAuditioningFlat = false;
  S.ctx = makeContext();
  S.nodes = await buildGraph(S.ctx);
  applyCharacter();
  applyVolume();
  applyLoudnessNorm();
  applyEQ();
  applyMonoBalance();
  applyDeviceVolume();
  applyOutputRoute();
  await S.ctx.resume();
}
