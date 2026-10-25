/* ================= hook detection (AU12, docs/16_AUDIO.md §7) =================
   "At import... find each track's most-repeated section. Downmix and
   downsample to 11 kHz, take 12-bin chroma frames at 200 ms hops, extend
   each frame with its neighbors, build a self-similarity matrix, and pick
   the most repeated stretch of 8-30 s (CSMT, music summary detection)."

   Pure, zero-import leaf — no DOM, no S, no AudioContext — the same
   "directly unit-testable in Node" shape as audio/loudness.js/level-match.js.
   library/import.js (at import) and library/thumbs.js's healHooks() (the
   idle heal pass for a library imported before this feature existed) are
   the two real callers, both of which already have decoded channel data in
   hand (the same two call sites AU5's measureTrack() already uses).

   A deliberately bounded approximation, not an exhaustive search: a real
   self-similarity-matrix search over every (start, lag, length) triple is
   O(N^3) for an N-frame track (N ~ 1,500 for a five-minute song at a 200ms
   hop) — this instead strides the lag axis and samples a modest number of
   candidate segment lengths across the allowed 8-30s range, using prefix
   sums along each diagonal so the start-position scan stays O(1) per
   position. "Find roughly the best repeated stretch for a crate preview,"
   not "prove it is the single best possible window." */

const CHROMA_MIN_HZ = 80;
const CHROMA_MAX_HZ = 5000;

export function downmixMono(channelData){
  const chans = channelData && channelData.length ? channelData.length : 0;
  const len = chans ? channelData[0].length : 0;
  const mono = new Float32Array(len);
  for(let c = 0; c < chans; c++){
    const ch = channelData[c];
    for(let i = 0; i < len; i++) mono[i] += ch[i];
  }
  if(chans > 1) for(let i = 0; i < len; i++) mono[i] /= chans;
  return mono;
}

export function resampleLinear(samples, fromRate, toRate){
  if(!samples.length || fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLen);
  for(let i = 0; i < outLen; i++){
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = srcPos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

export function nextPow2(n){
  let p = 1;
  while(p < n) p <<= 1;
  return Math.max(p, 1);
}

export function hannWindow(n){
  const w = new Float32Array(n);
  if(n <= 1){ w.fill(1); return w; }
  for(let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

// Iterative in-place radix-2 Cooley-Tukey FFT. `re`/`im` must be the same,
// power-of-two length — chromaFrame() below is the one caller, and it's
// always the one that pads to a power of two first.
export function fftRadix2(re, im){
  const n = re.length;
  for(let i = 1, j = 0; i < n; i++){
    let bit = n >> 1;
    for(; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if(i < j){
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for(let len = 2; len <= n; len <<= 1){
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for(let i = 0; i < n; i += len){
      let curR = 1, curI = 0;
      const half = len / 2;
      for(let k = 0; k < half; k++){
        const uR = re[i + k], uI = im[i + k];
        const vR = re[i + k + half] * curR - im[i + k + half] * curI;
        const vI = re[i + k + half] * curI + im[i + k + half] * curR;
        re[i + k] = uR + vR; im[i + k] = uI + vI;
        re[i + k + half] = uR - vR; im[i + k + half] = uI - vI;
        const nextR = curR * wr - curI * wi;
        const nextI = curR * wi + curI * wr;
        curR = nextR; curI = nextI;
      }
    }
  }
}

// Equal-temperament pitch class (0..11) nearest a given frequency — A440
// tuning, the same reference every tuner/chroma implementation uses. The
// actual note names (C, C#, ...) are never surfaced anywhere; the class
// index is only ever compared to itself across frames.
export function freqToChroma(freq){
  const note = 69 + 12 * Math.log2(freq / 440);
  let c = Math.round(note) % 12;
  if(c < 0) c += 12;
  return c;
}

// One 12-bin, L2-normalized chroma vector for a single frame of mono
// samples — Hann-windowed, zero-padded to the next power of two, summed
// into pitch classes across CHROMA_MIN_HZ..CHROMA_MAX_HZ.
export function chromaFrame(samples, sampleRate){
  const n = samples.length;
  const chroma = new Float32Array(12);
  if(n === 0) return chroma;
  const win = hannWindow(n);
  const padded = nextPow2(n);
  const re = new Float32Array(padded);
  const im = new Float32Array(padded);
  for(let i = 0; i < n; i++) re[i] = samples[i] * win[i];
  fftRadix2(re, im);
  const binHz = sampleRate / padded;
  const maxBin = padded >> 1;
  for(let b = 1; b <= maxBin; b++){
    const freq = b * binHz;
    if(freq < CHROMA_MIN_HZ || freq > CHROMA_MAX_HZ) continue;
    chroma[freqToChroma(freq)] += Math.hypot(re[b], im[b]);
  }
  let norm = 0;
  for(let i = 0; i < 12; i++) norm += chroma[i] * chroma[i];
  norm = Math.sqrt(norm);
  if(norm > 1e-9) for(let i = 0; i < 12; i++) chroma[i] /= norm;
  return chroma;
}

// One chroma frame every hopSec, each frame frameSec wide ("extend each
// frame with its neighbors" — a frame wider than the hop, so consecutive
// frames overlap).
export function computeChromaFrames(mono, sampleRate, opts = {}){
  const hopSec = opts.hopSec || 0.2;
  const frameSec = opts.frameSec || 0.4;
  const hopN = Math.max(1, Math.round(hopSec * sampleRate));
  const frameN = Math.max(hopN, Math.round(frameSec * sampleRate));
  const frames = [];
  for(let start = 0; start + frameN <= mono.length; start += hopN){
    frames.push(chromaFrame(mono.subarray(start, start + frameN), sampleRate));
  }
  return {frames, hopSec};
}

function dot(a, b){
  let s = 0;
  for(let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// The self-similarity-matrix search itself, pulled out so a test can feed
// it a small, hand-built chroma sequence directly rather than going
// through the FFT/chroma pipeline for every case. Bounded as described at
// the top of this file: a capped number of lag values (stride across the
// whole lag axis) times a capped number of candidate segment lengths
// (evenly spread across [minSec, maxSec]) times an O(1)-per-position
// prefix-sum scan.
export function findRepeatedSegment(frames, hopSec, opts = {}){
  const minSec = opts.minSec != null ? opts.minSec : 8;
  const maxSec = opts.maxSec != null ? opts.maxSec : 30;
  const N = frames.length;
  const minFrames = Math.max(1, Math.round(minSec / hopSec));
  const maxFrames = Math.max(minFrames, Math.round(maxSec / hopSec));
  if(N < minFrames * 2) return null;

  const effMaxFrames = Math.min(maxFrames, Math.floor(N / 2));
  if(effMaxFrames < minFrames) return null;

  const lengthCandidates = opts.lengthCandidates || 8;
  const lengths = [];
  for(let k = 0; k < lengthCandidates; k++){
    const L = Math.round(minFrames + ((effMaxFrames - minFrames) * k) / Math.max(1, lengthCandidates - 1));
    if(!lengths.includes(L)) lengths.push(L);
  }

  const maxLag = N - minFrames;
  const lagStride = Math.max(1, Math.floor(maxLag / (opts.maxLags || 200)));

  let best = null;
  for(let lag = minFrames; lag <= maxLag; lag += lagStride){
    const diagLen = N - lag;
    if(diagLen < minFrames) continue;
    const prefix = new Float64Array(diagLen + 1);
    for(let i = 0; i < diagLen; i++) prefix[i + 1] = prefix[i] + dot(frames[i], frames[i + lag]);
    for(const L of lengths){
      if(L > diagLen) continue;
      for(let s = 0; s + L <= diagLen; s++){
        const score = (prefix[s + L] - prefix[s]) / L;
        if(!best || score > best.score) best = {s, lag, L, score};
      }
    }
  }
  if(!best) return null;
  return {
    startSec: best.s * hopSec,
    endSec: (best.s + best.L) * hopSec,
    score: best.score,
  };
}

// The full pipeline: downmix -> downsample -> chroma frames -> search.
// Returns {hookStart, hookEnd} (seconds, into the *original* track) or
// null when the track is too short for a meaningful 8-30s repeat (under
// twice the minimum length) or no frames could be built at all.
export function detectHook(channelData, sampleRate, opts = {}){
  if(!channelData || !channelData.length || !sampleRate) return null;
  const targetRate = opts.targetRate || 11025;
  const minSec = opts.minSec != null ? opts.minSec : 8;
  const mono = downmixMono(channelData);
  if(mono.length / sampleRate < minSec * 2) return null;
  const resampled = resampleLinear(mono, sampleRate, targetRate);
  const durationSec = resampled.length / targetRate;
  if(durationSec < minSec * 2) return null;
  const {frames, hopSec} = computeChromaFrames(resampled, targetRate, opts);
  const seg = findRepeatedSegment(frames, hopSec, opts);
  if(!seg) return null;
  return {hookStart: seg.startSec, hookEnd: seg.endSec};
}
