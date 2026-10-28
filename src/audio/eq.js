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
// PL8 item 1 (docs/19_PLAYER.md): manual preamp used to go to +12 dB, which
// can only ever push the combined curve into the limiter -- auto-preamp
// already prevents that for the auto path, so the manual path is capped at
// 0 dB too. Saved values above 0 clamp down on load via clampPreampDb below
// (storage/prefs.js), without touching anything else about the saved state.
export const PREAMP_MAX_DB = 0;

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

export function clamp(v, lo, hi){
  if(typeof v !== 'number' || !isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
export const clampTiltDb = db => clamp(db, -TILT_MAX_DB, TILT_MAX_DB);

// PL8 item 3 (docs/19_PLAYER.md): at the engine's own rate, Web Audio's
// biquads cramp near the top of the band, and lossy files hide their
// artifacts up there -- so a *boost* at or above 10 kHz is capped lower
// than the general band ceiling. Cuts are never affected (nothing here
// stops a cut from reaching the full -GRAPHIC_BAND_MAX_DB/-PARAMETRIC_BAND_MAX_DB).
export const TREBLE_BOOST_CAP_HZ = 10000;
export const TREBLE_BOOST_CAP_DB = 6;

// `hz` is optional so every pre-PL8 call site (which has no frequency to
// give, or whose band is always below the treble line) keeps the plain
// symmetric ±GRAPHIC_BAND_MAX_DB clamp unchanged.
export function clampGraphicBandDb(db, hz){
  if(typeof hz === 'number' && hz >= TREBLE_BOOST_CAP_HZ && typeof db === 'number' && db > 0){
    return clamp(db, 0, TREBLE_BOOST_CAP_DB);
  }
  return clamp(db, -GRAPHIC_BAND_MAX_DB, GRAPHIC_BAND_MAX_DB);
}

// `type`/`freq` are optional for the same reason as clampGraphicBandDb's
// `hz` -- only a high-shelf or peak band at or above the treble line gets
// the lower boost cap (lowshelf boosts the low end, not the top; lowcut/
// highcut ignore gain entirely).
export function clampParametricGainDb(db, type, freq){
  const isTrebleBand = (type === 'highshelf' || type === 'peak')
    && typeof freq === 'number' && freq >= TREBLE_BOOST_CAP_HZ;
  if(isTrebleBand && typeof db === 'number' && db > 0){
    return clamp(db, 0, TREBLE_BOOST_CAP_DB);
  }
  return clamp(db, -PARAMETRIC_BAND_MAX_DB, PARAMETRIC_BAND_MAX_DB);
}
export const clampPreampDb = db => clamp(db, PREAMP_MIN_DB, PREAMP_MAX_DB);
export const clampFreqHz = hz => clamp(hz, 20, 20000);
export const clampQ = q => clamp(q, 0.1, 18);

// PL8 item 2: a narrow (high-Q), tall (big-dB) boost rings and sounds
// whistly -- cuts keep the full Q range (a narrow notch is exactly what a
// surgical cut wants), so this only narrows the ceiling for a *boost*
// above BOOST_NARROW_Q_THRESHOLD_DB. `gainDb`/`type` optional for the same
// reason as the two clamps above.
export const BOOST_NARROW_Q_THRESHOLD_DB = 6;
export const BOOST_NARROW_Q_MAX = 3;
export function clampQForBand(q, gainDb, type){
  const isBoost = PARAMETRIC_GAIN_TYPES.includes(type) && typeof gainDb === 'number' && gainDb > BOOST_NARROW_Q_THRESHOLD_DB;
  return clamp(q, 0.1, isBoost ? BOOST_NARROW_Q_MAX : 18);
}

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

// Cleans one parametric band -- used both by storage/prefs.js's parsePrefs
// and by the EQ sheet's own "add band" UI. Returns null for anything that
// isn't a usable band at all (missing/invalid type), rather than guessing.
export function sanitizeParametricBand(raw){
  if(!raw || typeof raw !== 'object') return null;
  if(!PARAMETRIC_TYPES.includes(raw.type)) return null;
  const band = {
    type: raw.type,
    freq: clampFreqHz(typeof raw.freq === 'number' ? raw.freq : 1000),
  };
  // gain only means something for peak/shelf types -- a cut filter's own
  // "amount" is its frequency/Q, so keep gainDb at 0 rather than carrying
  // a stray number a cut-type band would simply never apply. Gain is
  // clamped before Q (PL8 items 2-3), since a saved Q that was fine for a
  // 0 dB boost may no longer fit once a stale/synced gain above the
  // treble or narrow-Q threshold gets capped back down on load.
  band.gainDb = PARAMETRIC_GAIN_TYPES.includes(raw.type)
    ? clampParametricGainDb(typeof raw.gainDb === 'number' ? raw.gainDb : 0, band.type, band.freq)
    : 0;
  band.q = clampQForBand(typeof raw.q === 'number' ? raw.q : 0.7, band.gainDb, band.type);
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
