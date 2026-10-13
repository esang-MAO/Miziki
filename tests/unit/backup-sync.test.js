import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/* ================= src/sync/backup.js: the scheduler =================
   Step 06 (B3), extended in step 07 (B4). backup.js's own `meta`/
   `overlays`/`artwork`/`profile` come from storage/repo.js, which wraps
   real IndexedDB (src/storage/idb.js) — mocked here to a tiny in-memory
   stand-in so these tests don't need fake-indexeddb at all, the same
   "stop the chain at the door" reasoning as every other mock-heavy file
   in this suite. Everything else backup.js imports (state.js, storage/
   prefs.js, record-art/tiers.js, library/model.js, backup-doc.js,
   crate/tiers.js, sync/images.js) is pure/DOM-free at module top level
   and loaded for real — confirmed directly: `node --input-type=module
   -e "import('./src/sync/backup.js')"` resolves cleanly with no mocking
   at all, which is also the real reason this file doesn't need to mock
   crate/tiers.js or sync/images.js the way every DOM-reaching chain in
   this suite otherwise would. */
const metaStore = new Map(), artworkStore = new Map();
let profileRecord = null;
mock.module(new URL('../../src/storage/repo.js', import.meta.url).href, {
  namedExports: {
    meta: {
      async get(k){ return metaStore.has(k) ? metaStore.get(k) : null; },
      async put(k, v){ metaStore.set(k, v); },
    },
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
const { SCHEMA_VERSION } = await import('../../src/sync/backup-doc.js');
const {
  scheduleBackupSync, flushBackupSync, getBackupStatus, collectDownloadData, collectLocalDownloadData,
  orphanedFiles,
} = await import('../../src/sync/backup.js');

function freshState(){
  S.tracks = []; S.playlists = []; S.albumOrder = {}; S.albumSort = {};
  S.albumDisplay = {}; S.trackDisplay = {}; S.albumEdge = {}; S.albumLookPref = {};
  S.profile = { name: '', username: '', art: null, artBlob: null, pictureHash: null };
  S.trackPlayCounts = {}; S.sessionCounts = {}; S.metalEligibleSessions = {};
  S.trackMetalEligiblePlays = {}; S.trackLastPlayed = {}; S.albumLastPlayed = {};
  S.rareUnlocked = {}; S.achievements = {}; S.collection = {};
  S.sealed = new Set(); S.sealedBroken = new Set();
  S.backupUpdatedAt = { playlists:0, albumOrder:0, albumSort:0, albumDisplay:0, trackDisplay:0, albumEdge:0, albumLookPref:0, prefs:0, profileName:0, picture:0 };
  S.historyClearedAt = 0; S.deviceId = null; S.deviceLabel = null; S.backupRestoredFor = null;
  metaStore.clear(); artworkStore.clear(); profileRecord = null;
}

// a minimal fake of the one Supabase client shape backup.js's push path
// actually calls — .auth.getUser() and .from(table).upsert(doc)
function makeClient(behavior = {}){
  const calls = { upsert: 0 };
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@b.test' } } }) },
    from(){
      return {
        upsert: async () => {
          calls.upsert++;
          if(behavior.failUntilCall && calls.upsert <= behavior.failUntilCall) throw new Error('network down');
          return { error: null };
        },
      };
    },
  };
}

// backup.js reaches MizikiSocial as a real global, never imported — same
// as the rest of the social layer (see its own repo-layout entry). Each
// test installs its own stub, via getClient() alone, the one accessor
// src/sync/backup.js actually uses.
function stubSocial(client){
  globalThis.MizikiSocial = { getClient(){ return client; }, on(){}, status(){ return { auth: 'signedOut' }; } };
}

async function flushMicrotasks(){
  // real setImmediate, not the mocked setTimeout — lets every pending
  // await inside pushBackup()/runPush() actually settle before asserting
  for(let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
}

test('scheduleBackupSync: several calls within the debounce window collapse into one push', async () => {
  freshState();
  const client = makeClient();
  stubSocial(client);
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    scheduleBackupSync();
    scheduleBackupSync();
    scheduleBackupSync();
    mock.timers.tick(30000);
    await flushMicrotasks();
    assert.equal(client.calls.upsert, 1);
    assert.equal(getBackupStatus().backedUp, true);
  }finally{ mock.timers.reset(); }
});

test('scheduleBackupSync: no MizikiSocial (social config empty) is a quiet no-op', async () => {
  freshState();
  globalThis.MizikiSocial = undefined;
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    scheduleBackupSync();           // getClient() resolves null -> returns before scheduling anything
    mock.timers.tick(30000);
    await flushMicrotasks();
    // nothing thrown, and nothing was ever uploaded or persisted — the
    // one observable, test-order-independent sign that it truly no-opped
    assert.equal(metaStore.has('deviceId'), false);
  }finally{ mock.timers.reset(); }
});

test('flushBackupSync: pushes immediately, without waiting for the debounce', async () => {
  freshState();
  const client = makeClient();
  stubSocial(client);
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    scheduleBackupSync();           // would otherwise wait the full 30s
    flushBackupSync();
    await flushMicrotasks();
    assert.equal(client.calls.upsert, 1);
  }finally{ mock.timers.reset(); }
});

test('a failed push retries with backoff, like the social sync engine', async () => {
  freshState();
  const client = makeClient({ failUntilCall: 2 });   // first two upserts throw, the third succeeds
  stubSocial(client);
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    scheduleBackupSync(0);
    mock.timers.tick(0);
    await flushMicrotasks();
    assert.equal(client.calls.upsert, 1);
    // a failed push only ever reports the error — it never flips backedUp
    // back to false on its own (a transient blip shouldn't make the UI
    // look like backup turned itself off), so that field isn't checked here
    assert.ok(getBackupStatus().lastError);

    mock.timers.tick(15000);        // BACKOFF[0]
    await flushMicrotasks();
    assert.equal(client.calls.upsert, 2);
    assert.ok(getBackupStatus().lastError);

    mock.timers.tick(30000);        // BACKOFF[1]
    await flushMicrotasks();
    assert.equal(client.calls.upsert, 3);
    assert.equal(getBackupStatus().backedUp, true);
    assert.equal(getBackupStatus().lastError, null);
  }finally{ mock.timers.reset(); }
});

/* ================= Download my data (step 06, point 5) ================= */

test('Download my data: signed out, the export has only local data and no account section', async () => {
  freshState();
  globalThis.MizikiSocial = undefined;   // no social config at all -- same as a real signed-out device
  S.playlists = [{ name: 'Favorites', items: [], system: 'favorites' }];
  S.trackPlayCounts = { 'a|b|c': 3 };
  const out = await collectDownloadData();
  const text = JSON.stringify(out);
  const parsed = JSON.parse(text);          // must round-trip through JSON cleanly
  assert.equal(parsed.schemaVersion, SCHEMA_VERSION);
  assert.ok(parsed.local);
  assert.deepEqual(parsed.local.playlists, S.playlists);
  assert.deepEqual(parsed.local.trackPlayCounts, S.trackPlayCounts);
  assert.equal('account' in parsed, false);
  // no audio or images anywhere in the export, signed out or in
  assert.equal('tracks' in parsed.local, false);
  assert.equal('overlays' in parsed.local, true);   // text-only edits are fine; the check above is about bytes
});

test('Download my data: signed out with no client at all is the same local-only export, synchronously available', () => {
  freshState();
  globalThis.MizikiSocial = undefined;
  const out = collectLocalDownloadData();
  assert.equal(out.schemaVersion, SCHEMA_VERSION);
  assert.ok(out.generatedAt);
  assert.equal('account' in out, false);
});

test('deviceId is generated once and persisted, not regenerated on a later push', async () => {
  freshState();
  const client = makeClient();
  stubSocial(client);
  flushBackupSync();
  await flushMicrotasks();
  const first = S.deviceId;
  assert.ok(first);
  flushBackupSync();
  await flushMicrotasks();
  assert.equal(S.deviceId, first);
  assert.equal(await metaStore.get('deviceId'), first);
});

/* ================= orphanedFiles (step 07, B4, point 5) =================
   cleanup must never delete a hash some merged-doc entry still
   references, and must keep at most one unreferenced avatar file —
   covers keep zero, since a cover's old file is only ever orphaned once
   something newer has fully replaced it. */

test('orphanedFiles: an unreferenced file is returned for deletion (keepNewest=0, covers)', () => {
  const files = [{ name: 'u1/aaa.jpg', hash: 'aaa', updatedAt: 1 }];
  const out = orphanedFiles(files, new Set(), 0);
  assert.deepEqual(out, ['u1/aaa.jpg']);
});

test('orphanedFiles: a referenced file is never returned, even with keepNewest=0', () => {
  const files = [{ name: 'u1/aaa.jpg', hash: 'aaa', updatedAt: 1 }];
  const out = orphanedFiles(files, new Set(['aaa']), 0);
  assert.deepEqual(out, []);
});

test('orphanedFiles: keepNewest=1 spares the most recently updated unreferenced file, not the others', () => {
  const files = [
    { name: 'u1/old.jpg', hash: 'old', updatedAt: 1 },
    { name: 'u1/mid.jpg', hash: 'mid', updatedAt: 2 },
    { name: 'u1/new.jpg', hash: 'new', updatedAt: 3 },
  ];
  const out = orphanedFiles(files, new Set(), 1);
  assert.deepEqual(out.sort(), ['u1/mid.jpg', 'u1/old.jpg']);
});

test('orphanedFiles: keepNewest only considers unreferenced files, not the referenced newest one', () => {
  const files = [
    { name: 'u1/veryOld.jpg', hash: 'veryOld', updatedAt: 1 },
    { name: 'u1/old.jpg', hash: 'old', updatedAt: 2 },
    { name: 'u1/new.jpg', hash: 'new', updatedAt: 3 },
  ];
  // "new" is still referenced, so it's excluded from the unreferenced set
  // entirely (never a deletion candidate); of the two unreferenced files,
  // keepNewest=1 spares the newer one ("old") and deletes "veryOld"
  const out = orphanedFiles(files, new Set(['new']), 1);
  assert.deepEqual(out, ['u1/veryOld.jpg']);
});

test('orphanedFiles: no files and no referenced hashes is just an empty result', () => {
  assert.deepEqual(orphanedFiles([], new Set(), 0), []);
  assert.deepEqual(orphanedFiles(undefined, new Set(), 1), []);
});
