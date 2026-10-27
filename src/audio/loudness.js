/* ================= loudness measurement (docs/16_AUDIO.md §4) =================
   Pure, DOM-free math: BS.1770 (ITU-R BS.1770-4) integrated loudness, an
   estimated true peak, clipping-run detection and the peak-to-loudness
   ratio the dynamics note reads, plus the gain-selection/clamp logic that
   decides what actually gets applied for a given loudness mode. No
   imports, no S, no window — safe to import directly in a node:test file
   the same way sundown/rhythm.js and audio/level-match.js already are.

   One deliberate simplification from the full ITU spec, scoped to stay
   cheap enough to run on a phone at import time with no worker (see
   src/library/import.js's own header comment for why there's no literal
   Worker here, despite the doc's "in a worker" suggestion):
     - Clipping is counted per channel independently and summed, not
       de-duplicated across channels at the same sample index. A stereo
       clip still counts (usually twice, once per channel) rather than
       being missed, which is the safer direction to be imprecise in.

   True peak (PL5 item 4) is a proper 4x-oversampled estimate: a
   Kaiser-windowed-sinc polyphase FIR reconstructs the 3 intermediate
   points between each pair of samples, in the spirit of BS.1770 Annex
   2's own oversampled-FIR approach -- not a transcription of ITU's own
   published coefficient table, which isn't something to fabricate from
   memory. This replaces a former 4x linear-interpolation guess, which
   could never read higher than the two samples it sat between and so
   could never actually catch an inter-sample overshoot. */

// ITU-R BS.1770-4 K-weighting: a shelf pre-filter, then an RLB high-pass.
// Coefficients are derived from the filter design, not hardcoded for one
// sample rate, so this stays correct at whatever rate the device's
// AudioContext actually runs (AU3 fixed that rate; it's rarely 48kHz on
// a phone's own built-in output).
function kWeightCoeffs(sampleRate){
  const fs = sampleRate;
  // stage 1: high-frequency shelf boost (~+4dB above ~1.7kHz)
  const f0a = 1681.9744509555319, Ga = 3.99984385397, Qa = 0.7071752369554193;
  const Ka = Math.tan(Math.PI * f0a / fs);
  const Vh = Math.pow(10, Ga / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0a = 1 + Ka / Qa + Ka * Ka;
  const stage1 = {
    b0: (Vh + Vb * Ka / Qa + Ka * Ka) / a0a,
    b1: 2 * (Ka * Ka - Vh) / a0a,
    b2: (Vh - Vb * Ka / Qa + Ka * Ka) / a0a,
    a1: 2 * (Ka * Ka - 1) / a0a,
    a2: (1 - Ka / Qa + Ka * Ka) / a0a,
  };
  // stage 2: RLB high-pass (removes sub-bass the ear doesn't weight)
  const f0b = 38.13547087613982, Qb = 0.5003270373238773;
  const Kb = Math.tan(Math.PI * f0b / fs);
  const a0b = 1 + Kb / Qb + Kb * Kb;
  const stage2 = {
    b0: 1 / a0b, b1: -2 / a0b, b2: 1 / a0b,
    a1: 2 * (Kb * Kb - 1) / a0b,
    a2: (1 - Kb / Qb + Kb * Kb) / a0b,
  };
  return { stage1, stage2 };
}

function biquadFilter(x, c){
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for(let i = 0; i < x.length; i++){
    const xi = x[i];
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[i] = yi; x2 = x1; x1 = xi; y2 = y1; y1 = yi;
  }
  return y;
}

function kWeight(channel, coeffs){
  return biquadFilter(biquadFilter(channel, coeffs.stage1), coeffs.stage2);
}

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET_DB = -10;
const BLOCK_SEC = 0.4, STEP_SEC = 0.1;

function meanSquareToLufs(meanSq){
  return meanSq > 0 ? -0.691 + 10 * Math.log10(meanSq) : -Infinity;
}

// BS.1770-4 integrated loudness, gated per the spec's two-pass rule
// (absolute gate at -70 LUFS, then a relative gate 10dB below the
// absolute-gated mean). Falls back to a plain ungated whole-signal
// measurement for anything too short to form even one gating block, or
// where gating would otherwise leave nothing — the same "no data yet"
// posture this codebase already takes elsewhere (sunProgress()'s own
// `if(!S.sun.ok) return 0`) rather than returning NaN/-Infinity.
export function integratedLoudnessLUFS(channels, sampleRate){
  if(!channels || !channels.length || !channels[0].length) return -Infinity;
  const coeffs = kWeightCoeffs(sampleRate);
  const weighted = channels.map(ch => kWeight(ch, coeffs));
  const n = weighted[0].length;
  const blockFrames = Math.round(BLOCK_SEC * sampleRate);
  const stepFrames = Math.round(STEP_SEC * sampleRate);
  if(n < blockFrames){
    let sumSq = 0;
    for(const ch of weighted) for(let i = 0; i < ch.length; i++) sumSq += ch[i] * ch[i];
    return meanSquareToLufs(sumSq / (n * weighted.length));
  }
  const blocks = [];
  for(let start = 0; start + blockFrames <= n; start += stepFrames){
    let sumSq = 0;
    for(const ch of weighted){
      for(let i = start; i < start + blockFrames; i++) sumSq += ch[i] * ch[i];
    }
    blocks.push(sumSq / (blockFrames * weighted.length));
  }
  const absGated = blocks.filter(ms => meanSquareToLufs(ms) > ABSOLUTE_GATE_LUFS);
  if(!absGated.length) return meanSquareToLufs(blocks.reduce((a,b)=>a+b,0) / blocks.length);
  const absMean = absGated.reduce((a,b)=>a+b,0) / absGated.length;
  const relGateLufs = meanSquareToLufs(absMean) + RELATIVE_GATE_OFFSET_DB;
  const relGated = absGated.filter(ms => meanSquareToLufs(ms) > relGateLufs);
  const finalSet = relGated.length ? relGated : absGated;
  return meanSquareToLufs(finalSet.reduce((a,b)=>a+b,0) / finalSet.length);
}

// True-peak version stamp: bumped whenever estimateTruePeakDb()'s own
// algorithm changes, so library/thumbs.js's healLoudness() knows to
// re-measure an already-measured track exactly once (PL5 item 4).
export const TRUE_PEAK_VERSION = 2;

const TRUE_PEAK_OVERSAMPLE = 4;
const TRUE_PEAK_TAPS = 8; // per intermediate phase -- 4 original samples each side
const TRUE_PEAK_KAISER_BETA = 8;

// Modified Bessel function of the first kind, order 0 -- the Kaiser
// window's own defining function. Series expansion, accurate to well
// past double precision's useful range for the beta used here.
function besselI0(x){
  let sum = 1, term = 1;
  const halfX = x / 2;
  for(let k = 1; k <= 40; k++){
    term *= (halfX * halfX) / (k * k);
    sum += term;
    if(term < sum * 1e-15) break;
  }
  return sum;
}

function sincPi(x){
  return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}

// Built lazily, once: for each of the 3 intermediate phases between a
// pair of samples (k = 1, 2, 3 of 4), a small Kaiser-windowed-sinc FIR
// that reconstructs the signal at that fractional offset from the
// TRUE_PEAK_TAPS original samples straddling it.
let truePeakPhaseBank = null;

function buildTruePeakPhaseBank(){
  const half = TRUE_PEAK_TAPS / 2; // 4
  const offsets = [];
  for(let m = -(half - 1); m <= half; m++) offsets.push(m); // -3..4
  const edge = half + 0.5;
  const winDenom = besselI0(TRUE_PEAK_KAISER_BETA);
  const bank = [];
  for(let k = 1; k < TRUE_PEAK_OVERSAMPLE; k++){
    const frac = k / TRUE_PEAK_OVERSAMPLE;
    const coeffs = offsets.map(m => {
      const dist = m - frac;
      const t = dist / edge;
      const win = Math.abs(t) <= 1 ? besselI0(TRUE_PEAK_KAISER_BETA * Math.sqrt(1 - t * t)) / winDenom : 0;
      return sincPi(dist) * win;
    });
    bank.push({ offsets, coeffs });
  }
  return bank;
}

// Real 4x-oversampled true peak (see header comment) — returns the
// estimated true peak in dBFS (0dBFS = full scale). Samples outside the
// buffer (near either end) are clamped to the nearest real sample rather
// than assumed zero, so a loud track that simply starts or ends mid-wave
// doesn't read a false edge overshoot from an imagined silence next to it.
export function estimateTruePeakDb(channels){
  if(!truePeakPhaseBank) truePeakPhaseBank = buildTruePeakPhaseBank();
  let peak = 0;
  for(const ch of (channels || [])){
    const len = ch.length;
    if(!len) continue;
    for(let i = 0; i < len; i++){
      const a = Math.abs(ch[i]);
      if(a > peak) peak = a;
    }
    for(let i = 0; i < len - 1; i++){
      for(const phase of truePeakPhaseBank){
        let val = 0;
        for(let j = 0; j < phase.offsets.length; j++){
          const idx = Math.min(len - 1, Math.max(0, i + phase.offsets[j]));
          val += ch[idx] * phase.coeffs[j];
        }
        const a = Math.abs(val);
        if(a > peak) peak = a;
      }
    }
  }
  return peak > 0 ? linearToDb(peak) : -Infinity;
}

export function countClippingRuns(channels, threshold = 0.999, minRun = 3){
  let total = 0;
  for(const ch of (channels || [])){
    let run = 0;
    for(let i = 0; i < ch.length; i++){
      if(Math.abs(ch[i]) >= threshold){
        run++;
      } else {
        if(run >= minRun) total++;
        run = 0;
      }
    }
    if(run >= minRun) total++;
  }
  return total;
}

export function peakToLoudnessRatio(truePeakDb, lufs){
  if(!isFinite(truePeakDb) || !isFinite(lufs)) return null;
  return truePeakDb - lufs;
}

export function dbToLinear(db){ return Math.pow(10, db / 20); }
export function linearToDb(lin){ return lin > 0 ? 20 * Math.log10(lin) : -Infinity; }

// The single measuring pass library/import.js runs once per imported file
// (and library/thumbs.js's healLoudness() re-runs once, for a library
// stored before this feature existed) — everything the dynamics note and
// the ReplayGain fallback both need, from one decode.
export function measureTrack(channels, sampleRate){
  const lufs = integratedLoudnessLUFS(channels, sampleRate);
  const truePeakDb = estimateTruePeakDb(channels);
  const clipRuns = countClippingRuns(channels);
  const plr = peakToLoudnessRatio(truePeakDb, lufs);
  return { lufs, truePeakDb, clipRuns, plr, measured: true, truePeakVersion: TRUE_PEAK_VERSION };
}

// §4's reference level. ReplayGain 2.0/EBU R128 use -18 LUFS, but that's
// far quieter than how most commercial music is actually mastered (a loud
// rock/pop master commonly sits around -9 to -11 LUFS) — at -18, Auto mode
// was cutting typical tracks by 4-9dB by default, which read as "the app
// got quiet" rather than "levels got evened out." -14 LUFS matches what
// Spotify/Apple Music/YouTube Music already normalize to, so most tracks
// move far less, while still bringing outliers (a much louder or much
// quieter master) into line with the rest of the library. A tagged gain
// (computed by whatever tool wrote it) still wins over this fallback
// whenever one exists — this only changes what we derive ourselves.
export const REFERENCE_LUFS = -14;

// Per-track gain, preferring a tag's own value (another tool's own,
// possibly more careful, measurement) over this app's — null when neither
// is available (details missing entirely, or a measurement that came back
// non-finite, e.g. a silent or near-silent file).
export function trackGainDb(details){
  const rg = details && details.replayGain;
  if(rg && typeof rg.trackGain === 'number' && isFinite(rg.trackGain)) return rg.trackGain;
  const lufs = details && details.loudness && details.loudness.lufs;
  if(typeof lufs === 'number' && isFinite(lufs)) return REFERENCE_LUFS - lufs;
  return null;
}

// Album gain: prefer a tagged album gain found on any track (encoders
// write the same value to every track on the album); otherwise a
// duration-weighted energy average of the tracks' own measured LUFS,
// converted back through the same -0.691+10log10(meanSquare) relationship
// integratedLoudnessLUFS() uses — averaging in the loudness domain itself
// would over-weight quiet tracks, since LUFS is already a log scale.
export function albumGainDb(trackEntries){
  const list = trackEntries || [];
  for(const { details } of list){
    const g = details && details.replayGain && details.replayGain.albumGain;
    if(typeof g === 'number' && isFinite(g)) return g;
  }
  let energySum = 0, durSum = 0;
  for(const { details, duration } of list){
    const lufs = details && details.loudness && details.loudness.lufs;
    const dur = duration > 0 ? duration : 0;
    if(typeof lufs === 'number' && isFinite(lufs) && dur > 0){
      energySum += Math.pow(10, (lufs + 0.691) / 10) * dur;
      durSum += dur;
    }
  }
  if(!durSum) return null;
  const albumLufs = meanSquareToLufs(energySum / durSum);
  return isFinite(albumLufs) ? REFERENCE_LUFS - albumLufs : null;
}

// "Never push into clipping: limit the applied gain so that peak × gain ≤
// −1 dBFS" — the limiter downstream (AU3) still catches anything left,
// this is just so normalization itself doesn't lean on it as a crutch. A
// missing/non-finite peak leaves the gain unclamped here (nothing to
// clamp against), trusting the limiter alone for that file.
export function clampGainDbForPeak(gainDb, peakLinear){
  if(typeof peakLinear !== 'number' || !isFinite(peakLinear) || peakLinear <= 0) return gainDb;
  const maxGainDb = linearToDb(dbToLinear(-1) / peakLinear);
  return Math.min(gainDb, maxGainDb);
}

// The one-line caption under the Off/Track/Album/Auto seg, read by both the
// click handler (src/wiring/character.js) and the restore-time sync
// (src/storage/meta.js's applyPrefs()) — the same "one pure mapping, two
// callers" shape depthCaptionFor() already established for the Sundown
// depth seg.
export function loudnessCaptionFor(mode){
  if(mode === 'off') return 'Off: plays at the recording’s own level.';
  if(mode === 'track') return 'Track: evens out volume between individual songs.';
  if(mode === 'album') return 'Album: evens out volume between records, keeping a record’s own quiet and loud moments intact.';
  return 'Auto: album gain for an album played in order, track gain otherwise.';
}

// "ALBUM GAIN −4.2 DB" — the doc's own exact formatting for the figure
// shown on the right of the dynamics note.
export function formatGainDb(label, gainDb){
  if(typeof gainDb !== 'number' || !isFinite(gainDb)) return '';
  const sign = gainDb > 0 ? '+' : '';
  return label.toUpperCase() + ' ' + sign + gainDb.toFixed(1) + ' DB';
}

// The dynamics note's own three-way call (§4's "Dynamics note" block) —
// clipping always wins (it's the worst finding regardless of PLR), then a
// peak-to-loudness ratio under 8dB (a commonly-cited crest-factor cutoff
// for a heavily limited/compressed master) reads as Compressed, else
// Dynamic. Sentences are the doc's own, verbatim.
export function classifyDynamics({ clipRuns, plr }){
  if(clipRuns > 0){
    return { label: 'Clipped master', sentence: 'Peaks were cut flat in mastering; it can sound harsh turned up.' };
  }
  if(typeof plr === 'number' && plr < 8){
    return { label: 'Compressed', sentence: 'Loud throughout, with less room between soft and loud.' };
  }
  return { label: 'Dynamic', sentence: 'Plenty of room between the quiet and loud parts. No clipping found.' };
}
