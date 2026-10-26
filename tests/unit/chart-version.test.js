import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// PRESSINGS_110 (docs/PRESSINGS_110.md §8, point 1): migrateChartVersion()
// (src/history/sessions.js) is the one-time re-draw that keeps a tier-3
// Collection record's pressing in step once the effect shelf grows (see
// record-art/tiers.js's own CHART_VERSION entry). This file tests it
// directly rather than through the full restoreSessions()/restoreLibrary()
// boot path -- the same "export a previously-private helper purely for
// testability" precedent as angleDelta (scrub.js) / gatefoldSideSplits
// (gatefold/view.js).
//
// sessions.js imports record-art/looks.js (applyDiscVariant) and
// library/thumbs.js (restoreThumbs/persistable) at module top level --
// both mocked here, the same shape sealed.test.js already uses, so
// loading the real sessions.js doesn't drag in thumbs.js's own wide chain
// (library/edit.js -> library/sealed.js/library/credits.js) just to
// exercise one pure-ish migration function.
mock.module(new URL('../../src/record-art/looks.js', import.meta.url).href, {
  namedExports: { applyDiscVariant(){} },
});
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, thumbURL: {}, persistable(rec){ return rec; } },
});

const { migrateChartVersion } = await import('../../src/history/sessions.js');
const { S } = await import('../../src/state.js');
const { CHART_VERSION, selectVariant, VARIANT_DEFS, albumKey } = await import('../../src/record-art/tiers.js');
const { collection } = await import('../../src/storage/repo.js');

function hiResTrack(album){
  return { meta: { lossless: true, bits: 24, rate: 96000 }, tags: { album } };
}

// migrateChartVersion() iterates S.collection by key and looks up a sample
// track via albumKey(t) === albumId -- the collection dict must be keyed
// by the same normalized albumKey() every real call site uses (achievements.js's
// upsertCollectionEntry), not the raw album title string.
function keyFor(track){ return albumKey(track); }

function resetState(overrides){
  Object.assign(S, { collection: {}, tracks: [] }, overrides);
}

test('migrateChartVersion: a stale tier-3 record is re-drawn and re-stamped, discoveredAt untouched', async () => {
  const t = hiResTrack('Stale Hi-Res Album');
  const id = keyFor(t);
  const fresh = selectVariant(t);
  resetState({
    tracks: [t],
    collection: {
      [id]: { albumId: id, tier: 3, variant: 'jet', pattern: 'solid', discoveredAt: 12345, chartVersion: 1 },
    },
  });
  await migrateChartVersion();
  const rec = S.collection[id];
  assert.equal(rec.chartVersion, CHART_VERSION);
  assert.equal(rec.variant, fresh.variant);
  assert.equal(rec.pattern, VARIANT_DEFS[fresh.variant].pattern);
  assert.equal(rec.discoveredAt, 12345, 'discoveredAt must not change -- this is a re-draw, not a new discovery');
});

test('migrateChartVersion: a record missing chartVersion entirely is treated as version 1 (stale)', async () => {
  const t = hiResTrack('No Version Album');
  const id = keyFor(t);
  resetState({
    tracks: [t],
    collection: { [id]: { albumId: id, tier: 3, variant: 'jet', pattern: 'solid', discoveredAt: 1 } },
  });
  await migrateChartVersion();
  assert.equal(S.collection[id].chartVersion, CHART_VERSION);
});

test('migrateChartVersion: a record already at the current version is left alone', async () => {
  const t = hiResTrack('Already Current');
  const id = keyFor(t);
  resetState({
    tracks: [t],
    collection: {
      [id]: { albumId: id, tier: 3, variant: 'jet', pattern: 'solid', discoveredAt: 999, chartVersion: CHART_VERSION },
    },
  });
  await migrateChartVersion();
  const rec = S.collection[id];
  assert.equal(rec.variant, 'jet', 'an already-current record keeps whatever variant it already had');
  assert.equal(rec.discoveredAt, 999);
});

test('migrateChartVersion: a tier-2 (solid) record is never touched, even if stale', async () => {
  const t = { meta: { lossless: true, bits: 16, rate: 44100 }, tags: { album: 'Plain Lossless Album' } };
  const id = keyFor(t);
  resetState({
    tracks: [t],
    collection: {
      [id]: { albumId: id, tier: 2, variant: 'jet', pattern: 'solid', discoveredAt: 5, chartVersion: 1 },
    },
  });
  await migrateChartVersion();
  const rec = S.collection[id];
  assert.equal(rec.chartVersion, 1, 'tier-2 records are not stamped forward -- the solid pool never changed');
  assert.equal(rec.variant, 'jet');
});

test('migrateChartVersion: a stale record with no matching track left in the library is left alone', async () => {
  resetState({
    tracks: [],
    collection: {
      'gone from library': { albumId: 'gone from library', tier: 3, variant: 'jet', pattern: 'solid', discoveredAt: 7, chartVersion: 1 },
    },
  });
  await migrateChartVersion();
  const rec = S.collection['gone from library'];
  assert.equal(rec.chartVersion, 1, 'nothing to recompute against, so the stale record is left for a later run');
  assert.equal(rec.variant, 'jet');
});

test('migrateChartVersion: persists the re-drawn record through storage.collection', async () => {
  const puts = [];
  const originalPut = collection.put;
  collection.put = async (rec) => { puts.push(rec); };
  try {
    const t = hiResTrack('Persisted Album');
    const id = keyFor(t);
    resetState({
      tracks: [t],
      collection: {
        [id]: { albumId: id, tier: 3, variant: 'jet', pattern: 'solid', discoveredAt: 1, chartVersion: 1 },
      },
    });
    await migrateChartVersion();
    assert.equal(puts.length, 1);
    assert.equal(puts[0].chartVersion, CHART_VERSION);
    assert.equal(puts[0].art, undefined, 'persistable() strips the runtime art URL');
  } finally {
    collection.put = originalPut;
  }
});
