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
   compressor — and no true lookahead). ~2ms lookahead, ~1ms attack (PL5
   item 3: lookahead ≈ 2× attack, so attack can actually fully settle
   inside the lookahead window instead of letting a peak slip past the
   ceiling), ~150ms release, a -1dBFS ceiling, and unity gain below
   threshold.

   The lookahead is implemented with one ring buffer per channel (the
   delayed audio itself, engine.js always creates this node with
   outputChannelCount:[2], so it's preallocated for exactly 2 channels —
   no per-process() reallocation check). Every tick reads the sample that
   is now exactly `lookaheadSamples` ticks old out of that ring -- that's
   the signal that's about to be output -- then overwrites that same ring
   slot with the brand-new sample.

   The gain-driving peak itself is tracked with a monotonic deque sliding-
   window maximum (PL5 item 3) instead of rescanning a ring of N peaks on
   every single sample: pushMaxPeak() below is the classic O(1)-amortized
   "max of the last N values" deque, backed by two preallocated circular
   typed arrays (no allocation inside process() at all, matching PL5's own
   "no allocation inside process()" rule). Because the window always holds
   exactly the last `lookaheadSamples` peaks including the one just
   pushed, the gain computed from "the loudest peak anywhere in the window
   right now" already accounts for a transient that hasn't been output
   yet — that's what buys the lookahead: the limiter reacts to a peak
   before it reaches the output, rather than after. */

const THRESHOLD_DB = -1;              // dBFS ceiling (docs/16_AUDIO.md §2.3)
const LOOKAHEAD_SEC = 0.002;          // 2ms -- PL5 item 3: ~2x ATTACK_SEC
const ATTACK_SEC = 0.001;             // ~1ms, reducing gain toward a lower target
const RELEASE_SEC = 0.15;             // ~150ms, easing back toward unity
const CHANNELS = 2;                   // engine.js always creates this node with outputChannelCount:[2]

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

    const N = this.lookaheadSamples;
    this.delayBuf = [];
    for(let ch = 0; ch < CHANNELS; ch++) this.delayBuf.push(new Float32Array(N));
    this.delayedSamples = new Float32Array(CHANNELS); // preallocated scratch, overwritten every sample

    // Monotonic max-deque over the last N peaks, backed by preallocated
    // circular arrays -- capacity N+1 always fits every element a deque
    // over an N-wide window can ever hold.
    const cap = N + 1;
    this.dequeCap = cap;
    this.dequeTick = new Float64Array(cap);
    this.dequeVal = new Float32Array(cap);
    this.dequeHead = 0;
    this.dequeTail = 0;
    this.dequeSize = 0;
    this.tick = 0;
  }

  // Pushes one new peak value into the sliding window and returns the
  // window's current maximum (the last `lookaheadSamples` pushes,
  // including this one). O(1) amortized, zero allocation.
  pushMaxPeak(val){
    const cap = this.dequeCap, N = this.lookaheadSamples, t = this.tick;
    while(this.dequeSize > 0 && this.dequeVal[(this.dequeTail - 1 + cap) % cap] <= val){
      this.dequeTail = (this.dequeTail - 1 + cap) % cap;
      this.dequeSize--;
    }
    this.dequeVal[this.dequeTail] = val;
    this.dequeTick[this.dequeTail] = t;
    this.dequeTail = (this.dequeTail + 1) % cap;
    this.dequeSize++;
    while(this.dequeSize > 0 && this.dequeTick[this.dequeHead] <= t - N){
      this.dequeHead = (this.dequeHead + 1) % cap;
      this.dequeSize--;
    }
    this.tick = t + 1;
    return this.dequeVal[this.dequeHead];
  }

  process(inputs, outputs){
    const input = inputs[0];
    const output = outputs[0];
    const chanCount = Math.min(output.length, CHANNELS);
    const frames = chanCount ? output[0].length : 0;
    const N = this.lookaheadSamples;

    for(let i = 0; i < frames; i++){
      let peak = 0;
      for(let ch = 0; ch < chanCount; ch++){
        const x = input[ch] ? input[ch][i] : 0;
        const a = Math.abs(x);
        if(a > peak) peak = a;
      }

      // Read the delayed sample (lookaheadSamples old) before overwriting
      // this same ring slot with the new one.
      for(let ch = 0; ch < chanCount; ch++){
        this.delayedSamples[ch] = this.delayBuf[ch][this.writeIdx];
        this.delayBuf[ch][this.writeIdx] = input[ch] ? input[ch][i] : 0;
      }
      this.writeIdx = (this.writeIdx + 1) % N;

      // The gain for the sample about to be output is driven by the
      // loudest peak anywhere in the window right now -- including the
      // one just pushed, which is still `lookaheadSamples` ticks in the
      // delayed sample's future. That's the lookahead.
      const maxPeak = this.pushMaxPeak(peak);

      const targetGain = maxPeak > this.thresholdLin ? this.thresholdLin / maxPeak : 1;
      const coeff = targetGain < this.gain ? this.attackCoeff : this.releaseCoeff;
      this.gain = targetGain + (this.gain - targetGain) * coeff;

      for(let ch = 0; ch < chanCount; ch++) output[ch][i] = this.delayedSamples[ch] * this.gain;
    }
    return true;
  }
}

registerProcessor('limiter-processor', LimiterProcessor);
