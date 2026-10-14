import { S } from '../state.js';
import { GROOVE, grooveThumpTimes } from '../shell/ceremony-timing.js';

/* ================= run-out groove (docs/CEREMONY.md §2, §3) =================
   The needle riding the run-out groove after the last track: a soft hiss
   plus one low thump per revolution. Synthesised into a buffer (no file to
   ship) and joined at S.nodes.wobble, the same Vinyl join point scratch
   audio uses, so it goes through the same character chain the record did.
   Vinyl only: callers never start it in Pure, and it quietly does nothing
   if the audio graph doesn't exist yet. */

// A tiny seeded PRNG so the noise is deterministic (and testable).
function rng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}

// One channel of groove: low hiss, a decaying ~55 Hz thump at each time in
// thumpTimes (seconds), and the 150 ms fade-in baked in so the start never
// clicks. Pure: returns a Float32Array, touches nothing else.
export function runoutSamples(sampleRate, durSec, thumpTimes, seed = 7){
  const n = Math.max(0, Math.floor(sampleRate * durSec));
  const out = new Float32Array(n);
  const rand = rng(seed);
  const fadeN = Math.floor(sampleRate * GROOVE.fadeInMs / 1000);
  let lp = 0;
  for(let i = 0; i < n; i++){
    lp += 0.18 * (rand() - lp);             // one-pole low-pass: hiss, not white noise
    out[i] = lp * 0.035;
  }
  const thumpLen = Math.floor(sampleRate * 0.12);
  for(const t of thumpTimes){
    const start = Math.floor(t * sampleRate);
    for(let k = 0; k < thumpLen && start + k < n; k++){
      const env = Math.exp(-k / (sampleRate * 0.025));
      out[start + k] += Math.sin(2 * Math.PI * 55 * k / sampleRate) * 0.22 * env;
    }
  }
  for(let i = 0; i < fadeN && i < n; i++) out[i] *= i / fadeN;
  return out;
}

// Starts the groove playing for durSec. Returns {stop(fadeMs)}; stop fades
// it out and frees the nodes. Always safe to call stop more than once.
export function startRunout(durSec){
  const ctx = S.ctx, dest = S.nodes && S.nodes.wobble;
  if(!ctx || !dest || S.mode === 'pure') return { stop(){} };
  let src = null, gain = null;
  try{
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * durSec)), ctx.sampleRate);
    buf.getChannelData(0).set(runoutSamples(ctx.sampleRate, durSec, grooveThumpTimes(durSec)));
    src = ctx.createBufferSource(); src.buffer = buf;
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
