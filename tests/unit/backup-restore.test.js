import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';

/* ================= RF19 (docs/12_REFINE.md), point 4: a real restore test =================
   "A fresh fake-indexeddb device signs in and reconstructs the merged
   library and stats." Every other backup-*.test.js file mocks src/storage/
   repo.js with a tiny in-memory Map stand-in (see backup-sync.test.js's own
   header for why that's the right call for *those* files — they're testing
   merge/push/pull logic, not persistence itself). This file is the
   exception: it leaves storage/repo.js and storage/idb.js real, backed by a
   genuine fresh IDBFactory (the same pattern tests/unit/idb.test.js already
   established), so the thing actually being proven is that a brand-new
   device's local IndexedDB really ends up holding the merged data once this
   module's own meta.put() calls run — not just that the right values exist
   in memory after a pull.

   src/sync/backup.js's own header comment states its import list is
   deliberately narrow (never library/view.js, record-art/looks.js or
   storage/meta.js) specifically so nothing that imports it drags in the
   app's most circularly-connected modules — this test is the payoff: it
   needs no "stop the chain at the door" mock list at all beyond the one
   module (sync/images.js) whose real implementation would mean a real,
   slow, non-deterministic crypto.subtle.digest() call on every push, the
   same reasoning backup-sync.test.js's own header already gives. */
let fakeSeq = 0;
function fakeSha256Hex(){
  // deterministic, distinct per call — this file never asserts on a
  // checksum's own value, only that push/pull still complete end to end
  // with a real IndexedDB underneath, so a cheap stand-in is enough; the
  // real sha256Hex is covered by tests/unit/images.test.js and the
  // checksum-specific tests in backup-merge.test.js/backup-sync.test.js.
  return Promise.resolve((fakeSeq++).toString(16).padStart(64, '0'));
}
mock.module(new URL('../../src/sync/images.js', import.meta.url).href, {
  namedExports: {
    sha256Hex: fakeSha256Hex,
    prepareCoverUpload: async () => { throw new Error('not exercised by this test'); },
    prepareAvatarUpload: async () => { throw new Error('not exercised by this test'); },
  },
});

const { S } = await import('../../src/state.js');
const { storage, meta, overlays: overlaysRepo } = await import('../../src/storage/repo.js');
const { toDoc, SCHEMA_VERSION } = await import('../../src/sync/backup-doc.js');
const { pullBackupOnForeground, getBackupStatus } = await import('../../src/sync/backup.js');
const { trackIdentityKey, albumKey } = await import('../../src/record-art/tiers.js');

function freshIndexedDB(){
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  return factory;
}
function resetDBHandle(){
  DB.db = null;
  DB.ok = false;
}

function freshState(){
  S.tracks = []; S.playlists = []; S.albumOrder = {}; S.albumSort = {};
  S.albumDisplay = {}; S.trackDisplay = {}; S.albumEdge = {}; S.albumLookPref = {};
  S.profile = { name: '', username: '', art: null, artBlob: null, pictureHash: null };
  S.trackPlayCounts = {}; S.sessionCounts = {}; S.metalEligibleSessions = {};
  S.trackMetalEligiblePlays = {}; S.trackLastPlayed = {}; S.albumLastPlayed = {};
  S.rareUnlocked = {}; S.zoetropeUnlocked = {}; S.zoetropeDayProgress = {};
  S.achievements = {}; S.collection = {}; S.mergedStats = null;
  S.sealed = new Set(); S.sealedBroken = new Set();
  S.backupUpdatedAt = { playlists:0, albumOrder:0, albumSort:0, albumDisplay:0, trackDisplay:0, albumEdge:0, albumLookPref:0, prefs:0, profileName:0, picture:0 };
  S.playlistMembershipAt = {};
  S.historyClearedAt = 0; S.deviceId = null; S.deviceLabel = null; S.backupRestoredFor = null;
  S.backupSeq = 0; S.backupPushSeq = 0;
  S.phasePlayCounts = {}; S.albumPhaseCounts = {}; S.rhythmPushedAt = 0;
  S.shareStyle = null; S.shareFormatByCard = {}; S.librarySort = null; S.crateAnchor = null;
}

// Shaped like fetchRemoteRows()'s own client.from(table).select(...) rows --
// {device_id, doc, checksum} -- not fromDocs()'s internal doc-plus-deviceId
// shape (fetchRemoteRows() does that assembly itself).
function remoteRow(deviceId, overrides){
  const doc = toDoc(Object.assign({
    deviceId, historyClearedAt: 0, tracks: [],
    playlists: [], albumOrder: {}, albumSort: {},
    albumDisplay: {}, trackDisplay: {}, albumEdge: {}, albumLookPref: {},
    prefs: {}, profileName: '', picture: null,
    trackPlayCounts: {}, sessionCounts: {}, metalEligibleSessions: {}, trackMetalEligiblePlays: {},
    phasePlayCounts: {}, albumPhaseCounts: {},
    trackLastPlayed: {}, albumLastPlayed: {}, rareUnlocked: {}, achievements: {}, collection: {},
    zoetropeUnlocked: {}, zoetropeDayProgress: {},
    sealedIds: [], brokenSealIds: [], overlaysRaw: [], updatedAt: {}, playlistMembershipAt: {},
  }, overrides));
  return { device_id: deviceId, doc, checksum: null };
}

let nextUpdatedAt = 1;
function makePullClient(remoteRows){
  const upserts = [];
  const withCursor = remoteRows.map(r => Object.assign({ updated_at: nextUpdatedAt++ }, r));
  return {
    upserts,
    auth: { getUser: async () => ({ data: { user: { id: 'user-restore-1', email: 'restore@test' } } }) },
    rpc(name, args){
      if(name !== 'put_library_backup') return Promise.resolve({ error: null });
      upserts.push({ device_id: args.p_device, doc: args.p_doc, checksum: args.p_checksum });
      return Promise.resolve({ error: null });
    },
    from(){
      return {
        select(cols){
          if(cols === 'device_id, updated_at'){
            return Promise.resolve({ data: withCursor.map(r => ({ device_id: r.device_id, updated_at: r.updated_at })), error: null });
          }
          return {
            in: (_col, ids) => Promise.resolve({
              data: withCursor.filter(r => ids.includes(r.device_id)).map(r => ({ device_id: r.device_id, doc: r.doc, updated_at: r.updated_at, checksum: r.checksum })),
              error: null,
            }),
          };
        },
      };
    },
  };
}
function stubSocial(client){
  globalThis.MizikiSocial = { getClient(){ return client; }, on(){}, status(){ return { auth: 'signedIn' }; } };
}
async function flushMicrotasks(){
  // a real fake-indexeddb transaction takes a few more event-loop ticks per
  // operation than a plain resolved promise does, and this file's pull path
  // chains several of them in a row (ensureDeviceId, overlaysRepo.all(),
  // the fetch itself, then applyOverlayToTrack()'s own overlaysRepo.get()/
  // .put() pair) -- so this needs a wider margin than the in-memory-Map
  // backed backup-sync.test.js/backup-reset.test.js ever do.
  for(let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
}

test('RF19 pt4: a fresh fake-indexeddb device reconstructs playlists, stats, achievements and sealed state from another device\'s backup', async () => {
  freshIndexedDB();
  resetDBHandle();
  const opened = await storage.open();
  assert.equal(opened, true, 'a brand-new IndexedDB must open cleanly');
  freshState();

  // this device already has one real local track (imported before ever
  // signing in) -- its identity key is what lets the remote playlist/
  // overlay/album-order entries below resolve to a real local id rather
  // than staying pending
  const tags = { title: 'Nightdrive', artist: 'Aurora Static', album: 'Afterglow', albumArtist: 'Aurora Static' };
  const track = { id: 'song.flac|12345|1000', tags };
  S.tracks = [track];

  // "device-old" is a different physical device, so its own local id for
  // the same song is a different string -- the only thing the two devices
  // share is the song's own identity key (derived from tags), which is
  // exactly what toDoc()'s own idsToKeys()/buildIdentityLookup() need to
  // convert remoteLocalId -> identityKey, the thing this fresh device then
  // has to resolve back to its own, differently-named local id.
  const remoteLocalId = 'other-device-song.flac|99999|2000';
  // trackPlayCounts/sessionCounts/achievements/collection/sealedIds are
  // already keyed by the portable identity key (trackIdentityKey/albumKey)
  // in real S -- toDoc() passes them straight through with no conversion
  // of its own (see that function's own trackPlayCounts comment) -- so the
  // fixture has to use the real computed keys too, not the album's display
  // title, the same way real S never would.
  const trackKey = trackIdentityKey(track);
  const albKey = albumKey(track);
  const remote = remoteRow('device-old', {
    historyClearedAt: 0,
    tracks: [{ id: remoteLocalId, tags }],
    playlists: [{ name: 'Night Shift', system: null, items: [remoteLocalId] }],
    albumOrder: { [albKey]: [remoteLocalId] },
    trackPlayCounts: { [trackKey]: 11 },
    sessionCounts: { [albKey]: 4 },
    achievements: { [albKey]: { tier: 'gold' } },
    collection: { [albKey]: { variant: 'rare' } },
    // PRESSINGS_110 PR7 (docs/PRESSINGS_110.md §8): zoetropeUnlocked is the
    // same union-of-flags shape as rareUnlocked right above it -- confirm
    // it round-trips through the real pull/apply/persist path the same way.
    zoetropeUnlocked: { [albKey]: true },
    zoetropeDayProgress: { [albKey]: ['2020-01-01', '2020-01-02', '2020-01-03'] },
    sealedIds: [albKey],
    overlaysRaw: [{ id: remoteLocalId, fields: { title: 'Nightdrive (Remaster)' }, editedAt: 500 }],
  });
  const client = makePullClient([remote]);
  stubSocial(client);

  pullBackupOnForeground();
  await flushMicrotasks();

  assert.equal(getBackupStatus().lastError, null, 'a well-formed remote row must not report a verification failure');

  // reconstructed in memory
  assert.equal(S.playlists.length, 1);
  assert.equal(S.playlists[0].name, 'Night Shift');
  assert.deepEqual(S.playlists[0].items, [track.id], 'the identity-key playlist item resolved to the real local track id');
  assert.deepEqual(S.albumOrder[albKey], [track.id]);
  assert.equal(S.mergedStats.trackPlayCounts[trackKey], 11);
  assert.equal(S.mergedStats.sessionCounts[albKey], 4);
  assert.deepEqual(S.achievements[albKey], { tier: 'gold' });
  assert.deepEqual(S.collection[albKey], { variant: 'rare' });
  assert.equal(S.zoetropeUnlocked[albKey], true);
  assert.deepEqual(S.zoetropeDayProgress[albKey], ['2020-01-01', '2020-01-02', '2020-01-03']);
  assert.ok(S.sealed.has(albKey), 'the remote seal was adopted');
  assert.equal(track.tags.title, 'Nightdrive (Remaster)', 'the remote overlay was applied to the real local track');

  // and it actually reached the real IndexedDB, not just S in memory --
  // read every write back through the same real storage/repo.js interface
  assert.equal(await meta.get('mergedStats').then(v => v && v.trackPlayCounts[trackKey]), 11);
  // historyClearedAt is only ever written to meta on the ownReset branch
  // (applyMerged()) -- this pull's remote row never cleared anything, so
  // there's nothing for that branch to persist; S's own in-memory default
  // (0, set by freshState()) is what's being confirmed as still correct.
  assert.equal(S.historyClearedAt, 0);
  assert.equal(typeof await meta.get('deviceId'), 'string', 'ensureDeviceId() persisted a real device id');
  const storedOverlay = await overlaysRepo.get(track.id);
  assert.equal(storedOverlay.fields.title, 'Nightdrive (Remaster)');

  // this device's own post-pull push went out, stamped at the current
  // schema version, over the real, newly-opened connection
  assert.ok(client.upserts.length >= 1);
  const uploaded = client.upserts[client.upserts.length - 1];
  assert.equal(uploaded.doc.schemaVersion, SCHEMA_VERSION);
  assert.equal(typeof uploaded.checksum, 'string');

  // simulate a real app restart on the same physical device: drop this
  // process's open connection (not the underlying fake IndexedDB itself)
  // and reopen fresh -- everything meta.put() wrote above must still be
  // there, proving it was really written through to the database and
  // not just held by the still-open connection object.
  DB.db.close();
  resetDBHandle();
  const reopened = await storage.open();
  assert.equal(reopened, true);
  assert.equal(await meta.get('mergedStats').then(v => v && v.trackPlayCounts[trackKey]), 11, 'survives a real close + reopen of the database');
  assert.equal(typeof await meta.get('deviceId'), 'string');
  const overlayAfterReopen = await overlaysRepo.get(track.id);
  assert.equal(overlayAfterReopen.fields.title, 'Nightdrive (Remaster)');

  DB.db.close();
});

test('RF19 pt4: an identity-key entry for a track this fresh device doesn\'t have yet is kept pending, not dropped', async () => {
  freshIndexedDB();
  resetDBHandle();
  await storage.open();
  freshState();
  S.tracks = []; // nothing local at all yet

  const remote = remoteRow('device-old', {
    playlists: [{ name: 'Favorites', system: 'favorites', items: ['missing song|artist|album'] }],
  });
  const client = makePullClient([remote]);
  stubSocial(client);

  pullBackupOnForeground();
  await flushMicrotasks();

  assert.equal(S.playlists.length, 1);
  assert.equal(S.playlists[0].name, 'Favorites');
  assert.deepEqual(S.playlists[0].items, [], 'an identity key with no matching local track is held back, not pushed into S.playlists as a bare string');

  DB.db.close();
});
