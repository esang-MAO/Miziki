/* ================= scratch processor (F2: true scratching) =================
   Runs in the AudioWorkletGlobalScope, loaded via ctx.audioWorklet.addModule()
   from src/player/scrub.js. Self-contained on purpose — no imports — because
   worklet module loading and Vite's JS bundling don't mix reliably; Vite
   copies this file as a plain asset (see scrub.js's `new URL(...)`) and the
   browser loads it as-is.

   The playhead follows a target position (seconds into the track), sent from
   the main thread on every pointermove, rather than following a velocity —
   see scrub.js for why position-following is what the spec wants. Reading
   samples at a continuously-moving fractional index naturally plays forward
   or backward depending on which way the target is, with linear interpolation
   between samples so slow scratches don't sound gritty.

   Holding the target still would otherwise mean reading the exact same
   sample forever — a frozen, non-zero level that is inaudible as music but
   is still a constant signal, not silence. Real scratch tools avoid that by
   tying loudness to how fast the platter is actually turning, so stillness
   is genuine silence, the same way a real record is silent with the motor
   off and the needle resting on one point of the groove. That's what the
   velocity envelope below does — it is not just a click-avoidance ramp. */

const FOLLOW_TIME_CONSTANT = 0.012;   // s — how tightly the playhead tracks the target
const VELOCITY_FLOOR = 0.05;          // track-seconds/real-second below which output fades to silence
const ENVELOPE_TIME_CONSTANT = 0.01;  // s — smooths the velocity envelope itself, so it doesn't buzz

// Always lands between its two neighbors (by construction, since it's a
// straight blend) — cubic/Hermite would sound smoother but can overshoot
// past the neighboring samples, which isn't worth it here.
export function clampIndex(idx, length){
  if(length <= 0) return 0;
  return Math.min(Math.max(idx, 0), length - 1);
}

export function sampleAt(channel, idx){
  const length = channel.length;
  const c = clampIndex(idx, length);
  const i0 = Math.floor(c);
  const i1 = Math.min(i0 + 1, length - 1);
  const frac = c - i0;
  const s0 = channel[i0], s1 = channel[i1];
  return s0 + (s1 - s0) * frac;
}

// one-pole follower: moves `value` a fraction of the way to `target` on
// each call, the fraction set by a time constant so the feel doesn't
// depend on the (variable) render quantum size
export function onePole(value, target, dt, timeConstant){
  const coeff = 1 - Math.exp(-dt / timeConstant);
  return value + (target - value) * coeff;
}

export function velocityEnvelopeTarget(velocityPerSec, floor){
  return Math.min(1, Math.abs(velocityPerSec) / floor);
}

class ScratchProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.channels = [];           // Float32Array per channel — the loaded ±10s window
    this.windowStart = 0;         // seconds — absolute track position of channels[*][0]
    this.trackDuration = 0;
    this.sr = sampleRate;         // AudioWorkletGlobalScope global, snapshotted per-instance for testability
    this.playhead = 0;            // absolute track seconds
    this.target = 0;              // absolute track seconds, set from the main thread
    this.envelope = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(msg){
    if(msg.type === 'window'){
      this.channels = msg.channels.map(buf => new Float32Array(buf));
      this.windowStart = msg.windowStart;
      this.trackDuration = msg.trackDuration;
      if(msg.sampleRate) this.sr = msg.sampleRate;
    } else if(msg.type === 'target'){
      this.target = msg.target;
    } else if(msg.type === 'start'){
      // jump straight there — no glide into the first position, so the very
      // first samples read are silent (velocity 0) rather than a click
      this.playhead = this.target = msg.position;
      this.envelope = 0;
    } else if(msg.type === 'stop'){
      this.channels = [];
    }
  }

  process(_inputs, outputs){
    const output = outputs[0];
    const outChannels = output.length;
    const frames = outChannels ? output[0].length : 0;
    const dt = 1 / this.sr;
    const chanCount = this.channels.length;

    for(let i = 0; i < frames; i++){
      const prevPlayhead = this.playhead;
      this.playhead = onePole(this.playhead, this.target, dt, FOLLOW_TIME_CONSTANT);
      if(this.trackDuration) this.playhead = Math.min(Math.max(this.playhead, 0), this.trackDuration);

      const velocity = (this.playhead - prevPlayhead) / dt;
      const envTarget = velocityEnvelopeTarget(velocity, VELOCITY_FLOOR);
      this.envelope = onePole(this.envelope, envTarget, dt, ENVELOPE_TIME_CONSTANT);

      if(chanCount === 0){
        for(let ch = 0; ch < outChannels; ch++) output[ch][i] = 0;
        continue;
      }
      const idx = (this.playhead - this.windowStart) * this.sr;
      for(let ch = 0; ch < outChannels; ch++){
        const src = this.channels[Math.min(ch, chanCount - 1)];
        output[ch][i] = sampleAt(src, idx) * this.envelope;
      }
    }
    return true;
  }
}

registerProcessor('scratch-processor', ScratchProcessor);
