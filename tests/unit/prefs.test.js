import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializePrefs, parsePrefs } from '../../src/storage/prefs.js';

function fakeS(overrides = {}){
  return Object.assign({
    mode: 'vinyl', target: 0.80, pace: 'window',
    char: { wow: 0.30, sat: 0.35, soft: 0.40, comp: 0.35, scratch: true },
    shuffle: false, repeat: 'off', auto: true, sleevePullEnabled: true, librarySort: 'artist',
    bgAudio: false, launchIntro: true,
    libraryLayout: 'crate', crateGroup: 'az', crateAnchor: 'some-anchor', albumSides: false,
    sealedRecords: true, playInFullPlayer: true,
    shareStyle: 'night', shareFormat: 'story',
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
  });
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

test('pace, librarySort and crateAnchor are truthy-checked only, same as applyPrefs has always done', () => {
  assert.deepEqual(parsePrefs({ pace: 'moment' }), { pace: 'moment' });
  assert.deepEqual(parsePrefs({ pace: '' }), {});
  assert.deepEqual(parsePrefs({ librarySort: 'title' }), { librarySort: 'title' });
  assert.deepEqual(parsePrefs({ crateAnchor: 'abc' }), { crateAnchor: 'abc' });
});
