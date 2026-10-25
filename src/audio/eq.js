/* AU6 (docs/16_AUDIO.md §3): EQ -- the pure, leaf half. No imports, no
   DOM, no AudioContext -- the same "directly unit-testable in Node" shape
   as audio/loudness.js and audio/level-match.js. Everything that actually
   needs a real BiquadFilterNode (building the live graph, measuring the
   true combined curve via getFrequencyResponse(), applying parameters)
   lives in audio/engine.js instead -- this module only holds the constants
   and the math that decides what those real nodes should be set to, and
   the serialization rules storage/prefs.js reuses.

   Tilt convention: a positive tiltDb is BRIGHTER (cuts the low shelf,
   boosts the high shelf); negative is warmer. Both shelves pivot at the
   same TILT_PIVOT_HZ, per the doc's own "pivot near 1 kHz... low shelf and
   high shelf moving in opposite directions." */

// 10-band ISO graphic EQ, 31 Hz to 16 kHz (doubling each band, one octave
// apart -- the doc's own "10-band graphic (31 Hz to 16 kHz, ±12 dB)").
export const GRAPHIC_BANDS_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
// 1/sqrt(2): the standard Q for a one-octave-spaced graphic band, wide
// enough that adjacent bands overlap (which is exactly why the doc says to
// draw the *combined* response, not the slider positions -- McCarthy 2.4.2.2).
export const GRAPHIC_BAND_Q = Math.SQRT1_2;
export const GRAPHIC_BAND_MAX_DB = 12;

export const TILT_PIVOT_HZ = 1000;
export const TILT_MAX_DB = 6;

export const MAX_PARAMETRIC_BANDS = 6;
export const PARAMETRIC_BAND_MAX_DB = 12;
// 'lowcut'/'highcut' map to a biquad highpass/lowpass in engine.js (gain is
// ignored for those two types -- only frequency/Q apply).
export const PARAMETRIC_TYPES = ['peak', 'lowshelf', 'highshelf', 'lowcut', 'highcut'];
export const PARAMETRIC_GAIN_TYPES = ['peak', 'lowshelf', 'highshelf'];

export const PREAMP_MIN_DB = -24;
export const PREAMP_MAX_DB = 12;

// Standard 1/3-octave band centers, 20 Hz to 20 kHz -- used only by the
// Verify script's own "matches getFrequencyResponse() within 0.1 dB at
// 1/3-octave points" check (docs/16_AUDIO.md §3), not by the app itself.
export const THIRD_OCTAVE_HZ = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
  12500, 16000, 20000,
];

// Built-in presets as 10-band graphic gain arrays. "Ears latch onto peaks
// more than dips (McCarthy 5.3.1), so the built-in presets favor cuts over
// boosts" -- every one of these is zero or negative, never a boost. Names
// are placeholders Ken may rename, per the doc's own note.
export const EQ_PRESETS = {
  flat: { tilt: 0, graphicBands: GRAPHIC_BANDS_HZ.map(() => 0) },
  warm: { tilt: 0, graphicBands: [0, 0, 0, 0, 0, 0, -1, -2, -3, -4] },
  bright: { tilt: 0, graphicBands: [-4, -3, -2, -1, 0, 0, 0, 0, 0, 0] },
  vocals: { tilt: 0, graphicBands: [-3, -2, -1, -1, 0, 0, 0, 0, -1, -2] },
  lessBass: { tilt: 0, graphicBands: [-6, -5, -3, -1, 0, 0, 0, 0, 0, 0] },
};
export const EQ_PRESET_LABELS = {
  flat: 'FLAT', warm: 'WARM', bright: 'BRIGHT', vocals: 'VOCALS', lessBass: 'LESS BASS',
};
export const EQ_PRESET_KEYS = Object.keys(EQ_PRESETS);

/* Headphone-correction presets -- a different kind of preset than
   EQ_PRESETS above: those are taste shaping, these are real published
   *measurement* corrections (the follow-on ask's own wording). Each is
   oratory1990's own measurement of the named headphone, run through the
   open-source AutoEQ project (github.com/jaakkopasanen/AutoEq, MIT
   licensed, github.com/jaakkopasanen/AutoEq/blob/master/LICENSE) against
   the Harman over-ear 2018 target curve -- the real filters AutoEQ
   publishes for that measurement, not an invented approximation.

   AutoEQ's own raw result is a 10-band parametric EQ; this app's own
   parametric EQ caps at MAX_PARAMETRIC_BANDS (6, AU6), so each preset
   here keeps only the 6 largest-magnitude filters from the published 10
   -- AutoEQ's own tooling ships reduced-band versions of its results the
   same way, so dropping the four smallest refinements is a documented
   simplification already established by the source project, not a new
   approximation invented for this app. No preampDb of its own: applying
   a preset leaves eq.autoPreamp on, so engine.js's own
   autoPreampDbFromPeak() derives the right preamp for *this* reduced
   band set from the real combined curve, rather than carrying over
   AutoEQ's preamp (computed against the full 10-band curve, which would
   be slightly wrong once four bands are dropped).

   A small, recognizable set, not an attempt at a real headphone
   database -- open-back/closed-back/ANC/studio/budget, one each, so most
   listeners can find something in their own neighborhood. */
export const HEADPHONE_PRESETS = {
  sonyWh1000xm4: {
    label: 'Sony WH-1000XM4',
    bands: [
      { type: 'peak', freq: 2289, gainDb: 6.1, q: 1.57 },
      { type: 'peak', freq: 143, gainDb: -5.2, q: 1.10 },
      { type: 'lowshelf', freq: 105, gainDb: -4.2, q: 0.70 },
      { type: 'peak', freq: 5144, gainDb: -3.2, q: 6.00 },
      { type: 'peak', freq: 6715, gainDb: 3.0, q: 5.99 },
      { type: 'peak', freq: 407, gainDb: 1.7, q: 3.14 },
    ],
  },
  sennheiserHd650: {
    label: 'Sennheiser HD 650',
    bands: [
      { type: 'lowshelf', freq: 105, gainDb: 6.4, q: 0.70 },
      { type: 'peak', freq: 8800, gainDb: 5.1, q: 1.42 },
      { type: 'peak', freq: 118, gainDb: -3.1, q: 0.50 },
      { type: 'highshelf', freq: 10000, gainDb: -2.1, q: 0.70 },
      { type: 'peak', freq: 3169, gainDb: -1.7, q: 3.89 },
      { type: 'peak', freq: 1227, gainDb: -1.2, q: 2.53 },
    ],
  },
  appleAirpodsMax: {
    label: 'Apple AirPods Max',
    bands: [
      { type: 'highshelf', freq: 10000, gainDb: -5.5, q: 0.70 },
      { type: 'peak', freq: 7273, gainDb: 3.6, q: 2.41 },
      { type: 'peak', freq: 1031, gainDb: -3.2, q: 0.99 },
      { type: 'peak', freq: 3185, gainDb: 3.1, q: 0.56 },
      { type: 'lowshelf', freq: 105, gainDb: -3.0, q: 0.70 },
      { type: 'peak', freq: 218, gainDb: -2.9, q: 1.41 },
    ],
  },
  athM50x: {
    label: 'Audio-Technica ATH-M50x',
    bands: [
      { type: 'peak', freq: 326, gainDb: 5.3, q: 1.59 },
      { type: 'peak', freq: 156, gainDb: -5.2, q: 0.73 },
      { type: 'highshelf', freq: 10000, gainDb: -4.1, q: 0.70 },
      { type: 'peak', freq: 7077, gainDb: 2.8, q: 2.22 },
      { type: 'peak', freq: 3483, gainDb: 2.1, q: 5.82 },
      { type: 'peak', freq: 66, gainDb: 1.4, q: 3.59 },
    ],
  },
  beyerdynamicDt770Pro: {
    label: 'Beyerdynamic DT 770 Pro',
    bands: [
      { type: 'peak', freq: 3684, gainDb: 6.8, q: 2.88 },
      { type: 'highshelf', freq: 10000, gainDb: -5.4, q: 0.70 },
      { type: 'peak', freq: 6430, gainDb: -4.2, q: 0.97 },
      { type: 'peak', freq: 139, gainDb: -3.9, q: 4.92 },
      { type: 'peak', freq: 213, gainDb: 3.5, q: 2.46 },
      { type: 'peak', freq: 93, gainDb: 3.5, q: 3.00 },
    ],
  },
};
export const HEADPHONE_PRESET_KEYS = Object.keys(HEADPHONE_PRESETS);

export function clamp(v, lo, hi){
  if(typeof v !== 'number' || !isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
export const clampTiltDb = db => clamp(db, -TILT_MAX_DB, TILT_MAX_DB);
export const clampGraphicBandDb = db => clamp(db, -GRAPHIC_BAND_MAX_DB, GRAPHIC_BAND_MAX_DB);
export const clampParametricGainDb = db => clamp(db, -PARAMETRIC_BAND_MAX_DB, PARAMETRIC_BAND_MAX_DB);
export const clampPreampDb = db => clamp(db, PREAMP_MIN_DB, PREAMP_MAX_DB);
export const clampFreqHz = hz => clamp(hz, 20, 20000);
export const clampQ = q => clamp(q, 0.1, 18);

// §3's own gain clamp: "when the combined curve rises above 0 dB
// anywhere, lower the preamp by that peak." peakDb is the curve's own
// maximum across whatever frequencies it was sampled at; a curve that
// never rises above 0 dB needs no attenuation at all.
export function autoPreampDbFromPeak(peakDb){
  if(typeof peakDb !== 'number' || !isFinite(peakDb) || peakDb <= 0) return 0;
  return clampPreampDb(-peakDb);
}

// Filters in series: the combined magnitude response is the *product* of
// each filter's own magnitude, so the combined dB curve is the *sum* of
// each filter's own dB curve. `dbArrays` is one array of per-frequency dB
// values per filter (all the same length, one length per sampled
// frequency) -- engine.js builds each one from a real
// BiquadFilterNode.getFrequencyResponse() call.
export function combineDbCurve(dbArrays){
  if(!dbArrays || !dbArrays.length) return [];
  const n = dbArrays[0].length;
  const out = new Array(n).fill(0);
  for(const arr of dbArrays) for(let i = 0; i < n; i++) out[i] += arr[i];
  return out;
}

// Log-spaced sample points for drawing the curve and for the auto-preamp
// peak scan -- dense enough to not miss a narrow parametric peak/notch,
// without needing a filter-node call per on-screen pixel.
export function sampleFrequenciesLog(count = 120, lo = 20, hi = 20000){
  const out = new Array(count);
  const logLo = Math.log(lo), logHi = Math.log(hi);
  for(let i = 0; i < count; i++){
    const f = i / (count - 1);
    out[i] = Math.exp(logLo + (logHi - logLo) * f);
  }
  return out;
}

function arraysMatch(a, b, epsilon){
  if(!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for(let i = 0; i < a.length; i++) if(Math.abs(a[i] - b[i]) > epsilon) return false;
  return true;
}

// Graphic-mode "is this exactly one of the built-in presets, or has the
// user moved something" check -- the doc's own "CUSTOM (whenever the bands
// don't match a preset)" chip. Only meaningful in graphic mode: a
// parametric-mode configuration never matches a (graphic-only) preset, so
// callers should only check this while S.eq.mode === 'graphic'.
export function matchPreset(graphicBands, tilt, epsilon = 0.01){
  if(Math.abs(tilt || 0) > epsilon) return null;
  for(const key of EQ_PRESET_KEYS){
    if(arraysMatch(graphicBands, EQ_PRESETS[key].graphicBands, epsilon)) return key;
  }
  return null;
}

// Parametric-mode twin of matchPreset above, for the "which headphone
// correction is currently applied" chip state -- compares a band list
// field by field, in order, since applying a preset always writes its
// bands in exactly the order they're stored here.
export function matchHeadphonePreset(parametricBands, epsilon = 0.01){
  if(!Array.isArray(parametricBands)) return null;
  for(const key of HEADPHONE_PRESET_KEYS){
    const bands = HEADPHONE_PRESETS[key].bands;
    if(parametricBands.length !== bands.length) continue;
    let match = true;
    for(let i = 0; i < bands.length; i++){
      const a = parametricBands[i], b = bands[i];
      if(a.type !== b.type || Math.abs(a.freq - b.freq) > epsilon
        || Math.abs(a.gainDb - b.gainDb) > epsilon || Math.abs(a.q - b.q) > epsilon){
        match = false; break;
      }
    }
    if(match) return key;
  }
  return null;
}

// Cleans one parametric band -- used both by storage/prefs.js's parsePrefs
// and by the EQ sheet's own "add band" UI. Returns null for anything that
// isn't a usable band at all (missing/invalid type), rather than guessing.
export function sanitizeParametricBand(raw){
  if(!raw || typeof raw !== 'object') return null;
  if(!PARAMETRIC_TYPES.includes(raw.type)) return null;
  const band = {
    type: raw.type,
    freq: clampFreqHz(typeof raw.freq === 'number' ? raw.freq : 1000),
    q: clampQ(typeof raw.q === 'number' ? raw.q : 0.7),
  };
  // gain only means something for peak/shelf types -- a cut filter's own
  // "amount" is its frequency/Q, so keep gainDb at 0 rather than carrying
  // a stray number a cut-type band would simply never apply.
  band.gainDb = PARAMETRIC_GAIN_TYPES.includes(raw.type)
    ? clampParametricGainDb(typeof raw.gainDb === 'number' ? raw.gainDb : 0)
    : 0;
  return band;
}

export function sanitizeParametricBands(rawList){
  if(!Array.isArray(rawList)) return [];
  return rawList.map(sanitizeParametricBand).filter(Boolean).slice(0, MAX_PARAMETRIC_BANDS);
}

export function defaultEqState(){
  return {
    enabled: false,
    mode: 'graphic',
    tilt: 0,
    graphicBands: GRAPHIC_BANDS_HZ.map(() => 0),
    parametricBands: [],
    autoPreamp: true,
    preampDb: 0,
    savedPresets: {},
  };
}
