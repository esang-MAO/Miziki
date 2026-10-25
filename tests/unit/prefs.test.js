import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializePrefs, parsePrefs, rememberUnknownPrefsKeys } from '../../src/storage/prefs.js';

function fakeS(overrides = {}){
  return Object.assign({
    mode: 'vinyl', target: 0.80, pace: 'window',
    char: { wow: 0.30, sat: 0.35, soft: 0.40, comp: 0.35, scratch: true },
    shuffle: false, repeat: 'off', auto: true, sleevePullEnabled: true, librarySort: 'artist',
    bgAudio: false, launchIntro: true,
    libraryLayout: 'crate', crateGroup: 'az', crateAnchor: 'some-anchor', albumSides: false,
    sealedRecords: true, playInFullPlayer: true,
    shareStyle: 'night', shareFormat: 'story',
    theme: 'auto',
    charDrift: 'subtle',
    slipmatCustom: false, slipmatWordmark: true, slipmatDim: true,
    paperLabelOnLossy: false,
    surfaceNoise: 'subtle', runoutLength: 'normal', surfaceNoiseUnderMusic: false,
    autoFlip: true,
    loudnessMode: 'auto',
    eq: { enabled: false, mode: 'graphic', tilt: 0, graphicBands: [0,0,0,0,0,0,0,0,0,0], parametricBands: [], autoPreamp: true, preampDb: 0, savedPresets: {} },
  }, overrides);
}

test('round trip: parsePrefs(serializePrefs(S)) returns every field with the same value', () => {
  const S = fakeS();
  const parsed = parsePrefs(serializePrefs(S));
  assert.deepEqual(parsed, {
    mode: S.mode, target: S.target, pace: S.pace, char: S.char,
    shuffle: S.shuffle, repeat: S.repeat, auto: S.auto, sleevePullEnabled: S.sleevePullEnabled, librarySort: S.librarySort,
    bgAudio: S.bgAudio, launchIntro: S.launchIntro,
    libraryLayout: S.libraryLayout, crateGroup: S.crateGroup, crateAnchor: S.crateAnchor, albumSides: S.albumSides,
    sealedRecords: S.sealedRecords, playInFullPlayer: S.playInFullPlayer,
    shareStyle: S.shareStyle, shareFormat: S.shareFormat,
    theme: S.theme,
    charDrift: S.charDrift,
    slipmatCustom: S.slipmatCustom, slipmatWordmark: S.slipmatWordmark, slipmatDim: S.slipmatDim,
    paperLabelOnLossy: S.paperLabelOnLossy,
    surfaceNoise: S.surfaceNoise, runoutLength: S.runoutLength, surfaceNoiseUnderMusic: S.surfaceNoiseUnderMusic,
    autoFlip: S.autoFlip,
    loudnessMode: S.loudnessMode,
    eq: S.eq,
  });
});

// CR4 (docs/13_CRATE.md): crateGroup's third valid value, decade — same
// round-trip coverage as the pre-existing az/genre case above, just for
// the new one.
test('round trip: crateGroup "decade" survives (CR4)', () => {
  const parsed = parsePrefs(serializePrefs(fakeS({ crateGroup: 'decade' })));
  assert.equal(parsed.crateGroup, 'decade');
});

test('round trip: the slipmat flags survive with non-default values (CEREMONY §6)', () => {
  const parsed = parsePrefs(serializePrefs(fakeS({ slipmatCustom: true, slipmatWordmark: false, slipmatDim: false })));
  assert.equal(parsed.slipmatCustom, true);
  assert.equal(parsed.slipmatWordmark, false);
  assert.equal(parsed.slipmatDim, false);
});

test('old saved data: no slipmat fields (saved before CEREMONY §6) leaves them out, so felt stays the default', () => {
  const raw = serializePrefs(fakeS());
  delete raw.slipmatCustom; delete raw.slipmatWordmark; delete raw.slipmatDim;
  const parsed = parsePrefs(raw);
  assert.equal('slipmatCustom' in parsed, false);
  assert.equal('slipmatWordmark' in parsed, false);
  assert.equal('slipmatDim' in parsed, false);
});

test('bad values are ignored: non-boolean slipmat flags', () => {
  const parsed = parsePrefs({ slipmatCustom: 'yes', slipmatWordmark: 1, slipmatDim: null });
  assert.deepEqual(parsed, {});
});

// "Decided" (docs/13_CRATE.md, CR7): the paper-label switch.
test('round trip: paperLabelOnLossy survives when on', () => {
  const parsed = parsePrefs(serializePrefs(fakeS({ paperLabelOnLossy: true })));
  assert.equal(parsed.paperLabelOnLossy, true);
});

test('old saved data: no paperLabelOnLossy field (saved before CR7) leaves it out, so amber stays the default', () => {
  const raw = serializePrefs(fakeS());
  delete raw.paperLabelOnLossy;
  const parsed = parsePrefs(raw);
  assert.equal('paperLabelOnLossy' in parsed, false);
});

test('bad values are ignored: non-boolean paperLabelOnLossy', () => {
  const parsed = parsePrefs({ paperLabelOnLossy: 'yes' });
  assert.deepEqual(parsed, {});
});

test('round trip: theme survives as light and as dark, not just the default auto', () => {
  const lightParsed = parsePrefs(serializePrefs(fakeS({ theme: 'light' })));
  assert.equal(lightParsed.theme, 'light');
  const darkParsed = parsePrefs(serializePrefs(fakeS({ theme: 'dark' })));
  assert.equal(darkParsed.theme, 'dark');
});

// DA4 (docs/DAY_ARC.md): the fourth theme value, same enum, no new field.
test('round trip: theme survives as nychthemeron', () => {
  const parsed = parsePrefs(serializePrefs(fakeS({ theme: 'nychthemeron' })));
  assert.equal(parsed.theme, 'nychthemeron');
});

// D2 (docs/DESKTOP_LAYOUT.md): a saved object without `theme` at all (every
// device before D2) loads as if it had been Auto — the doc's own default
// for that open question, applied the same way scratch's missing-means-On
// default already is above.
test('old saved data: no theme (saved before D2) leaves it out, so the default (Auto) stays in place', () => {
  const raw = serializePrefs(fakeS());
  delete raw.theme;
  const parsed = parsePrefs(raw);
  assert.equal('theme' in parsed, false);
});

test('round trip: charDrift survives as off and as full, not just the default subtle', () => {
  const offParsed = parsePrefs(serializePrefs(fakeS({ charDrift: 'off' })));
  assert.equal(offParsed.charDrift, 'off');
  const fullParsed = parsePrefs(serializePrefs(fakeS({ charDrift: 'full' })));
  assert.equal(fullParsed.charDrift, 'full');
});

// DA2 (docs/DAY_ARC.md): a saved object without `charDrift` at all (every
// device before DA2) loads as if it had been Subtle — the doc's own
// stated default, applied the same way theme's own D2 default already is.
test('old saved data: no charDrift (saved before DA2) leaves it out, so the default (Subtle) stays in place', () => {
  const raw = serializePrefs(fakeS());
  delete raw.charDrift;
  const parsed = parsePrefs(raw);
  assert.equal('charDrift' in parsed, false);
});

test('bad values are ignored: an unlisted charDrift value is ignored', () => {
  const parsed = parsePrefs({ charDrift: 'maximum' });
  assert.deepEqual(parsed, {});
});

test('round trip: shuffle true and repeat non-off also survive (falsy-looking values are real values here)', () => {
  const S = fakeS({ shuffle: true, repeat: 'all' });
  const parsed = parsePrefs(serializePrefs(S));
  assert.equal(parsed.shuffle, true);
  assert.equal(parsed.repeat, 'all');
});

test('old saved data: no char.scratch (saved before F2) leaves it out, so the default (On) stays in place', () => {
  const raw = serializePrefs(fakeS());
  delete raw.char.scratch; // simulates a prefs object saved before F2 existed
  const parsed = parsePrefs(raw);
  assert.equal(parsed.char.scratch, undefined);
  assert.equal(parsed.char.wow, 0.30); // the rest of char still comes through
});

test('old saved data: missing newer fields (shareStyle, playInFullPlayer) are left out, nothing throws', () => {
  const raw = serializePrefs(fakeS());
  delete raw.shareStyle;
  delete raw.playInFullPlayer;
  const parsed = parsePrefs(raw);
  assert.equal('shareStyle' in parsed, false);
  assert.equal('playInFullPlayer' in parsed, false);
  // the rest of the object is unaffected
  assert.equal(parsed.mode, 'vinyl');
});

test('old saved data: a prefs object with only a handful of fields (a very early save) loads without throwing', () => {
  const parsed = parsePrefs({ mode: 'pure', target: 0.75 });
  assert.deepEqual(parsed, { mode: 'pure', target: 0.75 });
});

test('bad values are ignored: wrong types for scalar fields', () => {
  const parsed = parsePrefs({
    target: '0.8',       // string, not a number
    auto: 'yes',         // string, not a boolean
    sleevePullEnabled: 1, // number, not a boolean
    bgAudio: null,
    launchIntro: 0,
  });
  assert.deepEqual(parsed, {});
});

test('bad values are ignored: unlisted enum values', () => {
  const parsed = parsePrefs({
    libraryLayout: 'grid',
    crateGroup: 'genre-but-misspelled',
    shareStyle: 'neon',
    shareFormat: 'widescreen',
  });
  assert.deepEqual(parsed, {});
});

// docs/DESKTOP_LAYOUT.md's own required test case, almost verbatim: "an
// unlisted value such as 'sepia' is ignored."
test('bad values are ignored: an unlisted theme value (e.g. "sepia") is ignored', () => {
  const parsed = parsePrefs({ theme: 'sepia' });
  assert.deepEqual(parsed, {});
});

test('bad values are ignored: non-numeric char sliders and a non-boolean scratch', () => {
  const parsed = parsePrefs({ char: { wow: '30', sat: 35, soft: null, comp: undefined, scratch: 'on' } });
  assert.deepEqual(parsed, { char: { sat: 35 } });
});

test('bad values are ignored: char present but entirely invalid is left out altogether', () => {
  const parsed = parsePrefs({ char: { wow: '30' }, mode: 'vinyl' });
  assert.equal('char' in parsed, false);
  assert.equal(parsed.mode, 'vinyl');
});

test('unknown fields are dropped', () => {
  const parsed = parsePrefs({ mode: 'vinyl', somethingThatDoesNotExist: 'whatever', char: { wow: 0.5, aFutureSlider: 99 } });
  assert.deepEqual(parsed, { mode: 'vinyl', char: { wow: 0.5 } });
});

test('null and undefined input are handled without throwing', () => {
  assert.deepEqual(parsePrefs(null), {});
  assert.deepEqual(parsePrefs(undefined), {});
});

// ---- RF17 (docs/12_REFINE.md, point 4): forward compatibility ----
// An old-version client must round-trip a pref key it doesn't recognize at
// all, untouched -- not silently drop it the moment it re-saves its own
// prefs. rememberUnknownPrefsKeys() is what sync/backup.js's
// applyPrefsPatch() calls on every pull, before parsePrefs() itself ever
// sees the merged object; serializePrefs() then echoes whatever's unknown
// back on every subsequent local save, verbatim, until a build that does
// understand the key changes it for real.
test('RF17: an old-version client round-trips a new pref untouched', () => {
  const S = fakeS();
  // a newer device's own pull brought back a pref key this build has never
  // heard of (e.g. a future setting) -- applyPrefsPatch() would call this
  // before ever calling parsePrefs()
  rememberUnknownPrefsKeys({ mode: 'vinyl', aFutureSetting: { deep: true } });
  const saved = serializePrefs(S);
  // every known field is still written normally...
  assert.equal(saved.mode, S.mode);
  assert.equal(saved.target, S.target);
  // ...and the unrecognized key is echoed back verbatim, not dropped
  assert.deepEqual(saved.aFutureSetting, { deep: true });
  // parsePrefs (reading it back into *this* build's own S) still drops it,
  // same as any other field this build doesn't understand -- it's
  // serializePrefs's echo, not parsePrefs's filtering, that keeps it alive
  // across a save/reload on an old build
  const parsed = parsePrefs(saved);
  assert.equal('aFutureSetting' in parsed, false);
  assert.equal(parsed.mode, 'vinyl');
  // reset the module-private cache so later tests in this file aren't
  // affected by this one's leftover state
  rememberUnknownPrefsKeys({});
});

test('pace, librarySort and crateAnchor are truthy-checked only, same as applyPrefs has always done', () => {
  assert.deepEqual(parsePrefs({ pace: 'moment' }), { pace: 'moment' });
  assert.deepEqual(parsePrefs({ pace: '' }), {});
  assert.deepEqual(parsePrefs({ librarySort: 'title' }), { librarySort: 'title' });
  assert.deepEqual(parsePrefs({ crateAnchor: 'abc' }), { crateAnchor: 'abc' });
});

// docs/15_SURFACE_NOISE.md §1: a saved object without these (every device
// before this feature) loads as the stated defaults -- Subtle, Normal and
// the under-the-music bed off -- the same "missing means the default"
// shape charDrift's own DA2 addition already established above.
test('round trip: surfaceNoise/runoutLength/surfaceNoiseUnderMusic survive every valid value', () => {
  const p1 = parsePrefs(serializePrefs(fakeS({ surfaceNoise: 'off', runoutLength: 'short', surfaceNoiseUnderMusic: true })));
  assert.equal(p1.surfaceNoise, 'off');
  assert.equal(p1.runoutLength, 'short');
  assert.equal(p1.surfaceNoiseUnderMusic, true);
  const p2 = parsePrefs(serializePrefs(fakeS({ surfaceNoise: 'well-loved', runoutLength: 'until-lift' })));
  assert.equal(p2.surfaceNoise, 'well-loved');
  assert.equal(p2.runoutLength, 'until-lift');
});

test('old saved data: no surfaceNoise/runoutLength/surfaceNoiseUnderMusic field at all leaves them out, so the defaults stay in place', () => {
  const raw = serializePrefs(fakeS());
  delete raw.surfaceNoise; delete raw.runoutLength; delete raw.surfaceNoiseUnderMusic;
  const parsed = parsePrefs(raw);
  assert.equal('surfaceNoise' in parsed, false);
  assert.equal('runoutLength' in parsed, false);
  assert.equal('surfaceNoiseUnderMusic' in parsed, false);
});

test('bad values are ignored: an unlisted surfaceNoise/runoutLength value, a non-boolean surfaceNoiseUnderMusic', () => {
  const parsed = parsePrefs({ surfaceNoise: 'deafening', runoutLength: 'forever', surfaceNoiseUnderMusic: 'yes' });
  assert.equal('surfaceNoise' in parsed, false);
  assert.equal('runoutLength' in parsed, false);
  assert.equal('surfaceNoiseUnderMusic' in parsed, false);
});

// docs/15_SURFACE_NOISE.md §4: a saved object without this field (every
// device before this PR) loads as On -- the stated default and today's
// behavior -- the same "missing means the default" shape every setting
// above already follows.
test('round trip: autoFlip survives both On and Off', () => {
  const p1 = parsePrefs(serializePrefs(fakeS({ autoFlip: true })));
  assert.equal(p1.autoFlip, true);
  const p2 = parsePrefs(serializePrefs(fakeS({ autoFlip: false })));
  assert.equal(p2.autoFlip, false);
});

test('old saved data: no autoFlip field at all leaves it out, so the default (On) stays in place', () => {
  const raw = serializePrefs(fakeS());
  delete raw.autoFlip;
  const parsed = parsePrefs(raw);
  assert.equal('autoFlip' in parsed, false);
});

test('bad values are ignored: a non-boolean autoFlip', () => {
  const parsed = parsePrefs({ autoFlip: 'on' });
  assert.equal('autoFlip' in parsed, false);
});

// AU5 (docs/16_AUDIO.md §4): a saved object without this field (every
// device before this PR) loads as Auto -- the stated default -- the same
// "missing means the default" shape every setting above already follows.
test('round trip: loudnessMode survives all four values', () => {
  for(const mode of ['off', 'track', 'album', 'auto']){
    const parsed = parsePrefs(serializePrefs(fakeS({ loudnessMode: mode })));
    assert.equal(parsed.loudnessMode, mode);
  }
});

test('old saved data: no loudnessMode field at all leaves it out, so the default (Auto) stays in place', () => {
  const raw = serializePrefs(fakeS());
  delete raw.loudnessMode;
  const parsed = parsePrefs(raw);
  assert.equal('loudnessMode' in parsed, false);
});

test('bad values are ignored: an unrecognized loudnessMode', () => {
  const parsed = parsePrefs({ loudnessMode: 'max' });
  assert.equal('loudnessMode' in parsed, false);
});

// AU6 (docs/16_AUDIO.md §3): a saved object without this field (every
// device before this PR) loads off and flat -- the stated default.
test('round trip: eq survives with every field intact', () => {
  const eq = {
    enabled: true, mode: 'parametric', tilt: 3,
    graphicBands: [1,2,3,4,5,6,7,8,9,10],
    parametricBands: [{ type: 'peak', freq: 500, gainDb: 4, q: 0.9 }],
    autoPreamp: false, preampDb: -2,
    savedPresets: { 'my preset': { mode: 'graphic', tilt: 1, graphicBands: [0,0,0,0,0,0,0,0,0,1], parametricBands: [] } },
  };
  const parsed = parsePrefs(serializePrefs(fakeS({ eq })));
  assert.deepEqual(parsed.eq, eq);
});

test('old saved data: no eq field at all leaves it out, so the default (off, flat) stays in place', () => {
  const raw = serializePrefs(fakeS());
  delete raw.eq;
  const parsed = parsePrefs(raw);
  assert.equal('eq' in parsed, false);
});

test('bad values in eq are clamped or dropped, never left to throw or escape their own range', () => {
  const parsed = parsePrefs({
    eq: {
      enabled: 'yes', mode: 'bogus', tilt: 999,
      graphicBands: [999, -999, 'nope'],
      parametricBands: [{ type: 'peak', freq: 50, gainDb: 999, q: 0.7 }, { type: 'nope' }],
      autoPreamp: 1, preampDb: 999,
      savedPresets: { ok: { tilt: 999, graphicBands: [999] }, bad: 'nope' },
    },
  });
  // enabled/mode/autoPreamp all fail their own type/enum check, so none of
  // them appear in the cleaned object at all.
  assert.equal('enabled' in parsed.eq, false);
  assert.equal('mode' in parsed.eq, false);
  assert.equal('autoPreamp' in parsed.eq, false);
  assert.equal(parsed.eq.tilt, 6);
  assert.deepEqual(parsed.eq.graphicBands, [12, -12, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(parsed.eq.parametricBands.length, 1);
  assert.equal(parsed.eq.parametricBands[0].gainDb, 12);
  assert.equal(parsed.eq.preampDb, 12);
  assert.equal(parsed.eq.savedPresets.ok.tilt, 6);
  assert.deepEqual(parsed.eq.savedPresets.ok.graphicBands, [12,0,0,0,0,0,0,0,0,0]);
  assert.equal('bad' in parsed.eq.savedPresets, false);
});

test('an eq value that is not an object at all is simply left out', () => {
  const parsed = parsePrefs({ eq: 'nope' });
  assert.equal('eq' in parsed, false);
});
