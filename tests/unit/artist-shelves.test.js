import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// artist-shelves.js's rendering pulls in the queue/player chain, the
// platter's look resolver and the crate model; the pure functions under
// test use none of them, so they're stubbed at the door.
mock.module(new URL('../../src/player/queue.js', import.meta.url).href, { namedExports: { setQueue(){} } });
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, { namedExports: { discLook(){ return null; } } });
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, { namedExports: { lastSpunLabel(){ return ''; } } });
mock.module(new URL('../../src/profile/rhythm-card.js', import.meta.url).href, { namedExports: { PHASE_LABEL: {} } });

const { topTracksFor, topPhase, historyFor, pressingLabel, PHASE_MIN_PLAYS } =
  await import('../../src/library/artist-shelves.js');
const { trackIdentityKey, albumKey, getVariantDef } = await import('../../src/record-art/tiers.js');

const track = (title, album, artist = 'A Tribe Called Quest') => ({ tags: { title, album, artist } });
const tracks = [
  track('Electric Relaxation', 'Midnight Marauders'),
  track('Award Tour', 'Midnight Marauders'),
  track('Check the Rhime', 'The Low End Theory'),
  track('Scenario', 'The Low End Theory'),
  track('Award Tour', 'Midnight Marauders'),          // a duplicate file of index 1
  track('Never Played', 'The Low End Theory'),
];
const idx = tracks.map((_, i) => i);
const key = i => trackIdentityKey(tracks[i]);

test('topTracksFor: most played first, played only, one row per identity', () => {
  const plays = { [key(0)]: 48, [key(1)]: 37, [key(2)]: 41, [key(3)]: 29 };
  const top = topTracksFor(idx, tracks, plays, {});
  assert.deepEqual(top.map(x => tracks[x.i].tags.title), ['Electric Relaxation', 'Check the Rhime', 'Award Tour', 'Scenario']);
  assert.equal(top.find(x => x.key === key(1)).i, 1, 'the first file wins over its duplicate');
  assert.equal(topTracksFor(idx, tracks, plays, {}, 2).length, 2);
  assert.deepEqual(topTracksFor(idx, tracks, {}, {}), []);
});

test('topTracksFor: equal play counts go to the most recently played', () => {
  const plays = { [key(0)]: 5, [key(2)]: 5 };
  const last = { [key(0)]: 100, [key(2)]: 200 };
  assert.deepEqual(topTracksFor(idx, tracks, plays, last).map(x => x.i), [2, 0]);
});

test('topPhase: highest count, ties to the earlier phase, null when empty', () => {
  assert.equal(topPhase({ golden: 9, twilight: 12, morning: 3 }), 'twilight');
  assert.equal(topPhase({ golden: 7, dawn: 7 }), 'dawn');
  assert.equal(topPhase({}), null);
});

test('historyFor: sums spins across the artist, latest of track/album last-played', () => {
  const h = historyFor(idx, tracks, {
    playCounts: { [key(0)]: 10, [key(2)]: 4 },
    trackLast: { [key(0)]: 1000, [key(2)]: 3000 },
    albumLast: { [albumKey(tracks[0])]: 5000 },
    albumPhase: {
      [albumKey(tracks[0])]: { golden: 6, night: 2 },
      [albumKey(tracks[2])]: { golden: 1, twilight: 3 },
    },
  });
  assert.equal(h.spins, 14, 'the duplicate file is not double-counted');
  assert.equal(h.last, 5000);
  assert.equal(h.phase, 'golden');
});

test('historyFor: null when never played; no phase below the minimum', () => {
  const empty = { playCounts: {}, trackLast: {}, albumLast: {}, albumPhase: {} };
  assert.equal(historyFor(idx, tracks, empty), null);
  const thin = historyFor(idx, tracks, { ...empty, playCounts: { [key(0)]: 1 },
    albumPhase: { [albumKey(tracks[0])]: { golden: PHASE_MIN_PLAYS - 1 } } });
  assert.equal(thin.spins, 1);
  assert.equal(thin.phase, null);
});

test('pressingLabel names the pressing, rare, or metal over its pressing', () => {
  assert.equal(pressingLabel({ variant: 'oxblood' }), 'Oxblood');
  assert.equal(pressingLabel({ variant: 'oxblood', metal: 'gold' }), 'Gold · Oxblood');
  assert.equal(pressingLabel({ rare: true, rareId: 'glow' }), getVariantDef('glow').name);
  assert.equal(pressingLabel(null), 'Pressing');
});
