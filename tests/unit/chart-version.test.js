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

// PRESSING_DRAW (docs/31_PRESSINGS_AND_LOOKS.md, PR A): v3 re-draws tier 2
// as well as tier 3 -- the band/colour correlation bug applied just as
// much to a lossless album's solid draw. Only tier 1 (always Jet) is
// skipped now.
test('migrateChartVersion: a stale tier-2 (solid) record is re-drawn and re-stamped, discoveredAt untouched', async () => {
  const t = { meta: { lossless: true, bits: 16, rate: 44100 }, tags: { album: 'Plain Lossless Album' } };
  const id = keyFor(t);
  const fresh = selectVariant(t);
  resetState({
    tracks: [t],
    collection: {
      [id]: { albumId: id, tier: 2, variant: 'jet', pattern: 'solid', discoveredAt: 5, chartVersion: 1 },
    },
  });
  await migrateChartVersion();
  const rec = S.collection[id];
  assert.equal(rec.chartVersion, CHART_VERSION);
  assert.equal(rec.tier, fresh.tier);
  assert.equal(rec.variant, fresh.variant);
  assert.equal(rec.pattern, VARIANT_DEFS[fresh.variant].pattern);
  assert.equal(rec.discoveredAt, 5, 'discoveredAt must not change -- this is a re-draw, not a new discovery');
});

test('migrateChartVersion: a tier-1 record is left alone, even if stale -- Jet is always Jet', async () => {
  const t = { meta: { lossless: false }, tags: { album: 'Lossy Album' } };
  const id = keyFor(t);
  resetState({
    tracks: [t],
    collection: {
      [id]: { albumId: id, tier: 1, variant: 'jet', pattern: 'solid', discoveredAt: 3, chartVersion: 1 },
    },
  });
  await migrateChartVersion();
  const rec = S.collection[id];
  assert.equal(rec.chartVersion, 1, 'tier-1 records are never re-stamped -- nothing about Jet could change');
  assert.equal(rec.variant, 'jet');
});

test('migrateChartVersion: a played-through "found" entry for a re-drawn album is rewritten to the new variant; another album\'s entry is untouched', async () => {
  const t = hiResTrack('Found Sticker Album');
  const id = keyFor(t);
  const fresh = selectVariant(t);
  const otherId = 'some other album';
  resetState({
    tracks: [t],
    collection: {
      [id]: { albumId: id, tier: 3, variant: 'jet', pattern: 'solid', discoveredAt: 9, chartVersion: 1 },
    },
    playedThrough: {
      'a\u0000111\u0000A': { id: 'a\u0000111\u0000A', albumId: id, found: 'jet', side: 'A', at: 111 },
      'b\u0000222\u0000A': { id: 'b\u0000222\u0000A', albumId: otherId, found: 'jet', side: 'A', at: 222 },
    },
  });
  await migrateChartVersion();
  assert.equal(S.playedThrough['a\u0000111\u0000A'].found, fresh.variant, 'the re-drawn album\'s found sticker follows the new variant');
  assert.equal(S.playedThrough['b\u0000222\u0000A'].found, 'jet', 'an unrelated album\'s entry is untouched');
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
