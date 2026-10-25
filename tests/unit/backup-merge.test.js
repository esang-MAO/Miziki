import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDoc, fromDocs, resolveIdentityKey, SCHEMA_VERSION, canonicalStringify, validateDoc } from '../../src/sync/backup-doc.js';
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
    prefs: {}, profileName: '', picture: null,
    trackPlayCounts: {}, sessionCounts: {}, metalEligibleSessions: {}, trackMetalEligiblePlays: {},
    trackLastPlayed: {}, albumLastPlayed: {}, rareUnlocked: {}, achievements: {}, collection: {},
    sealedIds: [], brokenSealIds: [], overlaysRaw: [], updatedAt: {},
    // RF17 (docs/12_REFINE.md): add-wins playlist membership, local-id
    // keyed (state.js's S.playlistMembershipAt) — see toDoc()'s own
    // convertPlaylistMembership() for how it's converted to identityKey.
    playlistMembershipAt: {},
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

// ---- DA5 (docs/DAY_ARC.md): phasePlayCounts/albumPhaseCounts are per-
// device counters, the exact same rule as trackPlayCounts above —
// phasePlayCounts flat (sumCounters), albumPhaseCounts one level deeper
// (sumNestedCounters) ----

test('DA5: phasePlayCounts sums across devices, the same shape as trackPlayCounts', () => {
  const a = baseLocal('a', { phasePlayCounts: { night: 3, morning: 1 } });
  const b = toDoc(baseLocal('b', { phasePlayCounts: { night: 2, golden: 1 } }));
  const result = fromDocs(a, [b]);
  assert.deepEqual(result.totals.counters.phasePlayCounts, { night: 5, morning: 1, golden: 1 });
});

test('DA5: albumPhaseCounts sums per album, per phase, across devices', () => {
  const a = baseLocal('a', { albumPhaseCounts: { alb1: { night: 2 }, alb2: { morning: 1 } } });
  const b = toDoc(baseLocal('b', { albumPhaseCounts: { alb1: { night: 1, dawn: 1 } } }));
  const result = fromDocs(a, [b]);
  assert.deepEqual(result.totals.counters.albumPhaseCounts, {
    alb1: { night: 3, dawn: 1 },
    alb2: { morning: 1 },
  });
});

test('DA5: albumPhaseCounts repeated/duplicate syncs never inflate the total', () => {
  const a = baseLocal('a', { albumPhaseCounts: { alb1: { night: 2 } } });
  const b = toDoc(baseLocal('b', { albumPhaseCounts: { alb1: { night: 1 } } }));
  const first = fromDocs(a, [b]);
  const second = fromDocs(a, [b, b]);
  assert.deepEqual(first.totals.counters.albumPhaseCounts, { alb1: { night: 3 } });
  assert.deepEqual(second.totals.counters.albumPhaseCounts, { alb1: { night: 3 } });
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
    updatedAt: {
      playlistDefs: { Mix: { seq: 1, at: 500 } },
      playlistOrder: { Mix: { seq: 1, at: 500 } },
    },
  }));
  // B has no track to resolve and no claim of its own for 'Mix' at all —
  // A's own def/order/membership for it simply has nothing to compete with.
  const b = baseLocal('b', { tracks: [], playlists: [] });
  const merged = fromDocs(b, [a]);
  assert.deepEqual(merged.itemWrites.playlistOrder.Mix, [keyX]);
  assert.deepEqual(merged.playlistMembership.Mix, [keyX]);
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

// ---- RF17 (docs/12_REFINE.md): per-key last write wins ----

test('RF17: an unrelated, later change to one field never clobbers an earlier change to another field', () => {
  const a = toDoc(baseLocal('a', {
    albumSort: { 'Album X': 'manual' },
    updatedAt: { albumSort: { 'Album X': { seq: 1, at: 100 } }, prefs: { crateAnchor: { seq: 1, at: 100 } } },
    prefs: { crateAnchor: 'a1' },
  }));
  const b = toDoc(baseLocal('b', {
    prefs: { crateAnchor: 'b1' },
    updatedAt: { prefs: { crateAnchor: { seq: 2, at: 500 } } },
  }));
  const merged = mergeRows([a, b]);
  // B's crateAnchor pref is newer and wins, but A's albumSort (a different
  // field, and one B never claims a write for at all) must survive untouched
  assert.deepEqual(merged.itemWrites.prefs, { crateAnchor: 'b1' });
  assert.deepEqual(merged.itemWrites.albumSort, { 'Album X': 'manual' });
});

// AU9 (docs/16_AUDIO.md §5): the personal per-album format override —
// same per-key last-write-wins shape as albumLookPref/albumSort, just a
// brand-new field (never existed pre-RF17, so no upconvertToV3 case).
test('AU9: albumFormat merges per album key, last write wins, same shape as albumLookPref', () => {
  const a = toDoc(baseLocal('a', {
    albumFormat: { 'Album X': '45' },
    updatedAt: { albumFormat: { 'Album X': { seq: 1, at: 100 } } },
  }));
  const b = toDoc(baseLocal('b', {
    albumFormat: { 'Album X': '33', 'Album Y': 'auto' },
    updatedAt: { albumFormat: { 'Album X': { seq: 2, at: 500 }, 'Album Y': { seq: 1, at: 100 } } },
  }));
  const merged = mergeRows([a, b]);
  assert.deepEqual(merged.itemWrites.albumFormat, { 'Album X': '33', 'Album Y': 'auto' });
});

test('AU9: a doc with no albumFormat field at all (pre-AU9) merges as an empty map, not a throw', () => {
  const a = toDoc(baseLocal('a'));
  delete a.itemWrites.albumFormat;
  const merged = mergeRows([a]);
  assert.deepEqual(merged.itemWrites.albumFormat, {});
});

test('RF17: a later change to one key of a map field never clobbers an earlier change to a different key of the same field', () => {
  const a = toDoc(baseLocal('a', {
    albumSort: { 'Album X': 'manual' },
    updatedAt: { albumSort: { 'Album X': { seq: 1, at: 100 } } },
  }));
  const b = toDoc(baseLocal('b', {
    albumSort: { 'Album Y': 'title' },
    updatedAt: { albumSort: { 'Album Y': { seq: 1, at: 900 } } },
  }));
  const merged = mergeRows([a, b]);
  // two different albums, two different keys -- both survive regardless of
  // which stamp is newer, since neither competes with the other's key
  assert.deepEqual(merged.itemWrites.albumSort, { 'Album X': 'manual', 'Album Y': 'title' });
});

test('RF17: a removed key (present as a stamp, absent from the current value map) becomes a tombstone that drops out of the merged map', () => {
  const a = toDoc(baseLocal('a', {
    albumOrder: { 'Album X': ['id1', 'id2'] },
    updatedAt: { albumOrder: { 'Album X': { seq: 1, at: 100 } } },
  }));
  // B deleted the album's own manual order entirely (e.g. the album lost
  // its last track) -- a later stamp, no current value for that key at all
  const b = toDoc(baseLocal('b', {
    albumOrder: {},
    updatedAt: { albumOrder: { 'Album X': { seq: 2, at: 200 } } },
  }));
  const merged = mergeRows([a, b]);
  assert.equal('Album X' in merged.itemWrites.albumOrder, false);
});

test('RF17: two offline hearts to the same playlist, on two different devices, both survive', () => {
  const x = mkTrack('a-local-x', 'Song X', 'Artist', 'Album X');
  const y = mkTrack('b-local-y', 'Song Y', 'Artist', 'Album Y');
  const keyX = trackIdentityKey(x), keyY = trackIdentityKey(y);
  // A hearts X while offline; B hearts Y while offline -- neither device
  // ever saw the other's edit, so their own membership map only has its own
  // addition, never a tombstone for the other device's pick.
  const a = toDoc(baseLocal('a', {
    tracks: [x],
    playlists: [{ name: 'Favorites', items: ['a-local-x'], system: 'favorites' }],
    playlistMembershipAt: { ['Favorites\u0000a-local-x']: { added: { seq: 1, at: 100 }, removed: null } },
    updatedAt: { playlistDefs: { Favorites: { seq: 1, at: 100 } }, playlistOrder: { Favorites: { seq: 1, at: 100 } } },
  }));
  const b = toDoc(baseLocal('b', {
    tracks: [y],
    playlists: [{ name: 'Favorites', items: ['b-local-y'], system: 'favorites' }],
    playlistMembershipAt: { ['Favorites\u0000b-local-y']: { added: { seq: 1, at: 150 }, removed: null } },
    updatedAt: { playlistDefs: { Favorites: { seq: 1, at: 150 } }, playlistOrder: { Favorites: { seq: 1, at: 150 } } },
  }));
  const merged = mergeRows([a, b]);
  const members = new Set(merged.playlistMembership.Favorites || []);
  assert.equal(members.has(keyX), true);
  assert.equal(members.has(keyY), true);
  assert.equal(members.size, 2);
});

// ---- RF17: forward compatibility -- a v2 (whole-blob) doc upgrades cleanly ----

test('RF17: a v2 doc (whole-blob lastWrite, no itemWrites/playlistMembership) upgrades cleanly through fromDocs', () => {
  const t = mkTrack('local-a', 'Old Title', 'Artist', 'Album');
  const key = trackIdentityKey(t);
  const v2Doc = {
    schemaVersion: 2, deviceId: 'old-device', historyClearedAt: 0,
    counters: { trackPlayCounts: {}, sessionCounts: {}, metalEligibleSessions: {}, trackMetalEligiblePlays: {}, phasePlayCounts: {}, albumPhaseCounts: {} },
    maxFields: {}, rareUnlocked: {}, achievements: {}, collection: {},
    sealed: { sealed: [], broken: [] },
    lastWrite: {
      albumSort: { seq: 3, at: 1000, deviceId: 'old-device', value: { 'Album': 'manual' } },
      prefs: { seq: 2, at: 900, deviceId: 'old-device', value: { crateAnchor: 'legacy' } },
      playlists: { seq: 1, at: 500, deviceId: 'old-device', value: [{ name: 'Mix', items: [key], system: undefined }] },
      profileName: { seq: 1, at: 500, deviceId: 'old-device', value: 'Old Name' },
    },
    overlays: [], covers: [],
  };
  const a = baseLocal('a', { tracks: [t] });
  const merged = fromDocs(a, [v2Doc]);
  // the whole-blob stamp explodes onto every key that field's value held,
  // so each key still merges through the one, current (per-key) path
  assert.deepEqual(merged.itemWrites.albumSort, { Album: 'manual' });
  assert.deepEqual(merged.itemWrites.prefs, { crateAnchor: 'legacy' });
  assert.deepEqual(merged.itemWrites.playlistOrder.Mix, [key]);
  assert.deepEqual(merged.playlistMembership.Mix, [key]);
  assert.equal(merged.lastWrite.profileName, 'Old Name');
});

// ---- RF16 (docs/12_REFINE.md): seq beats a slow clock, deviceId breaks ties ----

test('RF16: a device with a slow clock still wins after editing something it just pulled', () => {
  // B edits profileName first, at wall-clock time 1000, with seq 1 (its own
  // first-ever touch).
  const b = toDoc(baseLocal('b', { profileName: 'B wrote this', updatedAt: { profileName: { seq: 1, at: 1000 } } }));
  // A's clock is an hour behind: A pulls B's row (so its own backupSeq is
  // bumped to at least 1, per sync/backup.js's pullAndMergeBackup), then
  // makes its own edit "after" that -- seq 2 (one more than what it saw),
  // but at a wall-clock time *earlier* than B's own stamp.
  const a = toDoc(baseLocal('a', {
    profileName: 'A wrote this after seeing B',
    updatedAt: { profileName: { seq: 2, at: 1000 - 3600000 } },
  }));
  const merged = mergeRows([a, b]);
  // seq beats at: A's edit happened-after B's from A's own point of view,
  // regardless of whose wall clock reads later.
  assert.equal(merged.lastWrite.profileName, 'A wrote this after seeing B');
  // Order independence: the same answer regardless of which row comes first.
  const mergedReversed = mergeRows([b, a]);
  assert.equal(mergedReversed.lastWrite.profileName, 'A wrote this after seeing B');
});

test('RF16: equal seq and equal at give the same winner in every row order, via deviceId', () => {
  const a = toDoc(baseLocal('a', { profileName: 'From A', updatedAt: { profileName: { seq: 5, at: 1000 } } }));
  const b = toDoc(baseLocal('b', { profileName: 'From B', updatedAt: { profileName: { seq: 5, at: 1000 } } }));
  const c = toDoc(baseLocal('c', { profileName: 'From C', updatedAt: { profileName: { seq: 5, at: 1000 } } }));
  const winners = new Set();
  [[a, b, c], [b, a, c], [c, b, a], [b, c, a]].forEach(order => {
    winners.add(mergeRows(order).lastWrite.profileName);
  });
  assert.equal(winners.size, 1); // exactly one winner, regardless of row order
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
  const key = trackIdentityKey(t);
  const local = baseLocal('solo', {
    tracks: [t],
    trackPlayCounts: { [key]: 4 },
    sessionCounts: { Album: 2 },
    rareUnlocked: { Album: true },
    playlists: [{ name: 'Mix', items: ['local-a'], system: undefined }],
    updatedAt: {
      playlistDefs: { Mix: { seq: 1, at: 1 } },
      playlistOrder: { Mix: { seq: 1, at: 1 } },
    },
  });
  const merged = fromDocs(local, []);
  assert.equal(merged.totals.counters.trackPlayCounts[key], 4);
  assert.equal(merged.totals.counters.sessionCounts.Album, 2);
  assert.deepEqual(merged.totals.rareUnlocked, { Album: true });
  assert.deepEqual(merged.itemWrites.playlistOrder.Mix, [key]);
  assert.deepEqual(merged.playlistMembership.Mix, [key]);
});

// ---- step 07 (B4): custom-cover images, per-track last write wins ----

test('covers: a later cover change on another device wins over an earlier one', () => {
  const t = mkTrack('local-a', 'Song', 'Artist', 'Album');
  const key = trackIdentityKey(t);
  const a = baseLocal('a', { tracks: [t], overlaysRaw: [{ id: 'local-a', cover: { hash: 'old-hash', updatedAt: 100 } }] });
  const b = toDoc(baseLocal('b', { tracks: [t], overlaysRaw: [{ id: 'local-a', cover: { hash: 'new-hash', updatedAt: 200 } }] }));
  const merged = fromDocs(a, [b]);
  assert.equal(merged.covers[key].hash, 'new-hash');
  assert.equal(merged.covers[key].at, 200);
});

test('covers: an earlier cover change never beats a later one, regardless of row order', () => {
  const t = mkTrack('local-a', 'Song', 'Artist', 'Album');
  const a = toDoc(baseLocal('a', { tracks: [t], overlaysRaw: [{ id: 'local-a', cover: { hash: 'new-hash', updatedAt: 200 } }] }));
  const b = toDoc(baseLocal('b', { tracks: [t], overlaysRaw: [{ id: 'local-a', cover: { hash: 'old-hash', updatedAt: 100 } }] }));
  const key = trackIdentityKey(t);
  assert.equal(mergeRows([a, b]).covers[key].hash, 'new-hash');
  assert.equal(mergeRows([b, a]).covers[key].hash, 'new-hash');
});

test('covers: a revert tombstone (hash: null) wins over an earlier cover set, same as overlays', () => {
  const t = mkTrack('local-a', 'Song', 'Artist', 'Album');
  const key = trackIdentityKey(t);
  const a = baseLocal('a', { tracks: [t], overlaysRaw: [{ id: 'local-a', cover: { hash: 'some-hash', updatedAt: 100 } }] });
  const b = toDoc(baseLocal('b', { tracks: [t], overlaysRaw: [{ id: 'local-a', reverted: true, revertedAt: 200 }] }));
  const merged = fromDocs(a, [b]);
  assert.equal(merged.covers[key].hash, null);
  assert.equal(merged.covers[key].at, 200);
});

test('covers: a plain tag-only edit with no cover field makes no cover claim at all', () => {
  const t = mkTrack('local-a', 'Song', 'Artist', 'Album');
  const a = baseLocal('a', { tracks: [t], overlaysRaw: [{ id: 'local-a', fields: { title: 'Edited' }, editedAt: 100 }] });
  assert.deepEqual(toDoc(a).covers, []);
});

test('covers: an unresolvable local id (track not currently present) is skipped, not crashed on', () => {
  const a = baseLocal('a', { tracks: [], overlaysRaw: [{ id: 'ghost', cover: { hash: 'x', updatedAt: 1 } }] });
  assert.deepEqual(toDoc(a).covers, []);
});

// ---- step 07 (B4): profile picture / public avatar, last write wins ----

test('picture: a later profile-picture change on another device wins over an earlier one', () => {
  const a = toDoc(baseLocal('a', { picture: { hash: 'old', updatedAt: 1 }, updatedAt: { picture: { at: 1 } } }));
  const b = toDoc(baseLocal('b', { picture: { hash: 'new', updatedAt: 2 }, updatedAt: { picture: { at: 2 } } }));
  const merged = mergeRows([a, b]);
  assert.deepEqual(merged.lastWrite.picture, { hash: 'new', updatedAt: 2 });
});

test('picture: an unrelated, later change to a different field never clobbers an earlier picture change', () => {
  const a = toDoc(baseLocal('a', { picture: { hash: 'mine', updatedAt: 500 }, updatedAt: { picture: { at: 500 } } }));
  const b = toDoc(baseLocal('b', { prefs: { x: 1 }, updatedAt: { prefs: { at: 9999 } } }));
  const merged = mergeRows([a, b]);
  assert.deepEqual(merged.lastWrite.picture, { hash: 'mine', updatedAt: 500 });
});

// ---- schema v1 docs (pre-step-07, no covers/picture fields) must still load ----

test('schema v1 compatibility: a doc with no covers/picture fields at all merges without throwing', () => {
  const v1Doc = {
    schemaVersion: 1, deviceId: 'old-device', historyClearedAt: 0,
    counters: { trackPlayCounts: { k1: 3 } },
    maxFields: {}, rareUnlocked: {}, achievements: {}, collection: {},
    sealed: { sealed: [], broken: [] },
    lastWrite: { playlists: { at: 1, value: [] }, profileName: { at: 1, value: 'Old Name' } },
    overlays: [],
    // deliberately no `covers` key at all -- the pre-step-07 shape
  };
  const a = baseLocal('a', { trackPlayCounts: { k1: 1 } });
  assert.doesNotThrow(() => fromDocs(a, [v1Doc]));
  const merged = fromDocs(a, [v1Doc]);
  assert.equal(merged.totals.counters.trackPlayCounts.k1, 4);
  assert.deepEqual(merged.covers, {});          // no covers claimed by either side
  // ownLocal's own (current-schema) doc always contributes a lastWrite.picture
  // claim, even an unset one (value: null) -- the v1 remote row simply never
  // out-competes it, since it has no claim of its own to offer at all
  assert.equal(merged.lastWrite.picture, null);
  assert.equal(merged.lastWrite.profileName, 'Old Name');
  // DA5: a doc from before phasePlayCounts/albumPhaseCounts existed (this
  // same v1Doc has neither) still merges, reading back {} rather than
  // undefined or throwing
  assert.deepEqual(merged.totals.counters.phasePlayCounts, {});
  assert.deepEqual(merged.totals.counters.albumPhaseCounts, {});
});

test('schema v1 compatibility: mergeRows on a bare v1-shaped row never throws reading .covers/.picture', () => {
  assert.doesNotThrow(() => mergeRows([{ deviceId: 'x', lastWrite: {} }]));
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

/* ================= RF19 (docs/12_REFINE.md): verify, and keep a way back ================= */

test('canonicalStringify: key order never changes the output', () => {
  const a = { b: 1, a: { d: 2, c: 3 } };
  const b = { a: { c: 3, d: 2 }, b: 1 };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

test('canonicalStringify: array order is preserved, never sorted', () => {
  const doc = { list: [3, 1, 2] };
  assert.equal(canonicalStringify(doc), '{"list":[3,1,2]}');
});

test('canonicalStringify: the same doc from toDoc() hashes identically regardless of object construction order', () => {
  const a = toDoc(baseLocal('a', { trackPlayCounts: { k1: 1, k2: 2 } }));
  // rebuild an equal object with keys inserted in a different order
  const shuffled = JSON.parse(JSON.stringify(a));
  assert.equal(canonicalStringify(a), canonicalStringify(shuffled));
});

test('validateDoc: a real toDoc() output always validates', () => {
  const t = mkTrack('local-a', 'Title', 'Artist', 'Album');
  const doc = toDoc(baseLocal('a', {
    tracks: [t],
    trackPlayCounts: { [trackIdentityKey(t)]: 3 },
    playlists: [{ name: 'Favorites', items: ['local-a'], system: 'favorites' }],
    overlaysRaw: [{ id: 'local-a', fields: { title: 'Edited' }, editedAt: 5 }],
  }));
  assert.equal(validateDoc(doc), true);
});

test('validateDoc: rejects a doc with a negative counter', () => {
  const doc = toDoc(baseLocal('a', { trackPlayCounts: { k1: -1 } }));
  assert.equal(validateDoc(doc), false);
});

test('validateDoc: rejects a doc with a non-integer counter', () => {
  const doc = toDoc(baseLocal('a', { trackPlayCounts: { k1: 1.5 } }));
  assert.equal(validateDoc(doc), false);
});

test('validateDoc: rejects a doc whose deviceId is missing or not a string', () => {
  const doc = toDoc(baseLocal('a'));
  assert.equal(validateDoc(Object.assign({}, doc, { deviceId: 42 })), false);
  assert.equal(validateDoc(Object.assign({}, doc, { deviceId: undefined })), false);
});

test('validateDoc: rejects a doc whose sealed list holds a non-string entry', () => {
  const doc = toDoc(baseLocal('a', { sealedIds: ['ok'] }));
  const bad = Object.assign({}, doc, { sealed: { sealed: [123], broken: [] } });
  assert.equal(validateDoc(bad), false);
});

test('validateDoc: rejects a doc whose itemWrites entry is missing a numeric seq', () => {
  const doc = toDoc(baseLocal('a', { prefs: { x: 1 }, updatedAt: { prefs: { x: { seq: 1, at: 1 } } } }));
  const bad = Object.assign({}, doc, {
    itemWrites: Object.assign({}, doc.itemWrites, {
      prefs: [{ key: 'x', seq: 'not-a-number', at: 1, deviceId: 'a', value: 1 }],
    }),
  });
  assert.equal(validateDoc(bad), false);
});

test('validateDoc: rejects a doc whose playlistMembership entry has a malformed stamp', () => {
  const doc = toDoc(baseLocal('a'));
  const bad = Object.assign({}, doc, {
    playlistMembership: [{ playlist: 'Favorites', identityKey: 'k1', added: { seq: -1, at: 0 }, removed: null }],
  });
  assert.equal(validateDoc(bad), false);
});

test('validateDoc: accepts a v1 doc upconverted to v3 shape (no throw, structurally valid)', () => {
  const v1Doc = {
    schemaVersion: 1, deviceId: 'old-device', historyClearedAt: 0,
    counters: { trackPlayCounts: { k1: 3 } },
    maxFields: {}, rareUnlocked: {}, achievements: {}, collection: {},
    sealed: { sealed: [], broken: [] },
    lastWrite: { playlists: { at: 1, value: [] }, profileName: { at: 1, value: 'Old Name' } },
    overlays: [],
  };
  const a = baseLocal('a', { trackPlayCounts: { k1: 1 } });
  assert.doesNotThrow(() => fromDocs(a, [v1Doc]));
});

test('fromDocs: a structurally invalid remote row is dropped, never merged', () => {
  const a = baseLocal('a', { trackPlayCounts: { k1: 1 } });
  const validRemote = toDoc(baseLocal('b', { trackPlayCounts: { k1: 2 } }));
  const invalidRemote = Object.assign({}, toDoc(baseLocal('c', { trackPlayCounts: { k1: 100 } })), {
    counters: { trackPlayCounts: { k1: -100 } },
  });
  const merged = fromDocs(a, [validRemote, invalidRemote]);
  // only a (1) + b (2) count -- c's negative counter makes the whole row invalid
  assert.equal(merged.totals.counters.trackPlayCounts.k1, 3);
});
