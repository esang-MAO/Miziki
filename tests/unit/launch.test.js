import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// src/launch/intro.js reads/writes CSS custom properties on
// document.documentElement at module load (LAUNCH_ANIM's --launch-*
// durations) and window.innerWidth/innerHeight inside updateLaunchScale --
// stubbed here rather than pulling in a real DOM, same "stub only what a
// browser would otherwise provide" approach idb.test.js/shell.test.js use.
globalThis.document = {
  documentElement: { style: { setProperty(){} } },
  // TY4's module-load-time $('#launchWordmark').replaceChildren(...) needs
  // this to resolve to something; the wordmark itself is mocked away below.
  querySelector(){ return { replaceChildren(){} }; },
};
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){} },
});
// The intro's art lookup, the peek disc and the haptic tick are all
// browser-only (object URLs, the crate tiers' IndexedDB reads, the
// pressing look chain through record-art/looks.js) and none of them are
// what this file tests — stopped at the door, the same way every other
// mock-heavy file in this suite does.
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { crateArtCache: { S: new Map(), L: new Map() }, async getCrateArtURL(){ return null; } },
});
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { CRATE_PEEK_MAX_FRACTION: 0.26 },
});
// LA3: intro.js now reads the crate's own flowPose() params for the exact
// landing (measureCrateLanding()/crateCardSpread()) -- crate/constants.js
// itself reads window.devicePixelRatio at module load, which this file's
// stubbed environment (document only, no window) doesn't have, so it's
// mocked the same way the other crate/* modules above already are.
mock.module(new URL('../../src/crate/constants.js', import.meta.url).href, {
  namedExports: { CRATE_ORIGIN_Y: 15, CRATE_DEPTH_SPREAD: 0.8 },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { thumbURL: {} },
});
mock.module(new URL('../../src/record-art/peek.js', import.meta.url).href, {
  namedExports: { buildPeekDisc(){ return {}; } },
});
mock.module(new URL('../../src/ui/haptic.js', import.meta.url).href, {
  namedExports: { hapticTick(){} },
});
// TY4 (docs/22_TYPE.md): the drawn wordmark SVG — a ?raw asset import node:test
// can't resolve, and nothing this file tests reads its actual markup anyway.
mock.module(new URL('../../src/ui/wordmark.js', import.meta.url).href, {
  namedExports: { wordmarkEl(){ return { classList: { add(){} } }; } },
});
// LA1 (docs/36A_LIBRARY_AND_LAUNCH.md): intro.js now imports REDUCED itself
// (to pass it into chooseLaunchVariant() inside runLaunchSequence()) —
// window.matchMedia doesn't exist in this file's stubbed-document
// environment, so it's mocked the same way tests/unit/clock.test.js's own
// motion.js mock already is. The value here is never read by
// chooseLaunchVariant() itself (a pure function taking reducedMotion as a
// plain argument, tested directly below) — only by runLaunchSequence()'s
// own DOM-driving code this file doesn't exercise.
mock.module(new URL('../../src/util/motion.js', import.meta.url).href, {
  namedExports: { REDUCED: false },
});

const {
  resolveLastPlayedAlbum, resolveLastPlayedTrackIndex,
  computeFlickPosition, flickSpeed, planLaunchStack, chooseLaunchVariant,
} = await import('../../src/launch/intro.js');
const { S } = await import('../../src/state.js');

function fakeTrack(id, overrides){
  return Object.assign({
    id, addedAt: 0,
    tags: { title: id, artist: 'Artist', album: 'Album', albumArtist: 'Artist', track: 1, disc: 1 },
  }, overrides);
}

function resetState(overrides){
  Object.assign(S, {
    tracks: [], albumLastPlayed: {}, trackLastPlayed: {},
  }, overrides);
}

test('resolveLastPlayedAlbum: picks the album with the latest S.albumLastPlayed timestamp', () => {
  resetState({
    tracks: [
      fakeTrack('a1', { tags: { title:'A1', artist:'A', album:'Album A', albumArtist:'A', track:1, disc:1 } }),
      fakeTrack('b1', { tags: { title:'B1', artist:'B', album:'Album B', albumArtist:'B', track:1, disc:1 } }),
    ],
    // albumLastPlayed is keyed by albumKey() alone -- normKey() of the album
    // title, not artist+album (see src/record-art/tiers.js's albumKey()).
    albumLastPlayed: { 'album a': 100, 'album b': 200 },
  });
  assert.equal(resolveLastPlayedAlbum(), 'album b');
});

test('resolveLastPlayedAlbum: with no play history, falls back to the most recently added album', () => {
  resetState({
    tracks: [
      fakeTrack('a1', { addedAt: 1, tags: { title:'A1', artist:'A', album:'Album A', albumArtist:'A', track:1, disc:1 } }),
      fakeTrack('b1', { addedAt: 2, tags: { title:'B1', artist:'B', album:'Album B', albumArtist:'B', track:1, disc:1 } }),
    ],
  });
  assert.equal(resolveLastPlayedAlbum(), 'album b');
});

test('resolveLastPlayedAlbum: an empty library resolves to null', () => {
  resetState({});
  assert.equal(resolveLastPlayedAlbum(), null);
});

test('resolveLastPlayedTrackIndex: picks the track with the latest S.trackLastPlayed within that album, falling back to the first', () => {
  resetState({
    tracks: [
      fakeTrack('a1', { tags: { title:'A1', artist:'A', album:'Album A', albumArtist:'A', track:1, disc:1 } }),
      fakeTrack('a2', { tags: { title:'A2', artist:'A', album:'Album A', albumArtist:'A', track:2, disc:1 } }),
    ],
    // trackLastPlayed is keyed by trackIdentityKey(): normKey(artist) +
    // '|' + albumKey() + '|' + normKey(title) (see record-art/tiers.js).
    trackLastPlayed: { 'a|album a|a2': 500 },
  });
  assert.equal(resolveLastPlayedTrackIndex('album a'), 1);
  resetState({
    tracks: [fakeTrack('a1', { tags: { title:'A1', artist:'A', album:'Album A', albumArtist:'A', track:1, disc:1 } })],
  });
  assert.equal(resolveLastPlayedTrackIndex('album a'), 0);
});

test('resolveLastPlayedTrackIndex: an unknown album id resolves to -1', () => {
  resetState({ tracks: [fakeTrack('a1')] });
  assert.equal(resolveLastPlayedTrackIndex('nope'), -1);
});

test('computeFlickPosition: starts at 0, lands exactly on the target at the end of decel', () => {
  const timing = { accelMs: 650, cruiseMs: 800, decelMs: 800 };
  assert.equal(computeFlickPosition(0, 40, timing), 0);
  assert.equal(computeFlickPosition(2250, 40, timing), 40);
});

test('computeFlickPosition: monotonically increasing across the whole scroll', () => {
  const timing = { accelMs: 650, cruiseMs: 800, decelMs: 800 };
  let prev = -Infinity;
  for(let t = 0; t <= 2250; t += 50){
    const pos = computeFlickPosition(t, 40, timing);
    assert.ok(pos >= prev, `expected position at t=${t} (${pos}) >= previous (${prev})`);
    prev = pos;
  }
});

test('flickSpeed: ramps up through accel, holds at 1 through cruise, ramps down through decel to 0', () => {
  const timing = { accelMs: 650, cruiseMs: 800, decelMs: 800 };
  assert.equal(flickSpeed(0, timing), 0);
  assert.equal(flickSpeed(650, timing), 1);
  assert.equal(flickSpeed(1000, timing), 1);
  assert.equal(flickSpeed(1450, timing), 1);
  assert.ok(flickSpeed(1650, timing) < 1 && flickSpeed(1650, timing) > 0);
  assert.equal(flickSpeed(2250, timing), 0);
});

test('computeFlickPosition: the fixed 18-record stack lands exactly on the caught sleeve, four from the end', () => {
  const timing = { accelMs: 650, cruiseMs: 800, decelMs: 800 };
  assert.equal(computeFlickPosition(0, 14, timing), 0);
  assert.ok(Math.abs(computeFlickPosition(2250, 14, timing) - 14) < 1e-9);
});

test('planLaunchStack: an empty library is all Miziki covers', () => {
  const plan = planLaunchStack([], null, 18, 14);
  assert.equal(plan.length, 18);
  assert.ok(plan.every(id => id === null));
});

test('planLaunchStack: the last-played album always sits at the target index', () => {
  const plan = planLaunchStack(['b', 'c'], 'a', 18, 14);
  assert.equal(plan[14], 'a');
});

test('planLaunchStack: a small library spreads its covers through the stack, Miziki covers between', () => {
  const plan = planLaunchStack(['b', 'c', 'd'], 'a', 18, 14);
  const covers = plan.map((id, i) => [id, i]).filter(([id, i]) => id && i !== 14);
  assert.deepEqual(covers.map(([id]) => id), ['b', 'c', 'd']);
  // not bunched at the front: the three land roughly a third of the way apart
  const slots = covers.map(([, i]) => i);
  assert.ok(slots[1] - slots[0] >= 4 && slots[2] - slots[1] >= 4);
  assert.equal(plan.filter(id => id === null).length, 18 - 4);
});

test('planLaunchStack: a full library fills every sleeve, and never repeats the target elsewhere', () => {
  const ids = Array.from({length: 40}, (_, i) => 'x' + i);
  const plan = planLaunchStack(['a'].concat(ids), 'a', 18, 14);
  assert.ok(plan.every(id => id !== null));
  assert.equal(plan.filter(id => id === 'a').length, 1);
  assert.deepEqual(plan.filter((_, i) => i !== 14), ids.slice(0, 17));
});

test('planLaunchStack: no target (an empty play history in an empty library) leaves the catch on a Miziki cover', () => {
  const plan = planLaunchStack(['b'], null, 18, 14);
  assert.equal(plan[14], null);
  assert.equal(plan.filter(Boolean).length, 1);
});

// LA1 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 16): chooseLaunchVariant()'s
// own five required cases. 2026-11-10 10:00am/10:00pm are both well clear of
// midnight on either side, so toDateString() comparisons below never
// accidentally straddle a day boundary by the test's own choice of hours.
const MORNING = new Date('2026-11-10T10:00:00').getTime();
const SUNSET = new Date('2026-11-10T17:00:00').getTime();   // mid-afternoon-ish stand-in
const EVENING = new Date('2026-11-10T20:00:00').getTime();   // after SUNSET
const LATER_EVENING = new Date('2026-11-10T21:00:00').getTime();
const YESTERDAY_EVENING = new Date('2026-11-09T20:00:00').getTime();

test('chooseLaunchVariant: first-of-day (no S.lastLaunchAt at all) plays full', () => {
  assert.equal(chooseLaunchVariant({ lastLaunchAt: null, now: MORNING, sunset: SUNSET, reducedMotion: false }), 'full');
});

test('chooseLaunchVariant: first-of-day (last launch was yesterday) plays full', () => {
  assert.equal(chooseLaunchVariant({ lastLaunchAt: YESTERDAY_EVENING, now: MORNING, sunset: SUNSET, reducedMotion: false }), 'full');
});

test('chooseLaunchVariant: a second launch an hour later, same day, before sunset, plays short', () => {
  const firstLaunch = MORNING;
  const anHourLater = firstLaunch + 60*60000;
  assert.equal(chooseLaunchVariant({ lastLaunchAt: firstLaunch, now: anHourLater, sunset: SUNSET, reducedMotion: false }), 'short');
});

test('chooseLaunchVariant: the first launch after sunset (last launch was earlier today, before sunset) plays full', () => {
  assert.equal(chooseLaunchVariant({ lastLaunchAt: MORNING, now: EVENING, sunset: SUNSET, reducedMotion: false }), 'full');
});

test('chooseLaunchVariant: a second launch after sunset (last launch was already after sunset) plays short', () => {
  assert.equal(chooseLaunchVariant({ lastLaunchAt: EVENING, now: LATER_EVENING, sunset: SUNSET, reducedMotion: false }), 'short');
});

test('chooseLaunchVariant: Reduce Motion always plays fade, overriding every other rule', () => {
  assert.equal(chooseLaunchVariant({ lastLaunchAt: null, now: MORNING, sunset: SUNSET, reducedMotion: true }), 'fade');
  assert.equal(chooseLaunchVariant({ lastLaunchAt: MORNING, now: EVENING, sunset: SUNSET, reducedMotion: true }), 'fade');
});

test('chooseLaunchVariant: a Date sunset (not just an epoch-ms number) is accepted the same way', () => {
  assert.equal(chooseLaunchVariant({ lastLaunchAt: MORNING, now: EVENING, sunset: new Date(SUNSET), reducedMotion: false }), 'full');
});

test('chooseLaunchVariant: no sunset at all (S.sun not ok yet) still falls back to the same-day rule', () => {
  assert.equal(chooseLaunchVariant({ lastLaunchAt: null, now: MORNING, sunset: null, reducedMotion: false }), 'full');
  const anHourLater = MORNING + 60*60000;
  assert.equal(chooseLaunchVariant({ lastLaunchAt: MORNING, now: anHourLater, sunset: null, reducedMotion: false }), 'short');
});
