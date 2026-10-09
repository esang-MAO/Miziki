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

// The exact object saveMeta() has always written under meta/prefs — same
// field names, read back by parsePrefs below.
export function serializePrefs(S){
  return {
    mode: S.mode, target: S.target, pace: S.pace, char: S.char,
    shuffle: S.shuffle, repeat: S.repeat, auto: S.auto, sleevePullEnabled: S.sleevePullEnabled, librarySort: S.librarySort,
    bgAudio: S.bgAudio, launchIntro: S.launchIntro,
    libraryLayout: S.libraryLayout, crateGroup: S.crateGroup, crateAnchor: S.crateAnchor, albumSides: S.albumSides,
    sealedRecords: S.sealedRecords, playInFullPlayer: S.playInFullPlayer,
    shareStyle: S.shareStyle, shareFormat: S.shareFormat,
  };
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
  if(p.crateGroup === 'az' || p.crateGroup === 'genre') out.crateGroup = p.crateGroup;
  if(p.crateAnchor) out.crateAnchor = p.crateAnchor;
  if(typeof p.albumSides === 'boolean') out.albumSides = p.albumSides;
  if(typeof p.sealedRecords === 'boolean') out.sealedRecords = p.sealedRecords;
  if(typeof p.playInFullPlayer === 'boolean') out.playInFullPlayer = p.playInFullPlayer;
  if(p.shareStyle === 'night' || p.shareStyle === 'cover' || p.shareStyle === 'paper') out.shareStyle = p.shareStyle;
  if(p.shareFormat === 'story' || p.shareFormat === 'portrait' || p.shareFormat === 'square') out.shareFormat = p.shareFormat;
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
