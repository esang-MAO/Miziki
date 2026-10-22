import { S } from '../state.js';
import { hapticTick } from '../ui/haptic.js';

/* ================= surface noise & vinyl ritual (docs/15_SURFACE_NOISE.md §1) =================
   The needle drop, lead-in, run-out and "under the music" generators —
   all synthesised into a short buffer at call time (same approach as the
   CEREMONY run-out groove, src/audio/runout.js: no file to ship, seeded so
   the result is deterministic and testable), joined at S.nodes.wobble, the
   same Vinyl join point scratch audio and the groove already use, so it
   rides through the same character chain the record did. Vinyl only —
   every caller is expected to check S.mode/S.surfaceNoise first (see
   surfaceNoiseActive() below); the runtime starters below also no-op
   quietly with no audio graph, same as runout.js's startRunout.

   Wear from plays (§1, "not built yet"): the visual wear-from-plays design
   was never implemented, so every generator below takes wearLevel as a
   parameter defaulting to WEAR_LEVEL (currently always 0) rather than
   reading S directly — the hook the doc asks for, left for that future
   system to actually drive. */

// A tiny seeded PRNG, same shape as runout.js's — deterministic per seed.
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}

export const WEAR_LEVEL = 0;

export const LEAD_IN_SEC = 3.0;

function db(x){ return Math.pow(10, x / 20); }

// Seeds every generator from the release id plus the side, so every copy
// of an album has the same lead-in/run-out character, the same way a real
// pressing is identical for everyone (§1, "Seed per release").
export function releaseSeed(releaseId, side){
  const str = String(releaseId || '') + '|' + String(side || '');
  let h = 0;
  for(let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h || 1;
}

// §1, "Pressings and quality tiers": a 0..1 scale on top of whichever base
// level a generator otherwise uses. Off is silent regardless of tier;
// Well-loved is the louder of the two "on" settings; a cleaner pressing
// (a higher trackTier(), record-art/tiers.js) gets a quieter floor, never
// a louder one. wearLevel scales it back up a little once the wear system
// exists to drive it (currently always 0, so this term is inert).
export function noiseFloorScale(setting, tier, wearLevel = WEAR_LEVEL){
  if(setting !== 'subtle' && setting !== 'well-loved') return 0;
  const base = setting === 'well-loved' ? 1 : 0.55;
  const tierScale = tier >= 3 ? 0.55 : tier === 2 ? 0.75 : 1;
  return base * tierScale * (1 + wearLevel * 0.6);
}

export function surfaceNoiseActive(){
  return S.mode !== 'pure' && S.surfaceNoise !== 'off';
}

// Pink-ish hiss: white noise through a one-pole highpass (removes rumble)
// then a one-pole lowpass (rolls the top off), levelDb the target peak.
export function hissSamples(sampleRate, durSec, seed, levelDb = -48){
  const n = Math.max(0, Math.floor(sampleRate * durSec));
  const out = new Float32Array(n);
  const rand = rng(seed);
  const level = db(levelDb);
  let hp = 0, lp = 0, prev = 0;
  for(let i = 0; i < n; i++){
    const r = rand();
    hp = r - prev + 0.995 * hp;
    prev = r;
    lp += 0.35 * (hp - lp);
    out[i] = lp * level;
  }
  return out;
}

// Sparse, Poisson-timed impulses through a short, randomized-amplitude
// burst — crackle (lead-in groove wear) and, at a much lower rate, the
// run-out's own occasional ticks share this same shape.
export function crackleSamples(sampleRate, durSec, seed, levelDb = -34, perSecond = 18){
  const n = Math.max(0, Math.floor(sampleRate * durSec));
  const out = new Float32Array(n);
  const rand = rng(seed + 1);
  const level = db(levelDb);
  let t = 0;
  while(t < n){
    const u = Math.min(0.999999, Math.max(1e-6, (rand() + 1) / 2));
    t += Math.max(1, Math.round(-Math.log(u) * sampleRate / perSecond));
    if(t >= n) break;
    const amp = (0.4 + 0.6 * (rand() + 1) / 2) * level * (rand() < 0 ? -1 : 1);
    const len = Math.min(n - t, Math.floor(sampleRate * 0.003));
    for(let k = 0; k < len; k++) out[t + k] += amp * Math.exp(-k / (sampleRate * 0.0008));
  }
  return out;
}

// Rarer, larger transients with a small low-frequency body — pops.
export function popSamples(sampleRate, durSec, seed, levelDb = -34, perSecond = 1.2){
  const n = Math.max(0, Math.floor(sampleRate * durSec));
  const out = new Float32Array(n);
  const rand = rng(seed + 2);
  const level = db(levelDb);
  let t = 0;
  while(t < n){
    const u = Math.min(0.999999, Math.max(1e-6, (rand() + 1) / 2));
    t += Math.max(1, Math.round(-Math.log(u) * sampleRate / perSecond));
    if(t >= n) break;
    const amp = (0.6 + 0.4 * (rand() + 1) / 2) * level;
    const len = Math.min(n - t, Math.floor(sampleRate * 0.03));
    for(let k = 0; k < len; k++){
      const env = Math.exp(-k / (sampleRate * 0.006));
      out[t + k] += amp * env * (0.6 * Math.sin(2 * Math.PI * 90 * k / sampleRate) + 0.4 * rand());
    }
  }
  return out;
}

// A slight amplitude wobble at platter rate — 0.55 Hz at 33⅓, scaled by
// whatever live rate the caller passes in (Sundown's own slowdown, so the
// noise's own pulse slows with the record, same tie-in PR #172 gave
// scratch audio's pitch).
export function rotationWobble(sampleRate, n, rateHz = 0.55){
  const out = new Float32Array(n);
  const w = 2 * Math.PI * rateHz / sampleRate;
  for(let i = 0; i < n; i++) out[i] = 1 + 0.12 * Math.sin(w * i);
  return out;
}

function applyWobble(samples, sampleRate, rateHz){
  const w = rotationWobble(sampleRate, samples.length, rateHz);
  for(let i = 0; i < samples.length; i++) samples[i] *= w[i];
  return samples;
}

function fadeInPlace(out, fadeInSec, fadeOutSec, sampleRate){
  const n = out.length;
  const fin = Math.min(n, Math.floor(sampleRate * fadeInSec));
  for(let i = 0; i < fin; i++) out[i] *= i / fin;
  const fout = Math.min(n - fin, Math.floor(sampleRate * fadeOutSec));
  for(let i = 0; i < fout; i++) out[n - 1 - i] *= i / fout;
  return out;
}

// §1 lead-in: crackle + hiss, fading up from silence over 150ms (so it
// never clicks starting) and fading back down over its own last 400ms —
// the crossfade the caller schedules to land exactly as track 1 begins
// (§1, "crossfade it out over the first ~400 ms of the music"). scale is
// noiseFloorScale()'s own 0..1 output — 0 is a safe, silent no-op.
export function leadInSamples(sampleRate, durSec, seed, scale, rateHz = 0.55){
  const n = Math.max(0, Math.floor(sampleRate * durSec));
  const out = new Float32Array(n);
  if(scale > 0){
    const hiss = hissSamples(sampleRate, durSec, seed, -46);
    const crackle = crackleSamples(sampleRate, durSec, seed, -32, 26);
    for(let i = 0; i < n; i++) out[i] = (hiss[i] + crackle[i]) * scale;
    applyWobble(out, sampleRate, rateHz);
  }
  return fadeInPlace(out, 0.15, 0.4, sampleRate);
}

// §1 run-out: hiss and an occasional tick, pulsing gently with the
// rotation — sparser than the lead-in's crackle, since a worn groove's
// surface noise is steadier than its lead-in wear band.
export function runoutNoiseSamples(sampleRate, durSec, seed, scale, rateHz = 0.55){
  const n = Math.max(0, Math.floor(sampleRate * durSec));
  const out = new Float32Array(n);
  if(scale > 0){
    const hiss = hissSamples(sampleRate, durSec, seed + 3, -50);
    const ticks = crackleSamples(sampleRate, durSec, seed + 3, -36, 2.2);
    for(let i = 0; i < n; i++) out[i] = (hiss[i] + ticks[i]) * scale;
    applyWobble(out, sampleRate, rateHz);
  }
  return fadeInPlace(out, 0.15, 0.15, sampleRate);
}

// §1 "Under the music": a faint, continuous hiss bed at a fixed, very low
// floor (about -55 dBFS) regardless of the Surface Noise level — off by
// default, no crackle (that belongs to the lead-in's own groove wear).
export function underMusicSamples(sampleRate, durSec, seed, rateHz = 0.55){
  const out = hissSamples(sampleRate, durSec, seed + 5, -55);
  return applyWobble(out, sampleRate, rateHz);
}

// The needle drop: a soft, low thump-pop.
export function needleDropSamples(sampleRate){
  const n = Math.floor(sampleRate * 0.09);
  const out = new Float32Array(n);
  for(let i = 0; i < n; i++){
    const env = Math.exp(-i / (sampleRate * 0.018));
    out[i] = env * (0.7 * Math.sin(2 * Math.PI * 70 * i / sampleRate) + 0.3 * Math.sin(2 * Math.PI * 180 * i / sampleRate));
  }
  return out;
}

// The needle lift: a short scuff, nothing tonal.
export function needleLiftSamples(sampleRate, seed = 11){
  const n = Math.floor(sampleRate * 0.08);
  const out = new Float32Array(n);
  const rand = rng(seed);
  let prev = 0;
  for(let i = 0; i < n; i++){
    const r = rand();
    const hp = r - prev; prev = r;
    out[i] = hp * Math.exp(-i / (sampleRate * 0.02)) * 0.5;
  }
  return out;
}

/* ================= runtime: play the above through the audio graph ================= */

// Generic stoppable buffer source, same shape as runout.js's startRunout:
// a gain node in between so an early stop (the setting toggled off
// mid-noise, a skip away, an interruption) always has a clean 150ms-ish
// fade available, never an abrupt click. `build(sampleRate)` — not a
// precomputed array — so a bad/incomplete context (no real sampleRate,
// e.g. the {} this module's own tests exercise) throws *inside* the try
// below rather than while building the samples array before it, the same
// one-big-try shape runout.js's startRunout already uses.
function startBuffer(build, { loop = false, playbackRate = 1 } = {}){
  const ctx = S.ctx, dest = S.nodes && S.nodes.wobble;
  if(!ctx || !dest) return { stop(){} };
  let src = null, gain = null;
  try{
    const samples = build(ctx.sampleRate);
    if(!samples || !samples.length) return { stop(){} };
    const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buf.getChannelData(0).set(samples);
    src = ctx.createBufferSource(); src.buffer = buf; src.loop = loop;
    src.playbackRate.value = playbackRate;
    gain = ctx.createGain(); gain.gain.value = 1;
    src.connect(gain).connect(dest);
    src.start();
  }catch(_e){ return { stop(){} }; }
  let stopped = false;
  return {
    stop(fadeMs = 0){
      if(stopped) return; stopped = true;
      const now = ctx.currentTime, end = now + Math.max(0, fadeMs) / 1000;
      try{
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, end);
        src.stop(end + 0.02);
      }catch(_e){}
      src.onended = () => { try{ gain.disconnect(); }catch(_e){} };
    }
  };
}

// Starts the lead-in for durSec; returns {stop(fadeMs)} so a caller can cut
// it short (the setting toggled off mid-noise, §1's own "fades out over
// 150ms" rule, or the track itself was interrupted before it started).
export function startLeadIn(durSec, seed, scale, rateHz = 0.55){
  if(scale <= 0) return { stop(){} };
  return startBuffer(sr => leadInSamples(sr, durSec, seed, scale, rateHz));
}

// Starts the run-out noise layer, alongside (not instead of) the CEREMONY
// groove's own thump (src/audio/runout.js) — shell/runout.js starts and
// stops both together.
export function startRunoutNoise(durSec, seed, scale, rateHz = 0.55){
  if(scale <= 0) return { stop(){} };
  return startBuffer(sr => runoutNoiseSamples(sr, durSec, seed, scale, rateHz));
}

// Starts the faint "under the music" bed, looping for as long as the
// caller keeps it (stop() whenever playback pauses/stops). A no-op unless
// the setting itself is on, on top of the ordinary Surface Noise gate.
export function startUnderMusicBed(seed, scale, rateHz = 0.55){
  if(scale <= 0 || !S.surfaceNoiseUnderMusic) return { stop(){} };
  return startBuffer(sr => underMusicSamples(sr, 6, seed, rateHz), { loop: true });
}

// One-shot needle drop, with a haptic tick alongside it (§1, "Haptic tick
// on the needle drop if haptics are enabled"). Quiet no-op in Pure or with
// Surface Noise off, or with no audio graph yet.
export function playNeedleDrop(){
  if(!surfaceNoiseActive()) return;
  startBuffer(sr => needleDropSamples(sr));
  hapticTick();
}

// One-shot needle lift (end of run-out, §1; and the needle-lift skip, §3).
export function playNeedleLift(){
  if(!surfaceNoiseActive()) return;
  startBuffer(sr => needleLiftSamples(sr));
}
