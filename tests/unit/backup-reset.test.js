import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/* ================= RF1 (docs/12_REFINE.md) =================
   "A clear on one device stays cleared everywhere." Before this fix,
   sync/backup.js's applyMerged() only zeroed four counters in memory on
   the 'ownReset' path and persisted none of it — a reload read the old,
   un-zeroed counts straight back out of meta, and the next push
   re-uploaded them, undoing the clear on every device.

   This file loads the REAL src/sync/backup.js (unlike backup-sync.test.js's
   neighbours that mock it away) together with the REAL src/history/clear.js,
   so it can exercise the actual pull -> ownReset -> resetLocalHistory() ->
   push round trip end to end. That means mocking the same "stop the chain
   at the door" boundary tests/unit/history.test.js already established for
   clear.js's own real chain (sessions.js -> thumbs.js -> edit.js -> sealed.js/
   credits.js -> queue.js -> ...), *except* storage/repo.js and sync/backup.js
   themselves, which stay real (or, for storage/repo.js, a tiny in-memory
   stand-in instead of fake-indexeddb — the same reasoning
   tests/unit/backup-sync.test.js's own header gives) since those two are
   exactly what this file is testing. */
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: { $(){ return null; }, el(){ return null; } },
});
mock.module(new URL('../../src/history/achievements.js', import.meta.url).href, {
  namedExports: { checkAlbumAchievementAndCollection: mock.fn() },
});
mock.module(new URL('../../src/gatefold/sealed-sheet.js', import.meta.url).href, {
  namedExports: { updateSealedSheetAfterBreak(){} },
});
mock.module(new URL('../../src/library/view.js', import.meta.url).href, {
  namedExports: { renderTracks(){}, exitSelectMode(){}, songRow(){}, updateTrackRow(){ return false; } },
});
mock.module(new URL('../../src/crate/tiers.js', import.meta.url).href, {
  namedExports: { deleteCrateArtTiers(){}, buildCrateTier(){} },
});
mock.module(new URL('../../src/crate/model.js', import.meta.url).href, {
  namedExports: { invalidateCrateModel(){} },
});
mock.module(new URL('../../src/shell/mini-player.js', import.meta.url).href, {
  namedExports: { renderMiniPlayer(){} },
});
mock.module(new URL('../../src/shell/player-overlay.js', import.meta.url).href, {
  namedExports: { closePlayer(){}, openPlayerViaSheet(){} },
});
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute(){} },
});
mock.module(new URL('../../src/shell/start-sequence.js', import.meta.url).href, {
  namedExports: { runStartSequence(){} },
});
mock.module(new URL('../../src/shell/runout.js', import.meta.url).href, {
  namedExports: { endOfQueue(){}, maybeSideFlip(){ return false; }, cancelRunout(){}, interruptRunout(){ return false; }, clearToRest(){} },
});
mock.module(new URL('../../src/shell/put-away.js', import.meta.url).href, {
  namedExports: { shouldPutAway(){ return false; }, putAwayInstant(){}, runPutAwaySequence(){} },
});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext(){} },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { load(){}, pause(){}, play(){}, seek(){} },
});
mock.module(new URL('../../src/player/sleep-timer.js', import.meta.url).href, {
  namedExports: { sleepStopPlayback(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawTime(){} },
});
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){}, touchBackupField(){} },
});
mock.module(new URL('../../src/sundown/solar.js', import.meta.url).href, {
  namedExports: { realDayPosition(){ return { phase: 'midday' }; } },
});
// profile/screens.js is a real circular-ish dependent of both clear.js
// (persistTrackLastPlayed/renderProfile) and backup.js's own applyMerged()
// path (nothing here) — mocked the same way history.test.js does.
mock.module(new URL('../../src/profile/screens.js', import.meta.url).href, {
  namedExports: { persistTrackLastPlayed: async () => {}, renderProfile(){} },
});

// storage/repo.js: a tiny in-memory stand-in, not fake-indexeddb — the same
// reasoning backup-sync.test.js's own header gives. One shared store object
// so clear.js's resetLocalHistory() and backup.js's push/pull see the exact
// same persisted state.
const metaStore = new Map(), achievementsStore = new Map(), collectionStore = new Map(), sessionsStore = new Map();
const artworkStore = new Map();
let profileRecord = null;
function storeFor(map){
  return {
    async get(id){ return map.has(id) ? map.get(id) : null; },
    async put(rec){ map.set(rec.id, rec); },
    async del(id){ map.delete(id); },
    async all(){ return [...map.values()]; },
    async clear(){ map.clear(); },
  };
}
mock.module(new URL('../../src/storage/repo.js', import.meta.url).href, {
  namedExports: {
    storage: { available(){ return true; }, async open(){} },
    tracks: { async all(){ return []; }, async get(){ return null; }, async put(){}, async del(){} },
    meta: {
      async get(k){ return metaStore.has(k) ? metaStore.get(k) : null; },
      async put(k, v){ metaStore.set(k, v); },
      async del(k){ metaStore.delete(k); },
    },
    achievements: storeFor(achievementsStore),
    collection: storeFor(collectionStore),
    sessions: storeFor(sessionsStore),
    overlays: { async all(){ return []; }, async get(){ return null; }, async put(){}, async del(){} },
    artwork: {
      async get(id){ return artworkStore.has(id) ? artworkStore.get(id) : null; },
      async put(rec){ artworkStore.set(rec.id, rec); },
      async del(id){ artworkStore.delete(id); },
    },
    profile: {
      async get(){ return profileRecord; },
      async put(rec){ profileRecord = rec; },
    },
  },
});

const { S } = await import('../../src/state.js');
const { toDoc, SCHEMA_VERSION } = await import('../../src/sync/backup-doc.js');
const { resetLocalHistory } = await import('../../src/history/clear.js');
const { onBackup, pullBackupOnForeground, getBackupStatus } = await import('../../src/sync/backup.js');

function freshState(){
  S.tracks = []; S.playlists = []; S.albumOrder = {}; S.albumSort = {};
  S.albumDisplay = {}; S.trackDisplay = {}; S.albumEdge = {}; S.albumLookPref = {};
  S.profile = { name: '', username: '', art: null, artBlob: null, pictureHash: null };
  S.trackPlayCounts = {}; S.sessionCounts = {}; S.metalEligibleSessions = {};
  S.trackMetalEligiblePlays = {}; S.trackLastPlayed = {}; S.albumLastPlayed = {};
  S.rareUnlocked = {}; S.achievements = {}; S.collection = {}; S.sessions = {}; S.sessionActive = null;
  S.sealed = new Set(); S.sealedBroken = new Set();
  S.backupUpdatedAt = { playlists:0, albumOrder:0, albumSort:0, albumDisplay:0, trackDisplay:0, albumEdge:0, albumLookPref:0, prefs:0, profileName:0, picture:0 };
  S.historyClearedAt = 0; S.deviceId = null; S.deviceLabel = null; S.backupRestoredFor = null;
  S.phasePlayCounts = {}; S.albumPhaseCounts = {}; S.rhythmPushedAt = 0;
  metaStore.clear(); achievementsStore.clear(); collectionStore.clear(); sessionsStore.clear();
  artworkStore.clear(); profileRecord = null;
}

// Shaped like fetchRemoteRows()'s own `client.from(table).select(...)` rows
// -- {device_id, doc} -- not like fromDocs()'s internal doc-plus-deviceId
// shape (fetchRemoteRows() does that merge itself).
function remoteRow(deviceId, overrides){
  const doc = toDoc(Object.assign({
    deviceId, historyClearedAt: 0, tracks: [],
    playlists: [], albumOrder: {}, albumSort: {},
    albumDisplay: {}, trackDisplay: {}, albumEdge: {}, albumLookPref: {},
    prefs: {}, profileName: '', picture: null,
    trackPlayCounts: {}, sessionCounts: {}, metalEligibleSessions: {}, trackMetalEligiblePlays: {},
    trackLastPlayed: {}, albumLastPlayed: {}, rareUnlocked: {}, achievements: {}, collection: {},
    sealedIds: [], brokenSealIds: [], overlaysRaw: [], updatedAt: {},
  }, overrides));
  return { device_id: deviceId, doc };
}

// RF18 (docs/12_REFINE.md): fetchRemoteRows() now makes two selects — a
// cheap device_id+updated_at cursor pass, then a .in(...)-filtered
// device_id+doc+updated_at pass for whichever devices actually changed
// (see backup.js's own fetchRemoteRows() comment) — and pushBackup() goes
// through .rpc('put_library_backup', ...) rather than a plain upsert
// (migration 013_backup_seq.sql). remoteRows here are given the shape
// fetchRemoteRows() expects off the wire, {device_id, doc}, each with a
// synthesized updated_at so the cursor pass always reports them changed on
// a never-before-seen (fresh per test) client/cache.
// a file-level counter, not reset per call: fetchRemoteRows()'s own row
// cache (backup.js) is keyed by device_id and lives for the module's whole
// lifetime, so two different tests' own remote rows must never share an
// updated_at value, or the second test's pull would wrongly read back the
// first test's cached doc as "unchanged."
let nextTestUpdatedAt = 1;
function makePullClient(remoteRows){
  const upserts = [];
  const withCursor = remoteRows.map(r => Object.assign({ updated_at: nextTestUpdatedAt++ }, r));
  const fullFetches = [];
  return {
    upserts, withCursor, fullFetches,
    bumpUpdatedAt(deviceId){
      const row = withCursor.find(r => r.device_id === deviceId);
      row.updated_at = nextTestUpdatedAt++;
    },
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@b.test' } } }) },
    rpc(name, args){
      if(name !== 'put_library_backup') return Promise.resolve({ error: null });
      upserts.push({ device_id: args.p_device, doc: args.p_doc });
      return Promise.resolve({ error: null });
    },
    from(){
      return {
        select(cols){
          if(cols === 'device_id, updated_at'){
            return Promise.resolve({ data: withCursor.map(r => ({ device_id: r.device_id, updated_at: r.updated_at })), error: null });
          }
          return {
            in: (_col, ids) => {
              fullFetches.push([...ids]);
              return Promise.resolve({
                data: withCursor.filter(r => ids.includes(r.device_id)), error: null,
              });
            },
          };
        },
      };
    },
  };
}
function stubSocial(client){
  globalThis.MizikiSocial = { getClient(){ return client; }, on(){}, status(){ return { auth: 'signedOut' }; } };
}
async function flushMicrotasks(){
  for(let i = 0; i < 8; i++) await new Promise(r => setImmediate(r));
}

test('RF1: another device\'s newer clear zeroes and persists this device\'s counters, not just in memory', async () => {
  freshState();
  const unsub = onBackup('reset', () => resetLocalHistory());
  try{
    // this device still has pre-clear counts sitting in S (not yet synced)
    S.trackPlayCounts = { k1: 7 };
    S.sessionCounts = { albumA: 3 };
    S.achievements = { albumA: { tier: 'gold' } };
    S.historyClearedAt = 0;

    const clearedAt = Date.now();
    const remote = remoteRow('device-b', { historyClearedAt: clearedAt });
    const client = makePullClient([remote]);
    stubSocial(client);

    pullBackupOnForeground();
    await flushMicrotasks();

    // zeroed in memory
    assert.deepEqual(S.trackPlayCounts, {});
    assert.deepEqual(S.sessionCounts, {});
    assert.equal(S.historyClearedAt, clearedAt);

    // RF1's actual bug: persisted to meta too, not just in-memory --
    // a reload must read zeros back, not the pre-clear numbers
    assert.deepEqual(metaStore.get('trackPlayCounts'), {});
    assert.deepEqual(metaStore.get('sessionCounts'), {});
    assert.deepEqual(metaStore.get('metalEligibleSessions'), {});
    assert.deepEqual(metaStore.get('trackMetalEligiblePlays'), {});
    assert.equal(metaStore.get('historyClearedAt'), clearedAt);

    // and the very next push (pullAndMergeBackup's own trailing pushBackup())
    // uploads a doc with empty counters, not the pre-clear numbers
    assert.ok(client.upserts.length >= 1);
    const uploaded = client.upserts[client.upserts.length - 1].doc;
    assert.equal(uploaded.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(uploaded.counters.trackPlayCounts, {});
    assert.deepEqual(uploaded.counters.sessionCounts, {});
    assert.equal(uploaded.historyClearedAt, clearedAt);
  }finally{ unsub(); }
});

test('RF1: applyMerged never stamps its own new clear time -- it adopts the remote one exactly', async () => {
  freshState();
  const unsub = onBackup('reset', () => resetLocalHistory());
  try{
    S.historyClearedAt = 0;
    const clearedAt = 1700000000000; // a fixed, clearly-not-"now" stamp
    const remote = remoteRow('device-b', { historyClearedAt: clearedAt });
    const client = makePullClient([remote]);
    stubSocial(client);

    pullBackupOnForeground();
    await flushMicrotasks();

    assert.equal(S.historyClearedAt, clearedAt);
    assert.equal(metaStore.get('historyClearedAt'), clearedAt);
    assert.equal(getBackupStatus().lastError, null);
  }finally{ unsub(); }
});

test('RF1: a play made after the reset counts from zero, not from the pre-clear total', async () => {
  freshState();
  const unsub = onBackup('reset', () => resetLocalHistory());
  try{
    S.trackPlayCounts = { k1: 9 };
    const clearedAt = Date.now();
    const remote = remoteRow('device-b', { historyClearedAt: clearedAt });
    const client = makePullClient([remote]);
    stubSocial(client);

    pullBackupOnForeground();
    await flushMicrotasks();
    assert.deepEqual(S.trackPlayCounts, {});

    // a play after the reset starts counting from zero, not 9
    S.trackPlayCounts.k1 = (S.trackPlayCounts.k1 || 0) + 1;
    assert.equal(S.trackPlayCounts.k1, 1);
  }finally{ unsub(); }
});

/* ================= RF18 (docs/12_REFINE.md): pushes that can't go backwards =================
   The row-cache half of point 3 ("unchanged rows aren't re-downloaded").
   makePullClient()'s own cursor pass always reports every device's
   updated_at; fetchRemoteRows() (src/sync/backup.js) should only issue a
   full device_id+doc fetch for a device whose updated_at actually moved
   since the last pull it cached. */

test('RF18: a pull that finds nothing changed on the remote reuses the cached doc (no full re-fetch)', async () => {
  freshState();
  const remote = remoteRow('device-c', { historyClearedAt: 0 });
  const client = makePullClient([remote]);
  stubSocial(client);

  pullBackupOnForeground();
  await flushMicrotasks();
  assert.equal(client.fullFetches.length, 1, 'the first pull always fetches the full doc at least once');

  pullBackupOnForeground();
  await flushMicrotasks();
  assert.equal(client.fullFetches.length, 1, 'device-c did not change between pulls, so the second pull must not re-fetch its doc');
});

test('RF18: a changed updated_at on a remote device triggers a fresh full fetch on the next pull', async () => {
  freshState();
  const remote = remoteRow('device-c', { historyClearedAt: 0 });
  const client = makePullClient([remote]);
  stubSocial(client);

  pullBackupOnForeground();
  await flushMicrotasks();
  assert.equal(client.fullFetches.length, 1);

  client.bumpUpdatedAt('device-c');
  pullBackupOnForeground();
  await flushMicrotasks();
  assert.equal(client.fullFetches.length, 2, 'device-c changed, so the second pull must fetch its doc again');
});
