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
   crate/tiers.js) is pure/DOM-free at module top level and loaded for
   real — confirmed directly: `node --input-type=module -e
   "import('./src/sync/backup.js')"` resolves cleanly with no mocking at
   all, which is also the real reason this file doesn't need to mock
   crate/tiers.js the way every DOM-reaching chain in this suite
   otherwise would.

   sync/images.js is the one exception, mocked below (RF19,
   docs/12_REFINE.md): its real sha256Hex() goes through
   crypto.subtle.digest(), which genuinely takes several real event-loop
   turns to settle (confirmed empirically — not a guess) via Node's
   threadpool, on a timeline that doesn't scale with how many fake-timer
   ticks or setImmediate rounds a test fires, making the exact number
   inherently flaky under load. The push/pull timer tests below only
   care that the same checksum round-trips through push and verify — not
   that it's genuinely SHA-256 (tests/unit/images.test.js already covers
   that) — so a fast, deterministic stand-in removes the flakiness
   without weakening what these tests actually assert. prepareCoverUpload/
   prepareAvatarUpload are never reached by anything in this file (the
   overlays/profile mocks above always resolve empty/null, so
   flushPendingImages() always short-circuits before either is called) —
   stubbed only so backup.js's own import of them resolves. */
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
// A fast, deterministic stand-in for sha256Hex — same input always
// produces the same 64-hex-char-shaped output, resolved on a plain
// microtask rather than a real threadpool round trip.
async function fakeSha256Hex(bytes){
  const str = (bytes instanceof Uint8Array) ? Array.from(bytes).join(',') : String(bytes);
  let h = 0;
  for(let i = 0; i < str.length; i++){ h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return Math.abs(h).toString(16).padStart(64, '0').slice(0, 64);
}
mock.module(new URL('../../src/sync/images.js', import.meta.url).href, {
  namedExports: {
    sha256Hex: fakeSha256Hex,
    prepareCoverUpload: async blob => ({ blob, hash: 'stub' }),
    prepareAvatarUpload: async blob => ({ blob, hash: 'stub' }),
  },
});

const { S } = await import('../../src/state.js');
const { SCHEMA_VERSION, toDoc, canonicalStringify } = await import('../../src/sync/backup-doc.js');
const { dayKeyFor } = await import('../../src/sundown/rhythm.js');
const sha256Hex = fakeSha256Hex;
const {
  scheduleBackupSync, flushBackupSync, pullBackupOnForeground, getBackupStatus, collectDownloadData, collectLocalDownloadData,
  orphanedFiles, pushOrClearListeningRhythm,
  listBackupDevices, dismissStaleDeviceNotice, removeBackupDevice, STALE_DEVICE_MS,
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
  // DA5 (docs/DAY_ARC.md); phasePlayCountsByDay windowing added RF22
  S.phasePlayCounts = {}; S.phasePlayCountsByDay = {}; S.albumPhaseCounts = {}; S.rhythmPushedAt = 0;
  metaStore.clear(); artworkStore.clear(); profileRecord = null;
}

// a minimal fake of the one Supabase client shape backup.js's push path
// actually calls — .auth.getUser() and, since RF18 (docs/12_REFINE.md,
// "pushes that can't go backwards"), .rpc('put_library_backup', ...)
// rather than a plain .from(table).upsert() — see migration
// 013_backup_seq.sql's own put_library_backup() for the server half this
// stands in for. .from(table).select(...) is also stubbed, for the pull
// path's own cursor/full-row fetches (fetchRemoteRows()) — empty by
// default, since none of these push-focused tests exercise a pull.
function makeClient(behavior = {}){
  const calls = { upsert: 0 };
  const rpcArgs = [];
  return {
    calls, rpcArgs,
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@b.test' } } }) },
    rpc(name, args){
      if(name !== 'put_library_backup') return Promise.resolve({ error: null });
      calls.upsert++;
      rpcArgs.push(args);
      if(behavior.failUntilCall && calls.upsert <= behavior.failUntilCall) return Promise.resolve({ error: new Error('network down') });
      return Promise.resolve({ error: null });
    },
    from(){
      return {
        select(){ return Promise.resolve({ data: [], error: null }); },
      };
    },
  };
}

// backup.js reaches MizikiSocial as a real global, never imported — same
// as the rest of the social layer (see its own repo-layout entry). Each
// test installs its own stub, via getClient() alone, the one accessor
// src/sync/backup.js actually uses.
function stubSocial(client, extra = {}){
  globalThis.MizikiSocial = Object.assign(
    { getClient(){ return client; }, on(){}, status(){ return { auth: 'signedOut' }; } }, extra);
}

async function flushMicrotasks(){
  // real setImmediate, not the mocked setTimeout — lets every pending
  // await inside pushBackup()/runPush() actually settle before asserting
  for(let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
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

test('Download my data: DA5 phasePlayCounts/albumPhaseCounts are included, never raw tracks/images', () => {
  freshState();
  globalThis.MizikiSocial = undefined;
  S.phasePlayCounts = { night: 5, dawn: 2 };
  S.albumPhaseCounts = { alb1: { night: 5 } };
  const out = collectLocalDownloadData();
  assert.deepEqual(out.local.phasePlayCounts, S.phasePlayCounts);
  assert.deepEqual(out.local.albumPhaseCounts, S.albumPhaseCounts);
  // round-trips cleanly through JSON, the same bar every other field here meets
  assert.deepEqual(JSON.parse(JSON.stringify(out)).local.phasePlayCounts, S.phasePlayCounts);
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

// ================= DA5 (docs/DAY_ARC.md): listening rhythm =================
function stubSocialWithRhythm(client, { shareListeningRhythm = false } = {}){
  const rhythmCalls = [];
  stubSocial(client, {
    getSettings(){ return { shareListeningRhythm }; },
    async setListeningRhythm(payload){ rhythmCalls.push(payload); return { ok: true }; },
  });
  return rhythmCalls;
}
function setPhasePlays(n){
  // one phase, n plays -- more than enough to clear RHYTHM_MIN_PLAYS (20)
  // without needing to care which phase actually wins the verdict here.
  // RF22 (docs/12_REFINE.md): pushOrClearListeningRhythm's own payload is
  // now built from the windowed S.phasePlayCountsByDay (today's bucket),
  // not the lifetime S.phasePlayCounts -- seed "today" directly.
  S.phasePlayCountsByDay = { [dayKeyFor(Date.now())]: { night: n } };
}

test('pushOrClearListeningRhythm(true): below the 20-play gate is a quiet skip, nothing pushed', async () => {
  freshState();
  const client = makeClient();
  const calls = stubSocialWithRhythm(client, { shareListeningRhythm: true });
  setPhasePlays(19);
  const r = await pushOrClearListeningRhythm(true);
  assert.equal(r.ok, true); assert.equal(r.skipped, true);
  assert.equal(calls.length, 0);
  assert.equal(S.rhythmPushedAt, 0);
});

test('pushOrClearListeningRhythm(true): at/above the gate pushes the verdict+shares, never raw plays', async () => {
  freshState();
  const client = makeClient();
  const calls = stubSocialWithRhythm(client, { shareListeningRhythm: true });
  setPhasePlays(25);
  const before = Date.now();
  const r = await pushOrClearListeningRhythm(true);
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].verdict, 'Lately, mostly after dark');
  assert.deepEqual(calls[0].shares, { night: 1, dawn: 0, morning: 0, midday: 0, afternoon: 0, golden: 0, twilight: 0 });
  assert.equal('night' in calls[0], false, 'the raw play count itself must never be part of the payload');
  assert.ok(S.rhythmPushedAt >= before, 'rhythmPushedAt should be stamped to roughly now');
  assert.equal(metaStore.get('rhythmPushedAt'), S.rhythmPushedAt, 'persisted, not just in-memory');
});

test('pushOrClearListeningRhythm(false): always clears immediately, even with nothing shared yet', async () => {
  freshState();
  const client = makeClient();
  const calls = stubSocialWithRhythm(client, { shareListeningRhythm: false });
  const r = await pushOrClearListeningRhythm(false);
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [null]);
  assert.equal(S.rhythmPushedAt, 0);
  assert.equal(metaStore.get('rhythmPushedAt'), 0);
});

test('pushOrClearListeningRhythm: no MizikiSocial at all is a quiet no-op, not a throw', async () => {
  freshState();
  globalThis.MizikiSocial = undefined;
  const r = await pushOrClearListeningRhythm(true);
  assert.equal(r.ok, false);
});

test('an ordinary backup push also shares the rhythm when the switch is on and the gate passes', async () => {
  freshState();
  const client = makeClient();
  const calls = stubSocialWithRhythm(client, { shareListeningRhythm: true });
  setPhasePlays(30);
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    flushBackupSync();
    await flushMicrotasks();
    assert.equal(client.calls.upsert, 1);
    assert.equal(calls.length, 1, 'the rhythm snapshot should ride along with the ordinary doc push');
  }finally{ mock.timers.reset(); }
});

test('an ordinary backup push does NOT re-share the rhythm within the same day', async () => {
  freshState();
  const client = makeClient();
  const calls = stubSocialWithRhythm(client, { shareListeningRhythm: true });
  setPhasePlays(30);
  S.rhythmPushedAt = Date.now();   // "already pushed a moment ago"
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    flushBackupSync();
    await flushMicrotasks();
    assert.equal(client.calls.upsert, 1, 'the ordinary doc push still happens');
    assert.equal(calls.length, 0, 'but the rhythm snapshot is not re-pushed inside the same 24h window');
  }finally{ mock.timers.reset(); }
});

test('an ordinary backup push never shares the rhythm when the switch is off', async () => {
  freshState();
  const client = makeClient();
  const calls = stubSocialWithRhythm(client, { shareListeningRhythm: false });
  setPhasePlays(30);
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    flushBackupSync();
    await flushMicrotasks();
    assert.equal(client.calls.upsert, 1);
    assert.equal(calls.length, 0);
  }finally{ mock.timers.reset(); }
});

test('an ordinary backup push still succeeds against a MizikiSocial build with no getSettings/setListeningRhythm at all', async () => {
  // the exact shape every other test in this file's own stubSocial() already
  // uses -- confirming the DA5 hook degrades to a quiet no-op rather than
  // ever failing an otherwise-successful push, the real bug this test guards
  freshState();
  const client = makeClient();
  stubSocial(client);
  setPhasePlays(30);
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    flushBackupSync();
    await flushMicrotasks();
    assert.equal(client.calls.upsert, 1);
    assert.equal(getBackupStatus().backedUp, true, 'the push as a whole must still be reported successful');
  }finally{ mock.timers.reset(); }
});

/* ================= RF18 (docs/12_REFINE.md): pushes that can't go backwards ================= */

test('RF18: every push attempt carries a strictly higher doc_seq than the one before, surviving a reload', async () => {
  freshState();
  const client = makeClient();
  stubSocial(client);
  flushBackupSync();
  await flushMicrotasks();
  flushBackupSync();
  await flushMicrotasks();
  flushBackupSync();
  await flushMicrotasks();
  assert.equal(client.rpcArgs.length, 3);
  const seqs = client.rpcArgs.map(a => a.p_seq);
  assert.ok(seqs[1] > seqs[0] && seqs[2] > seqs[1], 'each push must carry a strictly higher p_seq than the last');
  // persisted immediately (not debounced with the rest of the doc), so a
  // reload picks up where this device's own counter left off rather than
  // reusing a seq a prior install already sent
  assert.equal(metaStore.get('backupPushSeq'), seqs[2]);
});

test('RF18: a failed push attempt still bumped the counter, so its retry never reuses that seq', async () => {
  freshState();
  const client = makeClient({ failUntilCall: 1 });   // the first attempt fails, the retry succeeds
  stubSocial(client);
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    scheduleBackupSync(0);
    mock.timers.tick(0);
    await flushMicrotasks();
    mock.timers.tick(15000);   // BACKOFF[0]
    await flushMicrotasks();
    assert.equal(client.rpcArgs.length, 2);
    assert.ok(client.rpcArgs[1].p_seq > client.rpcArgs[0].p_seq, 'the retry must carry a higher seq than the failed first attempt, not reuse it');
  }finally{ mock.timers.reset(); }
});

test('RF18: a pull and a push share one sync lock -- their network calls never overlap', async () => {
  freshState();
  let active = 0, maxActive = 0;
  function mark(ms){
    active++; maxActive = Math.max(maxActive, active);
    return new Promise(resolve => setTimeout(() => { active--; resolve(); }, ms));
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@b.test' } } }) },
    async rpc(name){
      if(name !== 'put_library_backup') return { error: null };
      await mark(20);
      return { error: null };
    },
    from(){
      return { async select(){ await mark(20); return { data: [], error: null }; } };
    },
  };
  stubSocial(client);
  // a pull (which ends with its own trailing push) and a separately
  // requested push, fired back to back -- without the shared B.syncing
  // gate RF18 adds, the pull's own trailing push could race the
  // independently-requested one for the exact same row.
  pullBackupOnForeground();
  flushBackupSync();
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(maxActive, 1, 'the pull and the push must never have an in-flight network call at the same time');
});

/* ================= RF19 (docs/12_REFINE.md): verify, and keep a way back ================= */

// A richer client for pull tests: the cheap cursor select() (no .in())
// returns a plain awaited promise, same as makeClient() above; the full-row
// select (selected columns include 'checksum') is chained with .in(),
// matching fetchRemoteRows()'s own two-shaped call exactly.
function makePullClient({ cursorRows = [], fullRows = [] } = {}){
  const calls = { upsert: 0 };
  const rpcArgs = [];
  return {
    calls, rpcArgs,
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@b.test' } } }) },
    rpc(name, args){
      if(name !== 'put_library_backup') return Promise.resolve({ error: null });
      calls.upsert++; rpcArgs.push(args);
      return Promise.resolve({ error: null });
    },
    from(){
      return {
        select(cols){
          if(cols.indexOf('checksum') >= 0) return { in(){ return Promise.resolve({ data: fullRows, error: null }); } };
          return Promise.resolve({ data: cursorRows, error: null });
        },
      };
    },
  };
}

test('RF19: push sends a checksum matching the canonical doc it just uploaded', async () => {
  freshState();
  const client = makeClient();
  stubSocial(client);
  mock.timers.enable({ apis: ['setTimeout'] });
  try{
    flushBackupSync();
    await flushMicrotasks();
    const args = client.rpcArgs[0];
    assert.equal(typeof args.p_checksum, 'string');
    assert.match(args.p_checksum, /^[0-9a-f]{64}$/);
    const expected = await sha256Hex(new TextEncoder().encode(canonicalStringify(args.p_doc)));
    assert.equal(args.p_checksum, expected);
  }finally{ mock.timers.reset(); }
});

test('RF19: a pull accepts a remote row whose checksum matches', async () => {
  freshState();
  const remoteDoc = toDoc({
    deviceId: 'device-b', historyClearedAt: 0, tracks: [],
    playlists: [], albumOrder: {}, albumSort: {},
    albumDisplay: {}, trackDisplay: {}, albumEdge: {}, albumLookPref: {},
    prefs: {}, profileName: '', picture: null,
    trackPlayCounts: { k1: 5 }, sessionCounts: {}, metalEligibleSessions: {}, trackMetalEligiblePlays: {},
    trackLastPlayed: {}, albumLastPlayed: {}, rareUnlocked: {}, achievements: {}, collection: {},
    sealedIds: [], brokenSealIds: [], overlaysRaw: [], updatedAt: {}, playlistMembershipAt: {},
  });
  const checksum = await sha256Hex(new TextEncoder().encode(canonicalStringify(remoteDoc)));
  const client = makePullClient({
    cursorRows: [{ device_id: 'device-b', updated_at: 't1' }],
    fullRows: [{ device_id: 'device-b', doc: remoteDoc, updated_at: 't1', checksum }],
  });
  stubSocial(client);
  pullBackupOnForeground();
  await flushMicrotasks();
  assert.equal(S.mergedStats.trackPlayCounts.k1, 5);
  assert.equal(getBackupStatus().lastError, null);
});

test('RF19: a pull drops a remote row whose checksum does not match its own doc, and reports it', async () => {
  freshState();
  const remoteDoc = toDoc({
    deviceId: 'device-mismatch', historyClearedAt: 0, tracks: [],
    playlists: [], albumOrder: {}, albumSort: {},
    albumDisplay: {}, trackDisplay: {}, albumEdge: {}, albumLookPref: {},
    prefs: {}, profileName: '', picture: null,
    trackPlayCounts: { k1: 5 }, sessionCounts: {}, metalEligibleSessions: {}, trackMetalEligiblePlays: {},
    trackLastPlayed: {}, albumLastPlayed: {}, rareUnlocked: {}, achievements: {}, collection: {},
    sealedIds: [], brokenSealIds: [], overlaysRaw: [], updatedAt: {}, playlistMembershipAt: {},
  });
  const client = makePullClient({
    cursorRows: [{ device_id: 'device-mismatch', updated_at: 't2' }],
    fullRows: [{ device_id: 'device-mismatch', doc: remoteDoc, updated_at: 't2', checksum: 'not-the-real-checksum' }],
  });
  stubSocial(client);
  pullBackupOnForeground();
  await flushMicrotasks();
  // device-mismatch's own contribution never reached the merge at all
  assert.equal(S.mergedStats.trackPlayCounts.k1 || 0, 0);
  const err = getBackupStatus().lastError;
  assert.ok(err, 'a checksum mismatch must be reported via lastError');
  assert.equal(err.deviceId, 'device-mismatch');
});

test('RF19: a pull accepts a pre-RF19 remote row with no checksum at all (backward compatible)', async () => {
  freshState();
  const remoteDoc = toDoc({
    deviceId: 'device-nochecksum', historyClearedAt: 0, tracks: [],
    playlists: [], albumOrder: {}, albumSort: {},
    albumDisplay: {}, trackDisplay: {}, albumEdge: {}, albumLookPref: {},
    prefs: {}, profileName: '', picture: null,
    trackPlayCounts: { k1: 7 }, sessionCounts: {}, metalEligibleSessions: {}, trackMetalEligiblePlays: {},
    trackLastPlayed: {}, albumLastPlayed: {}, rareUnlocked: {}, achievements: {}, collection: {},
    sealedIds: [], brokenSealIds: [], overlaysRaw: [], updatedAt: {}, playlistMembershipAt: {},
  });
  const client = makePullClient({
    cursorRows: [{ device_id: 'device-nochecksum', updated_at: 't3' }],
    fullRows: [{ device_id: 'device-nochecksum', doc: remoteDoc, updated_at: 't3', checksum: null }],
  });
  stubSocial(client);
  pullBackupOnForeground();
  await flushMicrotasks();
  assert.equal(S.mergedStats.trackPlayCounts.k1, 7);
  assert.equal(getBackupStatus().lastError, null);
});

/* ================= RF25 (docs/12_REFINE.md): stale backup devices ================= */
// listBackupDevices/dismissStaleDeviceNotice/removeBackupDevice all just
// read/write the one library_backup table through a plain select/update/
// delete -- no RPC, so a tiny fake .from(table) chain is all these need.
function makeDevicesClient(rows, { failDelete = false, failUpdate = false } = {}){
  const updates = [], deletes = [];
  return {
    updates, deletes,
    from(table){
      assert.equal(table, 'library_backup');
      return {
        select(){ return Promise.resolve({ data: rows, error: null }); },
        update(patch){
          return { eq(col, val){
            updates.push({ patch, col, val });
            return Promise.resolve({ error: failUpdate ? new Error('nope') : null });
          } };
        },
        delete(){
          return { eq(col, val){
            deletes.push({ col, val });
            return Promise.resolve({ error: failDelete ? new Error('nope') : null });
          } };
        },
      };
    },
  };
}

test('listBackupDevices: no client at all returns an empty list, not a throw', async () => {
  freshState();
  globalThis.MizikiSocial = undefined;
  assert.deepEqual(await listBackupDevices(), []);
});

test('listBackupDevices: marks a device stale only once it has aged past STALE_DEVICE_MS, never the current device', async () => {
  freshState();
  S.deviceId = 'this-device';
  const now = Date.now();
  const staleAt = new Date(now - STALE_DEVICE_MS - 1000).toISOString();
  const freshAt = new Date(now - 1000).toISOString();
  const client = makeDevicesClient([
    { device_id: 'this-device', device_label: 'This iPhone', updated_at: staleAt, stale_notice_dismissed_at: null },
    { device_id: 'old-ipad', device_label: 'Old iPad', updated_at: staleAt, stale_notice_dismissed_at: null },
    { device_id: 'recent-mac', device_label: 'MacBook', updated_at: freshAt, stale_notice_dismissed_at: null },
  ]);
  stubSocial(client);
  const list = await listBackupDevices();
  const byId = Object.fromEntries(list.map(d => [d.deviceId, d]));
  // the current device is never flagged stale even though its own
  // updated_at is just as old -- it can't be, since fetching this list
  // only ever runs on a device that's currently online and syncing
  assert.equal(byId['this-device'].isThisDevice, true);
  assert.equal(byId['this-device'].isStale, false);
  assert.equal(byId['old-ipad'].isStale, true);
  assert.equal(byId['recent-mac'].isStale, false);
});

test('listBackupDevices: a device the user already dismissed never shows as stale again', async () => {
  freshState();
  S.deviceId = 'this-device';
  const now = Date.now();
  const staleAt = new Date(now - STALE_DEVICE_MS - 1000).toISOString();
  const client = makeDevicesClient([
    { device_id: 'this-device', device_label: 'This iPhone', updated_at: staleAt, stale_notice_dismissed_at: null },
    { device_id: 'kept-ipad', device_label: 'Kept iPad', updated_at: staleAt, stale_notice_dismissed_at: new Date(now - 500).toISOString() },
  ]);
  stubSocial(client);
  const list = await listBackupDevices();
  const kept = list.find(d => d.deviceId === 'kept-ipad');
  assert.equal(kept.isStale, false);
});

test('dismissStaleDeviceNotice: writes stale_notice_dismissed_at for exactly the given device', async () => {
  freshState();
  const client = makeDevicesClient([]);
  stubSocial(client);
  const ok = await dismissStaleDeviceNotice('old-ipad');
  assert.equal(ok, true);
  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].col, 'device_id');
  assert.equal(client.updates[0].val, 'old-ipad');
  assert.ok(client.updates[0].patch.stale_notice_dismissed_at);
});

test('dismissStaleDeviceNotice: no client returns false, never throws', async () => {
  freshState();
  globalThis.MizikiSocial = undefined;
  assert.equal(await dismissStaleDeviceNotice('old-ipad'), false);
});

test('dismissStaleDeviceNotice: a failed update reports false', async () => {
  freshState();
  const client = makeDevicesClient([], { failUpdate: true });
  stubSocial(client);
  assert.equal(await dismissStaleDeviceNotice('old-ipad'), false);
});

test('removeBackupDevice: deletes exactly the given device row', async () => {
  freshState();
  const client = makeDevicesClient([]);
  stubSocial(client);
  const ok = await removeBackupDevice('old-ipad');
  assert.equal(ok, true);
  assert.equal(client.deletes.length, 1);
  assert.equal(client.deletes[0].col, 'device_id');
  assert.equal(client.deletes[0].val, 'old-ipad');
});

test('removeBackupDevice: no client returns false, never throws', async () => {
  freshState();
  globalThis.MizikiSocial = undefined;
  assert.equal(await removeBackupDevice('old-ipad'), false);
});

test('removeBackupDevice: a failed delete reports false', async () => {
  freshState();
  const client = makeDevicesClient([], { failDelete: true });
  stubSocial(client);
  assert.equal(await removeBackupDevice('old-ipad'), false);
});

/* ================= RF25 point 4: Download my data covers the new columns ================= */
function makeAccountClient({ nowSpinningRows = [], releaseCreditRows = [] } = {}){
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@b.test' } } }) },
    from(table){
      if(table === 'now_spinning'){
        return { select(){ return { eq(){ return Promise.resolve({ data: nowSpinningRows, error: null }); } }; } };
      }
      if(table === 'release_credits'){
        return { select(){ return { eq(){ return Promise.resolve({ data: releaseCreditRows, error: null }); } }; } };
      }
      // library_backup's own device-list select, inside the same Promise.all
      return { select(){ return Promise.resolve({ data: [], error: null }); } };
    },
  };
}
function stubFullSocial(client, overrides = {}){
  globalThis.MizikiSocial = Object.assign({
    getClient(){ return client; }, on(){}, status(){ return { auth: 'ready' }; },
    async getMyProfile(){ return { ok: true, profile: { handle: 'ken', listening_rhythm: { verdict: 'night', shares: { night: 1 } } } }; },
    async crate(){ return { ok: true, items: [] }; },
    async listFollowing(){ return { ok: true, following: [] }; },
    async listDigging(){ return { ok: true, items: [] }; },
  }, overrides);
}

test('collectDownloadData: signed in, account section carries now_spinning.phase and release_credits', async () => {
  freshState();
  const client = makeAccountClient({
    nowSpinningRows: [{ track_title: 'A Song', phase: 'goldenHour', started_at: 't1', expires_at: 't2' }],
    releaseCreditRows: [{ release_id: 'r1', person_name_norm: 'jane doe', role: 'producer' }],
  });
  stubFullSocial(client);
  const out = await collectDownloadData();
  assert.ok(out.account);
  assert.equal(out.account.nowSpinning.phase, 'goldenHour');
  assert.deepEqual(out.account.releaseCredits, [{ release_id: 'r1', person_name_norm: 'jane doe', role: 'producer' }]);
  // listening_rhythm already rides along inside the profile object (getMyProfile() is select('*'))
  assert.deepEqual(out.account.profile.listening_rhythm, { verdict: 'night', shares: { night: 1 } });
  // round-trips cleanly through JSON like the rest of this export
  const parsed = JSON.parse(JSON.stringify(out));
  assert.equal(parsed.account.nowSpinning.phase, 'goldenHour');
});

test('collectDownloadData: signed in with nothing currently spinning gives nowSpinning: null, not a throw', async () => {
  freshState();
  const client = makeAccountClient({ nowSpinningRows: [], releaseCreditRows: [] });
  stubFullSocial(client);
  const out = await collectDownloadData();
  assert.equal(out.account.nowSpinning, null);
  assert.deepEqual(out.account.releaseCredits, []);
});
