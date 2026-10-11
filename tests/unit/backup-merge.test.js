import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc, fromDocs, resolveIdentityKey, SCHEMA_VERSION } from '../../src/sync/backup-doc.js';
import { mergeRows } from '../../src/sync/merge.js';
import { trackIdentityKey } from '../../src/record-art/tiers.js';

// B2 (step 03): pure merge logic for the account backup. No DB, no DOM, no
// network — every row below is a plain object shaped the way toDoc()
// produces it, or the way a later PR will fetch it from the server.

function mkTrack(id, title, artist, album){
  return { id, tags: { title, artist, album, albumArtist: artist } };
}

function baseLocal(deviceId, overrides){
  return Object.assign({
    deviceId, historyClearedAt: 0, tracks: [],
    playlists: [], albumOrder: {}, albumSort: {},
    albumDisplay: {}, trackDisplay: {}, albumEdge: {}, albumLookPref: {},
    prefs: {}, profileName: '',
    trackPlayCounts: {}, sessionCounts: {}, metalEligibleSessions: {}, trackMetalEligiblePlays: {},
    trackLastPlayed: {}, albumLastPlayed: {}, rareUnlocked: {}, achievements: {}, collection: {},
    sealedIds: [], brokenSealIds: [], overlaysRaw: [], updatedAt: {},
  }, overrides);
}

test('toDoc stamps the current schema version', () => {
  assert.equal(toDoc(baseLocal('a')).schemaVersion, SCHEMA_VERSION);
});

// ---- point 3: counters without double counting ----

test('counter invariant: the merged total is the sum of every device\'s own contribution', () => {
  const a = baseLocal('a', { trackPlayCounts: { k1: 3 } });
  const b = toDoc(baseLocal('b', { trackPlayCounts: { k1: 2 } }));
  const c = toDoc(baseLocal('c', { trackPlayCounts: { k1: 5 } }));
  const result = fromDocs(a, [b, c]);
  assert.equal(result.totals.counters.trackPlayCounts.k1, 10);
});

test('counter invariant: three devices, interleaved sync order never changes the total', () => {
  const docs = [
    toDoc(baseLocal('a', { trackPlayCounts: { k1: 3 } })),
    toDoc(baseLocal('b', { trackPlayCounts: { k1: 2 } })),
    toDoc(baseLocal('c', { trackPlayCounts: { k1: 5 } })),
  ];
  const orders = [[0,1,2], [2,1,0], [1,2,0], [0,2,1]];
  const totals = orders.map(order => mergeRows(order.map(i => docs[i])).totals.counters.trackPlayCounts.k1);
  assert.deepEqual(totals, [10, 10, 10, 10]);
});

test('counter invariant: syncing any number of times by itself never changes the total', () => {
  const a = baseLocal('a', { trackPlayCounts: { k1: 3 } });
  const b = toDoc(baseLocal('b', { trackPlayCounts: { k1: 2 } }));
  const first = fromDocs(a, [b]);
  const second = fromDocs(a, [b]);
  const third = fromDocs(a, [b, b]); // even a duplicated remote row must not double count
  assert.equal(first.totals.counters.trackPlayCounts.k1, 5);
  assert.equal(second.totals.counters.trackPlayCounts.k1, 5);
  assert.equal(third.totals.counters.trackPlayCounts.k1, 5);
});

test('counter invariant: a play on device A and a play on device B both count, neither lost nor doubled', () => {
  const a = baseLocal('a', { trackPlayCounts: { k1: 1 } });
  const b = toDoc(baseLocal('b', { trackPlayCounts: { k1: 1 } }));
  assert.equal(fromDocs(a, [b]).totals.counters.trackPlayCounts.k1, 2);
});

test('counter invariant: this device\'s own local data never ends up containing other devices\' counts', () => {
  const a = baseLocal('a', { trackPlayCounts: { k1: 3 } });
  const b = toDoc(baseLocal('b', { trackPlayCounts: { k1: 2 } }));
  const c = toDoc(baseLocal('c', { trackPlayCounts: { k1: 5 } }));
  fromDocs(a, [b, c]);
  // fromDocs must not mutate its input, and toDoc on the same localState
  // again must still report only this device's own 3 -- never the merged
  // 10 -- or the *next* upload would double count what was already synced
  assert.deepEqual(a.trackPlayCounts, { k1: 3 });
  assert.equal(toDoc(a).counters.trackPlayCounts.k1, 3);
});

// ---- overlays: last edit wins by timestamp; a revert is a tombstone ----

test('overlays: a later revert on another device wins over an earlier edit', () => {
  const t = mkTrack('local-a', 'Song', 'Artist', 'Album');
  const key = trackIdentityKey(t);
  const a = baseLocal('a', { tracks: [t], overlaysRaw: [{ id: 'local-a', fields: { title: 'Edited' }, editedAt: 100 }] });
  const b = toDoc(baseLocal('b', { tracks: [t], overlaysRaw: [{ id: 'local-a', reverted: true, revertedAt: 200 }] }));
  const merged = fromDocs(a, [b]);
  assert.equal(merged.overlays[key].tombstone, true);
  assert.equal(merged.overlays[key].at, 200);
});

test('overlays: a later edit on another device wins over an earlier revert', () => {
  const t = mkTrack('local-a', 'Song', 'Artist', 'Album');
  const key = trackIdentityKey(t);
  const a = baseLocal('a', { tracks: [t], overlaysRaw: [{ id: 'local-a', reverted: true, revertedAt: 100 }] });
  const b = toDoc(baseLocal('b', { tracks: [t], overlaysRaw: [{ id: 'local-a', fields: { title: 'Edited' }, editedAt: 200 }] }));
  const merged = fromDocs(a, [b]);
  assert.equal(merged.overlays[key].tombstone, false);
  assert.deepEqual(merged.overlays[key].fields, { title: 'Edited' });
});

test('overlays: an unresolvable local id (track not currently present) is skipped, not crashed on', () => {
  const a = baseLocal('a', { tracks: [], overlaysRaw: [{ id: 'ghost', fields: { title: 'x' }, editedAt: 1 }] });
  assert.deepEqual(toDoc(a).overlays, []);
});

// ---- point 2: a playlist referencing a track only on another device survives, and attaches ----

test('playlist portability: an item for a track only present on another device survives the merge', () => {
  const x = mkTrack('a-local-id', 'Only On A', 'Band', 'Album X');
  const keyX = trackIdentityKey(x);
  const a = toDoc(baseLocal('a', {
    tracks: [x],
    playlists: [{ name: 'Mix', items: ['a-local-id'], system: undefined }],
    updatedAt: { playlists: 500 },
  }));
  const b = baseLocal('b', { tracks: [], playlists: [], updatedAt: { playlists: 100 } }); // older -> A's playlist wins LWW
  const merged = fromDocs(b, [a]);
  const items = merged.lastWrite.playlists[0].items;
  assert.deepEqual(items, [keyX]);
});

test('playlist portability: the surviving identity key attaches once a matching track is imported', () => {
  const x = mkTrack('a-local-id', 'Only On A', 'Band', 'Album X');
  const keyX = trackIdentityKey(x);
  assert.equal(resolveIdentityKey(keyX, []), null);
  const reimported = mkTrack('b-local-id-after-import', 'Only On A', 'Band', 'Album X');
  assert.equal(resolveIdentityKey(keyX, [reimported]), reimported);
});

// ---- point 4: a clear has to win everywhere ----

test('history clear: a clear on device B wipes device A\'s stats once A syncs', () => {
  const a = baseLocal('a', { trackPlayCounts: { k1: 5 }, historyClearedAt: 0 });
  const b = toDoc(baseLocal('b', { trackPlayCounts: {}, historyClearedAt: 1000 }));
  const merged = fromDocs(a, [b]);
  assert.equal(merged.historyClearedAt, 1000);
  assert.equal(merged.ownReset, true);
  assert.deepEqual(merged.totals.counters.trackPlayCounts, {}); // A's pre-clear 5 is ignored, not summed in
});

test('history clear: after resetting to the newer clear, later plays on A count again from zero', () => {
  const bDoc = toDoc(baseLocal('b', { trackPlayCounts: {}, historyClearedAt: 1000 }));
  // A adopts the clear locally (per ownReset above) and then registers one new play
  const aAfterReset = baseLocal('a', { trackPlayCounts: { k1: 1 }, historyClearedAt: 1000 });
  const merged = fromDocs(aAfterReset, [bDoc]);
  assert.equal(merged.ownReset, false); // A is caught up now
  assert.deepEqual(merged.totals.counters.trackPlayCounts, { k1: 1 });
});

test('history clear: achievements/Collection/rareUnlocked from a stale row are ignored the same way', () => {
  const a = baseLocal('a', {
    historyClearedAt: 0,
    rareUnlocked: { al1: true },
    achievements: { al1: { tier: 'gold', updatedAt: 10 } },
    collection: { al1: { tier: 2, variant: 'solid-red', pattern: 'solid', discoveredAt: 10 } },
  });
  const b = toDoc(baseLocal('b', { historyClearedAt: 1000 }));
  const merged = fromDocs(a, [b]);
  assert.deepEqual(merged.totals.rareUnlocked, {});
  assert.deepEqual(merged.totals.achievements, {});
  assert.deepEqual(merged.totals.collection, {});
});

test('history clear: sealed records are untouched by a clear (SEALED spec §2 stays true across devices too)', () => {
  const a = baseLocal('a', { historyClearedAt: 0, sealedIds: ['al1'] });
  const b = toDoc(baseLocal('b', { historyClearedAt: 1000 }));
  const merged = fromDocs(a, [b]);
  assert.deepEqual(merged.sealed.sealed, ['al1']);
});

// ---- sealed records: broken anywhere stays broken everywhere ----

test('sealed: a seal broken on one device stays broken after merging with a device that still has it sealed', () => {
  const a = baseLocal('a', { sealedIds: ['al1'] });
  const b = toDoc(baseLocal('b', { sealedIds: [], brokenSealIds: ['al1'] }));
  const merged = fromDocs(a, [b]);
  assert.deepEqual(merged.sealed.sealed, []);
  assert.deepEqual(merged.sealed.broken, ['al1']);
});

// ---- last write wins, per field ----

test('last write wins: an unrelated, later change to one field never clobbers an earlier change to another field', () => {
  const a = toDoc(baseLocal('a', {
    albumSort: { 'Album X': 'manual' }, updatedAt: { albumSort: 100, crateAnchor: 1 }, prefs: { crateAnchor: 'a1' },
  }));
  const b = toDoc(baseLocal('b', { prefs: { crateAnchor: 'b1' }, updatedAt: { prefs: 500 } }));
  const merged = mergeRows([a, b]);
  // B's prefs are newer and win, but A's albumSort (a field B never touched/claims no newer write for) must survive
  assert.deepEqual(merged.lastWrite.prefs, { crateAnchor: 'b1' });
  assert.deepEqual(merged.lastWrite.albumSort, { 'Album X': 'manual' });
});

// ---- robustness ----

test('robustness: toDoc on an empty/old-format localState does not throw', () => {
  assert.doesNotThrow(() => toDoc({}));
  assert.doesNotThrow(() => toDoc(undefined));
});

test('robustness: fromDocs tolerates missing/malformed remote rows without throwing', () => {
  const a = baseLocal('a');
  assert.doesNotThrow(() => fromDocs(a, [{}, null, undefined, { deviceId: 'y' }]));
});

test('robustness: mergeRows on rows missing every optional field does not throw', () => {
  assert.doesNotThrow(() => mergeRows([{}, { deviceId: 'a' }]));
});

// ---- round trip ----

test('round trip: toDoc -> fromDocs with no other devices reproduces this device\'s own data exactly', () => {
  const t = mkTrack('local-a', 'Title', 'Artist', 'Album');
  const local = baseLocal('solo', {
    tracks: [t],
    trackPlayCounts: { [trackIdentityKey(t)]: 4 },
    sessionCounts: { Album: 2 },
    rareUnlocked: { Album: true },
    playlists: [{ name: 'Mix', items: ['local-a'], system: undefined }],
    updatedAt: { playlists: 1 },
  });
  const merged = fromDocs(local, []);
  assert.equal(merged.totals.counters.trackPlayCounts[trackIdentityKey(t)], 4);
  assert.equal(merged.totals.counters.sessionCounts.Album, 2);
  assert.deepEqual(merged.totals.rareUnlocked, { Album: true });
  assert.deepEqual(merged.lastWrite.playlists[0].items, [trackIdentityKey(t)]);
});

// ---- F3 interaction ----

test('F3: Forget library on one device leaves its stats counting fully in the merged totals', () => {
  const t = mkTrack('local-a', 'Title', 'Artist', 'Album');
  const key = trackIdentityKey(t);
  // before Forget: the track is in the library, stats already accrued
  const beforeForget = baseLocal('a', { tracks: [t], trackPlayCounts: { [key]: 7 }, sessionCounts: { Album: 3 } });
  // forgetLibrary() only ever clears the tracks store (F3 spec) -- meta-backed
  // stats are untouched, so the same localState minus `tracks` is exactly
  // what a real caller would pass to toDoc() right after Forget
  const afterForget = Object.assign({}, beforeForget, { tracks: [] });
  assert.deepEqual(toDoc(afterForget).counters.trackPlayCounts, toDoc(beforeForget).counters.trackPlayCounts);

  const b = toDoc(baseLocal('b', { trackPlayCounts: { [key]: 1 } }));
  const merged = fromDocs(afterForget, [b]);
  assert.equal(merged.totals.counters.trackPlayCounts[key], 8);
});
