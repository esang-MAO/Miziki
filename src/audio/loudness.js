/* ================= loudness measurement (docs/16_AUDIO.md §4) =================
   Pure, DOM-free math: BS.1770 (ITU-R BS.1770-4) integrated loudness, an
   estimated true peak, clipping-run detection and the peak-to-loudness
   ratio the dynamics note reads, plus the gain-selection/clamp logic that
   decides what actually gets applied for a given loudness mode. No
   imports, no S, no window — safe to import directly in a node:test file
   the same way sundown/rhythm.js and audio/level-match.js already are.

   Two deliberate simplifications from the full ITU spec, both scoped to
   stay cheap enough to run on a phone at import time with no worker (see
   src/library/import.js's own header comment for why there's no literal
   Worker here, despite the doc's "in a worker" suggestion):
     - True peak is estimated by 4x linear-interpolation oversampling, not
       the spec's own polyphase FIR. Close enough to catch an inter-sample
       overshoot a plain sample-peak scan would miss, without the filter
       design a correct implementation needs.
     - Clipping is counted per channel independently and summed, not
       de-duplicated across channels at the same sample index. A stereo
       clip still counts (usually twice, once per channel) rather than
       being missed, which is the safer direction to be imprecise in. */

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

// 4x linear-interpolation oversample peak (see header comment) — returns
// the estimated true peak in dBFS (0dBFS = full scale).
export function estimateTruePeakDb(channels){
  let peak = 0;
  for(const ch of (channels || [])){
    for(let i = 0; i < ch.length - 1; i++){
      const a = ch[i], b = ch[i+1];
      peak = Math.max(peak, Math.abs(a));
      for(let k = 1; k < 4; k++) peak = Math.max(peak, Math.abs(a + (b - a) * (k/4)));
    }
    if(ch.length) peak = Math.max(peak, Math.abs(ch[ch.length - 1]));
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
  return { lufs, truePeakDb, clipRuns, plr, measured: true };
}

// §4's reference level: the same -18 LUFS target ReplayGain 2.0/EBU R128
// use, so a tagged gain (computed by whatever tool wrote it) and a gain
// this app derives from its own measurement land on the same loudness.
export const REFERENCE_LUFS = -18;

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
