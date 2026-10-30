import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// RW7 (docs/23_RHYTHM_AND_WEAR.md): migrateAlbumFirstPlayed() (src/history/
// sessions.js) is the one-time backfill for albums played before this PR
// -- the same "export a previously-private helper purely for testability"
// precedent chart-version.test.js already uses for migrateChartVersion().
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, thumbURL: {}, persistable(rec){ return rec; } },
});

const { migrateAlbumFirstPlayed } = await import('../../src/history/sessions.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    sessionCounts: {}, albumFirstPlayed: {}, albumLastPlayed: {},
    achievements: {}, collection: {},
  }, overrides);
}

test('migrateAlbumFirstPlayed: an already-present entry is left untouched', async () => {
  resetState({
    sessionCounts: { al: 5 },
    albumFirstPlayed: { al: 1000 },
    albumLastPlayed: { al: 9999 },
  });
  await migrateAlbumFirstPlayed();
  assert.equal(S.albumFirstPlayed.al, 1000);
});

test('migrateAlbumFirstPlayed: backfills from albumLastPlayed when nothing else is on record', async () => {
  resetState({
    sessionCounts: { al: 5 },
    albumLastPlayed: { al: 5000 },
  });
  await migrateAlbumFirstPlayed();
  assert.equal(S.albumFirstPlayed.al, 5000);
});

test('migrateAlbumFirstPlayed: takes the earliest of albumLastPlayed/achievements/collection, not just albumLastPlayed', async () => {
  resetState({
    sessionCounts: { al: 5 },
    albumLastPlayed: { al: 9000 },
    achievements: { al: { discoveredAt: 3000 } },
    collection: { al: { discoveredAt: 7000 } },
  });
  await migrateAlbumFirstPlayed();
  assert.equal(S.albumFirstPlayed.al, 3000);
});

test('migrateAlbumFirstPlayed: a played album with genuinely no data at all falls back to "now"', async () => {
  const before = Date.now();
  resetState({ sessionCounts: { al: 5 } });
  await migrateAlbumFirstPlayed();
  const after = Date.now();
  assert.ok(S.albumFirstPlayed.al >= before && S.albumFirstPlayed.al <= after);
});

test('migrateAlbumFirstPlayed: an album never played at all gets no entry', async () => {
  resetState({ sessionCounts: {}, albumLastPlayed: { al: 5000 } });
  await migrateAlbumFirstPlayed();
  assert.equal('al' in S.albumFirstPlayed, false);
});

test('migrateAlbumFirstPlayed: runs once per album -- a second run is a no-op', async () => {
  resetState({ sessionCounts: { al: 5 }, albumLastPlayed: { al: 5000 } });
  await migrateAlbumFirstPlayed();
  const first = S.albumFirstPlayed.al;
  await migrateAlbumFirstPlayed();
  assert.equal(S.albumFirstPlayed.al, first);
});
