/* ================= limiter processor (AU3: honest levels) =================
   Runs in the AudioWorkletGlobalScope, loaded via ctx.audioWorklet.addModule()
   from src/audio/engine.js. Self-contained on purpose — no imports, no
   exports — same two reasons src/audio/scratch-processor.js's own header
   gives: Vite's bundling doesn't mix reliably with worklet module loading
   (engine.js's own `new URL(...)` copies this file as a plain asset instead
   of bundling it), and Safari's AudioWorklet loader has not reliably
   supported ES module import/export syntax in the processor file itself.
   (tests/unit/limiter-processor.test.js loads this file's source with
   Node's vm module instead of import, the same way scratch-processor.test.js
   does, since there's nothing left to import.)

   docs/16_AUDIO.md §2.3: a real feedforward lookahead peak limiter, not
   DynamicsCompressorNode (which has its own automatic makeup gain — the
   same "double makeup gain" shape finding 4 flags for the Character
   compressor — and no true lookahead). 1.5ms lookahead, ~1ms attack,
   ~150ms release, a -1dBFS ceiling, and unity gain below threshold.

   The lookahead is implemented with one ring buffer per channel (the
   delayed audio itself) plus one shared peak ring (the loudest absolute
   sample across all channels at each tick). Every tick reads the sample
   that is now exactly `lookaheadSamples` ticks old out of the ring —
   that's the signal that's about to be output — then overwrites that same
   ring slot with the brand-new sample/peak. Because the ring always holds
   exactly the last `lookaheadSamples` peaks relative to the sample being
   read, the gain computed from "the loudest peak anywhere in the ring
   right now" already accounts for a transient that hasn't been output
   yet — that's what buys the lookahead: the limiter reacts to a peak
   before it reaches the output, rather than after. */

const THRESHOLD_DB = -1;              // dBFS ceiling (docs/16_AUDIO.md §2.3)
const LOOKAHEAD_SEC = 0.0015;         // 1.5ms
const ATTACK_SEC = 0.001;             // ~1ms, reducing gain toward a lower target
const RELEASE_SEC = 0.15;             // ~150ms, easing back toward unity

class LimiterProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    const sr = sampleRate; // AudioWorkletGlobalScope global
    this.thresholdLin = Math.pow(10, THRESHOLD_DB / 20);
    this.lookaheadSamples = Math.max(1, Math.round(LOOKAHEAD_SEC * sr));
    this.attackCoeff = Math.exp(-1 / (ATTACK_SEC * sr));
    this.releaseCoeff = Math.exp(-1 / (RELEASE_SEC * sr));
    this.gain = 1;
    this.writeIdx = 0;
    this.delayBuf = null;      // Float32Array[channel][lookaheadSamples], built on first process() once channel count is known
    this.peakRing = new Float32Array(this.lookaheadSamples);
  }

  process(inputs, outputs){
    const input = inputs[0];
    const output = outputs[0];
    const chanCount = output.length;
    const frames = chanCount ? output[0].length : 0;
    if(!this.delayBuf || this.delayBuf.length !== chanCount){
      this.delayBuf = [];
      for(let ch = 0; ch < chanCount; ch++) this.delayBuf.push(new Float32Array(this.lookaheadSamples));
    }
    const N = this.lookaheadSamples;

    for(let i = 0; i < frames; i++){
      let peak = 0;
      for(let ch = 0; ch < chanCount; ch++){
        const x = input[ch] ? input[ch][i] : 0;
        const a = Math.abs(x);
        if(a > peak) peak = a;
      }

      // Read the delayed sample/peak (lookaheadSamples old) before
      // overwriting this same ring slot with the new one.
      const delayedPeak = this.peakRing[this.writeIdx];
      const delayedSamples = [];
      for(let ch = 0; ch < chanCount; ch++){
        delayedSamples.push(this.delayBuf[ch][this.writeIdx]);
        this.delayBuf[ch][this.writeIdx] = input[ch] ? input[ch][i] : 0;
      }
      this.peakRing[this.writeIdx] = peak;
      this.writeIdx = (this.writeIdx + 1) % N;

      // The gain for the sample about to be output is driven by the
      // loudest peak anywhere in the ring right now — including the one
      // just written, which is still `lookaheadSamples` ticks in the
      // delayed sample's future. That's the lookahead.
      let maxPeak = delayedPeak;
      for(let k = 0; k < N; k++) if(this.peakRing[k] > maxPeak) maxPeak = this.peakRing[k];

      const targetGain = maxPeak > this.thresholdLin ? this.thresholdLin / maxPeak : 1;
      const coeff = targetGain < this.gain ? this.attackCoeff : this.releaseCoeff;
      this.gain = targetGain + (this.gain - targetGain) * coeff;

      for(let ch = 0; ch < chanCount; ch++) output[ch][i] = delayedSamples[ch] * this.gain;
    }
    return true;
  }
}

registerProcessor('limiter-processor', LimiterProcessor);
