/* ================= saved settings: parse, then apply =================
   Split out of main.js's applyPrefs()/saveMeta() (step 4b) into two pure
   functions, so the part that matters for data safety — does an old or
   malformed saved object still load correctly — can be tested without a
   DOM or a database. applyPrefs() itself stays in main.js (it calls
   setMode(), cycleRepeat(), bgUpdateUI() and other screen/side-effect
   functions) and now takes parsePrefs()'s output instead of the raw saved
   object; saveMeta() now writes serializePrefs(S) instead of building the
   object inline. Neither this split, nor moving it here, changes what
   gets saved or how a saved object is read back — same field names, same
   checks, same allowed values as before.

   Rule for later additions: every new saved setting goes into BOTH
   serializePrefs and parsePrefs, gets a default in S (src/state.js), and
   gets a test here that an old saved object without it still loads with
   that default in place. */

import {
  GRAPHIC_BANDS_HZ, MAX_PARAMETRIC_BANDS, sanitizeParametricBands,
  clampTiltDb, clampGraphicBandDb, clampPreampDb,
} from '../audio/eq.js';

// every key serializePrefs itself writes below — the whitelist
// rememberUnknownPrefsKeys() (RF17, docs/12_REFINE.md) checks a remote
// prefs object's own keys against, so only genuinely-unrecognized keys
// are cached and echoed back; keep this listing in sync with the object
// literal below whenever a new saved setting is added (see the rule at
// the top of this file).
const KNOWN_PREF_KEYS = new Set([
  'mode', 'target', 'pace', 'char', 'shuffle', 'repeat', 'auto', 'sleevePullEnabled', 'librarySort',
  'bgAudio', 'launchIntro',
  'libraryLayout', 'crateGroup', 'crateAnchor', 'albumSides',
  'sealedRecords', 'playInFullPlayer',
  'shareStyle', 'shareFormatByCard',
  'theme', 'charDrift',
  'slipmatCustom', 'slipmatWordmark', 'slipmatDim',
  'paperLabelOnLossy',
  'surfaceNoise', 'runoutLength', 'surfaceNoiseUnderMusic',
  'autoFlip',
  'loudnessMode',
  'eq',
  'mono', 'balance', 'deviceVolume',
  'zoetropesEnabled',
]);

// RF17 (docs/12_REFINE.md, "merge per item, not per blob", point 4):
// prefs is now merged per key (src/sync/merge.js's
// mergeKeyedLastWriteWins), so an older installed copy simply never
// contributes a competing stamp for a key it doesn't recognize — a newer
// device's own setting can't be clobbered on merge. But without this
// cache, an old build would still quietly *drop* that key the moment it
// re-serializes its own prefs (S never held it in memory, so it's absent
// from the object literal above) — both in its local meta/'prefs' store
// and in its own next uploaded doc, discarding data it was never asked to
// change. src/sync/backup.js's applyPrefsPatch() calls this with the
// merged prefs object on every pull, before parsePrefs() filters it down
// to what this build understands; serializePrefs() below then echoes
// whatever's left over back onto every save, verbatim, until a build that
// does understand the key changes it for real (at which point the next
// pull's own merged object simply won't have it marked unknown anymore).
let unknownPrefKeys = null;
export function rememberUnknownPrefsKeys(raw){
  if(!raw || typeof raw !== 'object') return;
  const extra = {};
  Object.keys(raw).forEach(k => { if(!KNOWN_PREF_KEYS.has(k)) extra[k] = raw[k]; });
  unknownPrefKeys = Object.keys(extra).length ? extra : null;
}

// The exact object saveMeta() has always written under meta/prefs — same
// field names, read back by parsePrefs below, plus (RF17) whatever keys a
// newer device's own prefs carried that this build doesn't recognize yet.
export function serializePrefs(S){
  return Object.assign({
    mode: S.mode, target: S.target, pace: S.pace, char: S.char,
    shuffle: S.shuffle, repeat: S.repeat, auto: S.auto, sleevePullEnabled: S.sleevePullEnabled, librarySort: S.librarySort,
    bgAudio: S.bgAudio, launchIntro: S.launchIntro,
    libraryLayout: S.libraryLayout, crateGroup: S.crateGroup, crateAnchor: S.crateAnchor, albumSides: S.albumSides,
    sealedRecords: S.sealedRecords, playInFullPlayer: S.playInFullPlayer,
    shareStyle: S.shareStyle, shareFormatByCard: S.shareFormatByCard,
    theme: S.theme,
    charDrift: S.charDrift,
    slipmatCustom: S.slipmatCustom, slipmatWordmark: S.slipmatWordmark, slipmatDim: S.slipmatDim,
    paperLabelOnLossy: S.paperLabelOnLossy,
    surfaceNoise: S.surfaceNoise, runoutLength: S.runoutLength, surfaceNoiseUnderMusic: S.surfaceNoiseUnderMusic,
    autoFlip: S.autoFlip,
    loudnessMode: S.loudnessMode,
    eq: S.eq,
    mono: S.mono, balance: S.balance, deviceVolume: S.deviceVolume,
    zoetropesEnabled: S.zoetropesEnabled,
  }, unknownPrefKeys || {});
}

// the four character sliders are plain 0..1 numbers; `scratch` (F2) is a
// boolean living in the same S.char object but checked separately below,
// same as applyPrefs always has
const CHAR_SLIDER_KEYS = ['wow', 'sat', 'soft', 'comp'];

// Returns a clean object containing only the fields that pass the same
// checks applyPrefs has always made inline. Anything that fails a check —
// wrong type, an unlisted enum value, or simply missing — is left out, so
// applyPrefs (reading from this instead of the raw saved object) leaves
// that field's default in place, exactly as it does today.
export function parsePrefs(raw){
  const p = raw || {};
  const out = {};

  if(p.char && typeof p.char === 'object'){
    const char = {};
    for(const k of CHAR_SLIDER_KEYS){ if(typeof p.char[k] === 'number') char[k] = p.char[k]; }
    if(typeof p.char.scratch === 'boolean') char.scratch = p.char.scratch;
    if(Object.keys(char).length) out.char = char;
  }
  if(typeof p.target === 'number') out.target = p.target;
  if(p.pace) out.pace = p.pace;
  if(typeof p.auto === 'boolean') out.auto = p.auto;
  if(p.librarySort) out.librarySort = p.librarySort;
  if(typeof p.sleevePullEnabled === 'boolean') out.sleevePullEnabled = p.sleevePullEnabled;
  if(typeof p.bgAudio === 'boolean') out.bgAudio = p.bgAudio;
  if(typeof p.launchIntro === 'boolean') out.launchIntro = p.launchIntro;
  if(p.libraryLayout === 'crate' || p.libraryLayout === 'list') out.libraryLayout = p.libraryLayout;
  if(p.crateGroup === 'az' || p.crateGroup === 'genre' || p.crateGroup === 'decade') out.crateGroup = p.crateGroup;
  if(p.crateAnchor) out.crateAnchor = p.crateAnchor;
  if(typeof p.albumSides === 'boolean') out.albumSides = p.albumSides;
  if(typeof p.sealedRecords === 'boolean') out.sealedRecords = p.sealedRecords;
  if(typeof p.playInFullPlayer === 'boolean') out.playInFullPlayer = p.playInFullPlayer;
  if(p.shareStyle === 'night' || p.shareStyle === 'cover' || p.shareStyle === 'paper') out.shareStyle = p.shareStyle;
  // SH1 (docs/18_SHARE.md): one format default per card, not one for the
  // whole app -- each card's own saved choice is checked individually, so
  // a malformed or missing entry for one card never drops the others.
  if(p.shareFormatByCard && typeof p.shareFormatByCard === 'object'){
    const sfbc = {};
    ['nowPlaying', 'record', 'pressings', 'crate', 'season'].forEach(card => {
      const v = p.shareFormatByCard[card];
      if(v === 'story' || v === 'portrait' || v === 'square') sfbc[card] = v;
    });
    if(Object.keys(sfbc).length) out.shareFormatByCard = sfbc;
  }
  // D2 (docs/DESKTOP_LAYOUT.md): a saved object without this field (every
  // device before D2) is meant to load as the default (Auto) — same as
  // any other missing field, just leaving it out of `out` below. DA4
  // (docs/DAY_ARC.md) adds 'nychthemeron' to the same enum — an old saved
  // object predating DA4 simply never wrote that value, so it needs no
  // extra handling here beyond listing it as allowed.
  if(p.theme === 'auto' || p.theme === 'light' || p.theme === 'dark' || p.theme === 'nychthemeron') out.theme = p.theme;
  // DA2 (docs/DAY_ARC.md): a saved object without this field (every device
  // before DA2) is meant to load as the default (Subtle) — same shape as
  // theme's own D2 addition just above, just leaving it out of `out`.
  if(p.charDrift === 'off' || p.charDrift === 'subtle' || p.charDrift === 'full') out.charDrift = p.charDrift;
  // CEREMONY §6: the custom slipmat's flags. An object saved before them
  // loads as felt, wordmark on, dim on (the S defaults).
  if(typeof p.slipmatCustom === 'boolean') out.slipmatCustom = p.slipmatCustom;
  if(typeof p.slipmatWordmark === 'boolean') out.slipmatWordmark = p.slipmatWordmark;
  if(typeof p.slipmatDim === 'boolean') out.slipmatDim = p.slipmatDim;
  // "Decided" (docs/13_CRATE.md, CR7): the paper-label switch. A saved
  // object without this field (every device before CR7) loads as off —
  // the S default, amber label on every tier-1 record.
  if(typeof p.paperLabelOnLossy === 'boolean') out.paperLabelOnLossy = p.paperLabelOnLossy;
  // docs/15_SURFACE_NOISE.md §1: a saved object without these (every
  // device before this feature) loads as the stated defaults — Subtle,
  // Normal, and the under-the-music bed off — the same "missing means the
  // default" shape charDrift's own DA2 addition already established.
  if(p.surfaceNoise === 'off' || p.surfaceNoise === 'subtle' || p.surfaceNoise === 'well-loved') out.surfaceNoise = p.surfaceNoise;
  if(p.runoutLength === 'short' || p.runoutLength === 'normal' || p.runoutLength === 'until-lift') out.runoutLength = p.runoutLength;
  if(typeof p.surfaceNoiseUnderMusic === 'boolean') out.surfaceNoiseUnderMusic = p.surfaceNoiseUnderMusic;
  // docs/15_SURFACE_NOISE.md §4: a saved object without this (every device
  // before this PR) loads as On, the stated default and today's behavior.
  if(typeof p.autoFlip === 'boolean') out.autoFlip = p.autoFlip;
  // AU5 (docs/16_AUDIO.md §4): a saved object without this (every device
  // before this PR) loads as Auto, the stated default.
  if(p.loudnessMode === 'off' || p.loudnessMode === 'track' || p.loudnessMode === 'album' || p.loudnessMode === 'auto') out.loudnessMode = p.loudnessMode;
  // AU6 (docs/16_AUDIO.md §3): a saved object without this (every device
  // before this PR) loads with the EQ off and flat, the stated default.
  // Every field is independently type-checked/clamped rather than trusted
  // whole — the same defensive shape p.char gets above — so a malformed
  // or out-of-range saved value (a hand-edited backup doc, a future
  // build's wider range) can never read back as something exceeding
  // eq.js's own clamp constants.
  if(p.eq && typeof p.eq === 'object'){
    const eq = {};
    if(typeof p.eq.enabled === 'boolean') eq.enabled = p.eq.enabled;
    if(p.eq.mode === 'graphic' || p.eq.mode === 'parametric') eq.mode = p.eq.mode;
    if(typeof p.eq.tilt === 'number') eq.tilt = clampTiltDb(p.eq.tilt);
    if(Array.isArray(p.eq.graphicBands)){
      eq.graphicBands = GRAPHIC_BANDS_HZ.map((_, i) =>
        typeof p.eq.graphicBands[i] === 'number' ? clampGraphicBandDb(p.eq.graphicBands[i]) : 0);
    }
    if(Array.isArray(p.eq.parametricBands)) eq.parametricBands = sanitizeParametricBands(p.eq.parametricBands);
    if(typeof p.eq.autoPreamp === 'boolean') eq.autoPreamp = p.eq.autoPreamp;
    if(typeof p.eq.preampDb === 'number') eq.preampDb = clampPreampDb(p.eq.preampDb);
    if(p.eq.savedPresets && typeof p.eq.savedPresets === 'object'){
      const saved = {};
      for(const name of Object.keys(p.eq.savedPresets).slice(0, MAX_PARAMETRIC_BANDS * 4)){
        const preset = p.eq.savedPresets[name];
        if(!preset || typeof preset !== 'object') continue;
        const cleanPreset = {};
        if(preset.mode === 'graphic' || preset.mode === 'parametric') cleanPreset.mode = preset.mode;
        if(typeof preset.tilt === 'number') cleanPreset.tilt = clampTiltDb(preset.tilt);
        if(Array.isArray(preset.graphicBands)){
          cleanPreset.graphicBands = GRAPHIC_BANDS_HZ.map((_, i) =>
            typeof preset.graphicBands[i] === 'number' ? clampGraphicBandDb(preset.graphicBands[i]) : 0);
        }
        if(Array.isArray(preset.parametricBands)) cleanPreset.parametricBands = sanitizeParametricBands(preset.parametricBands);
        if(typeof name === 'string' && name.length && name.length <= 40) saved[name] = cleanPreset;
      }
      eq.savedPresets = saved;
    }
    if(Object.keys(eq).length) out.eq = eq;
  }
  // AU7 (docs/16_AUDIO.md §6): a saved object without these (every device
  // before this PR) loads off and centered, the same "missing means the
  // stated default" shape eq's own addition just above established.
  // balance/deviceVolume are clamped the same defensive way audio/
  // engine.js's own applyMonoBalance()/applyDeviceVolume() clamp them —
  // duplicated rather than imported, since engine.js real-chains into
  // player/background.js/sundown/location.js and this module stays a
  // leaf on purpose (storage/prefs.js's own header comment).
  if(typeof p.mono === 'boolean') out.mono = p.mono;
  if(typeof p.balance === 'number') out.balance = Math.max(-1, Math.min(1, p.balance));
  if(typeof p.deviceVolume === 'number') out.deviceVolume = Math.max(0, Math.min(1, p.deviceVolume));
  // Follow-up to PRESSINGS_110 PR7: a saved object without this (every
  // device before this PR) loads as on, the stated default and today's
  // behavior — the same "missing means the default" shape every other
  // boolean toggle in this file already follows.
  if(typeof p.zoetropesEnabled === 'boolean') out.zoetropesEnabled = p.zoetropesEnabled;
  // repeat/shuffle: applyPrefs decides what to do with these against the
  // *current* S.repeat/S.shuffle at apply time (cycling toward a saved
  // repeat mode, turning shuffle on if it was saved on) — that's a runtime
  // decision, not a validity check of the saved value, so it stays there.
  // repeat keeps applyPrefs's original truthy-only check (any truthy string
  // is attempted; cycleRepeat()'s own 3-cycle cap makes an unrecognized one
  // harmless). shuffle is checked as a real boolean here, not truthy-only —
  // applyPrefs's own `if(parsed.shuffle && !S.shuffle)` already treats a
  // present-but-false value exactly like an absent one, so this is stricter
  // without changing what applyPrefs does with it, and it's what lets a
  // saved `shuffle: false` round-trip instead of silently disappearing.
  if(p.repeat) out.repeat = p.repeat;
  if(typeof p.shuffle === 'boolean') out.shuffle = p.shuffle;
  if(p.mode) out.mode = p.mode;

  return out;
}
