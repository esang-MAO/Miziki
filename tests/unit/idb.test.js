import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';

// This file protects the most important rule in CLAUDE.md: an IndexedDB
// upgrade must never lose data. Each test gets its own fresh IDBFactory
// instance, assigned to the bare `indexedDB` global idb.js reads, so tests
// can't see each other's databases.
function freshIndexedDB(){
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  return factory;
}

// DB is a singleton module export, reused across tests — reset its own
// open-connection state so a previous test's database handle is never
// mistaken for the current one.
function resetDB(){
  DB.db = null;
  DB.ok = false;
}

function openAtVersion(factory, name, version, upgrade){
  return new Promise((resolve, reject) => {
    const r = factory.open(name, version);
    r.onupgradeneeded = () => upgrade(r.result);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function reqProm(r){
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

const ALL_STORES = ['achievements', 'artwork', 'collection', 'meta', 'overlays', 'profile', 'sessions', 'tracks'];
const KEY_PATHS = { tracks:'id', meta:'k', sessions:'albumId', overlays:'id', artwork:'id', profile:'k', achievements:'albumId', collection:'albumId' };

test('fresh install: DB.open() creates database "miziki" at version 4 with all eight stores and key paths', async () => {
  freshIndexedDB();
  resetDB();
  const ok = await DB.open();
  assert.equal(ok, true);
  assert.equal(DB.ok, true);
  assert.equal(DB.db.version, 4);
  assert.deepEqual(Array.from(DB.db.objectStoreNames).sort(), ALL_STORES.slice().sort());
  for (const [name, keyPath] of Object.entries(KEY_PATHS)){
    const store = DB.db.transaction(name, 'readonly').objectStore(name);
    assert.equal(store.keyPath, keyPath, `${name} should have key path "${keyPath}"`);
  }
  DB.db.close();
});

test('upgrade from an older version keeps every existing record and adds only the missing stores', async () => {
  const factory = freshIndexedDB();
  resetDB();

  // seed a v3-shaped database — only tracks/meta/sessions existed back then — with real data in each
  const oldDb = await openAtVersion(factory, 'miziki', 3, (d) => {
    d.createObjectStore('tracks', { keyPath: 'id' });
    d.createObjectStore('meta', { keyPath: 'k' });
    d.createObjectStore('sessions', { keyPath: 'albumId' });
  });
  await reqProm(oldDb.transaction('tracks', 'readwrite').objectStore('tracks').put({ id: 't1', name: 'Song One' }));
  await reqProm(oldDb.transaction('meta', 'readwrite').objectStore('meta').put({ k: 'prefs', v: { mode: 'vinyl' } }));
  await reqProm(oldDb.transaction('sessions', 'readwrite').objectStore('sessions').put({ albumId: 'a1', count: 3 }));
  oldDb.close();

  const ok = await DB.open();
  assert.equal(ok, true);
  assert.equal(DB.db.version, 4);
  assert.deepEqual(Array.from(DB.db.objectStoreNames).sort(), ALL_STORES.slice().sort());

  // the records from before the upgrade are still exactly there
  assert.deepEqual(await DB.get('tracks', 't1'), { id: 't1', name: 'Song One' });
  assert.deepEqual(await DB.get('meta', 'prefs'), { k: 'prefs', v: { mode: 'vinyl' } });
  assert.deepEqual(await DB.get('sessions', 'a1'), { albumId: 'a1', count: 3 });

  // the newly-added stores exist and are usable (empty, not missing)
  assert.deepEqual(await DB.all('overlays'), []);
  assert.deepEqual(await DB.all('artwork'), []);
  assert.deepEqual(await DB.all('profile'), []);
  assert.deepEqual(await DB.all('achievements'), []);
  assert.deepEqual(await DB.all('collection'), []);

  DB.db.close();
});

test('storage unavailable: indexedDB undefined makes every call a safe no-op, nothing throws', async () => {
  const saved = globalThis.indexedDB;
  delete globalThis.indexedDB;
  resetDB();
  try {
    assert.equal(typeof indexedDB, 'undefined');
    assert.equal(await DB.open(), false);
    assert.equal(DB.ok, false);
    assert.equal(await DB.put('tracks', { id: 'x' }), false);
    assert.equal(await DB.get('tracks', 'x'), null);
    assert.deepEqual(await DB.all('tracks'), []);
    assert.equal(await DB.del('tracks', 'x'), false);
    await DB.clear('tracks'); // resolves with no value; must not throw
  } finally {
    globalThis.indexedDB = saved;
  }
});

// RF5 (docs/12_REFINE.md, point 3): DB.blocked distinguishes "another tab
// already has this database open at an older version" (onblocked) from
// every other reason open() can fail -- it's the one case storage genuinely
// isn't unavailable, just unreachable from this tab for now.
test('DB.blocked is true when another connection blocks this open() (onblocked)', async () => {
  const factory = freshIndexedDB();
  resetDB();
  // simulate a second tab: an older-version connection left open
  const staleConn = await openAtVersion(factory, 'miziki', 3, (d) => {
    d.createObjectStore('tracks', { keyPath: 'id' });
  });
  const ok = await DB.open();
  assert.equal(ok, false);
  assert.equal(DB.ok, false);
  assert.equal(DB.blocked, true);
  staleConn.close();
});

test('DB.blocked resets to false on the next, unblocked open()', async () => {
  const factory = freshIndexedDB();
  resetDB();
  const staleConn = await openAtVersion(factory, 'miziki', 3, (d) => {
    d.createObjectStore('tracks', { keyPath: 'id' });
  });
  assert.equal(await DB.open(), false);
  assert.equal(DB.blocked, true);
  staleConn.close();
  assert.equal(await DB.open(), true);
  assert.equal(DB.blocked, false);
  DB.db.close();
});

// RF5, point 3: onversionchange -- another tab upgrading the database while
// this tab still holds an open connection to the old version. Closing this
// connection (rather than leaving it open) is what lets that other tab's
// own open() actually proceed instead of hanging on its own onblocked.
test('DB.open() installs an onversionchange handler that closes the connection, flags staleVersion, and notifies', async () => {
  const factory = freshIndexedDB();
  resetDB();
  assert.equal(await DB.open(), true);
  assert.equal(DB.ok, true);

  let notifiedKind = null;
  const unsubscribe = DB.onNotice(kind => { notifiedKind = kind; });

  // "another tab" starts an upgrade -- this fires this connection's own
  // onversionchange per the IndexedDB spec, since both opens share one
  // underlying database (same factory, same name).
  const newDb = await new Promise((resolve, reject) => {
    const r = factory.open('miziki', 5);
    r.onupgradeneeded = () => {};
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('unexpected onblocked -- the old connection should have closed itself'));
  });

  assert.equal(DB.ok, false, 'this connection must stop being usable once another tab is upgrading past it');
  assert.equal(DB.staleVersion, true);
  assert.equal(notifiedKind, 'staleVersion');

  // every DB.* method already treats ok:false as a safe no-op -- confirms
  // nothing here can fork data by writing against the stale connection
  assert.equal(await DB.put('tracks', { id: 'x' }), false);

  unsubscribe();
  newDb.close();
});

test('put/get/all/del/clear round-trip, including storing and reading back a Blob', async () => {
  freshIndexedDB();
  resetDB();
  await DB.open();

  await DB.put('tracks', { id: 't1', name: 'A' });
  await DB.put('tracks', { id: 't2', name: 'B' });
  assert.deepEqual(await DB.get('tracks', 't1'), { id: 't1', name: 'A' });
  assert.equal((await DB.all('tracks')).length, 2);

  const blob = new Blob(['hello'], { type: 'text/plain' });
  await DB.put('artwork', { id: 'art1', blob });
  const got = await DB.get('artwork', 'art1');
  assert.ok(got.blob instanceof Blob);
  assert.equal(await got.blob.text(), 'hello');

  assert.equal(await DB.del('tracks', 't1'), true);
  assert.equal(await DB.get('tracks', 't1'), undefined); // a real miss on an open store resolves undefined, not DB's own synthetic null
  assert.equal((await DB.all('tracks')).length, 1);

  await DB.clear('tracks');
  assert.deepEqual(await DB.all('tracks'), []);

  DB.db.close();
});
