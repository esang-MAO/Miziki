import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { DB } from '../../src/storage/idb.js';
import {
  storage, tracks, meta, sessions, achievements, collection, overlays, artwork, profile,
} from '../../src/storage/repo.js';

// Same isolation approach as idb.test.js: a fresh IDBFactory per test, and
// DB's own open-connection state reset so a previous test's database handle
// is never mistaken for the current one.
function freshIndexedDB(){
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  return factory;
}
function resetDB(){
  DB.db = null;
  DB.ok = false;
}
async function openFresh(){
  freshIndexedDB();
  resetDB();
  await storage.open();
}

test('storage.available() reflects DB.ok, storage.open() opens the real database', async () => {
  freshIndexedDB();
  resetDB();
  assert.equal(storage.available(), false);
  const ok = await storage.open();
  assert.equal(ok, true);
  assert.equal(storage.available(), true);
  DB.db.close();
});

test('tracks: put/get/all/del/clear round-trip', async () => {
  await openFresh();
  assert.equal(await tracks.put({ id: 't1', name: 'A' }), true);
  assert.equal(await tracks.put({ id: 't2', name: 'B' }), true);
  assert.deepEqual(await tracks.get('t1'), { id: 't1', name: 'A' });
  assert.equal((await tracks.all()).length, 2);
  assert.equal(await tracks.del('t1'), true);
  assert.equal(await tracks.get('t1'), undefined);
  assert.equal((await tracks.all()).length, 1);
  await tracks.clear();
  assert.deepEqual(await tracks.all(), []);
  DB.db.close();
});

test('meta: get returns the bare value, not the {k, v} wrapper', async () => {
  await openFresh();
  await meta.put('prefs', { mode: 'vinyl' });
  assert.deepEqual(await meta.get('prefs'), { mode: 'vinyl' });
  // confirm it really is unwrapped, by reading the same row through DB directly
  const raw = await DB.get('meta', 'prefs');
  assert.deepEqual(raw, { k: 'prefs', v: { mode: 'vinyl' } });
  DB.db.close();
});

test('meta: get returns null for a missing key, del/clear work', async () => {
  await openFresh();
  assert.equal(await meta.get('nope'), null);
  await meta.put('a', 1);
  await meta.put('b', 2);
  assert.equal(await meta.del('a'), true);
  assert.equal(await meta.get('a'), null);
  assert.equal(await meta.get('b'), 2);
  await meta.clear();
  assert.equal(await meta.get('b'), null);
  DB.db.close();
});

test('meta: thumbs() returns only thumb: rows with a Blob value, prefix stripped', async () => {
  await openFresh();
  const blob = new Blob(['x'], { type: 'image/jpeg' });
  await meta.put('thumb:album:a1', blob);
  await meta.put('thumb:track:t1', blob);
  await meta.put('prefs', { mode: 'vinyl' });        // not a thumb
  await meta.put('thumb:album:a2', 'not-a-blob');     // wrong value type
  const thumbs = await meta.thumbs();
  const keys = thumbs.map(t => t.key).sort();
  assert.deepEqual(keys, ['album:a1', 'track:t1']);
  for(const t of thumbs) assert.ok(t.blob instanceof Blob);
  DB.db.close();
});

test('sessions/achievements/collection: put/all/del/clear round-trip', async () => {
  await openFresh();
  await sessions.put({ albumId: 'a1', startedAt: 1 });
  await achievements.put({ albumId: 'a1', tier: 2 });
  await collection.put({ albumId: 'a1', tier: 1 });
  assert.equal((await sessions.all()).length, 1);
  assert.equal((await achievements.all()).length, 1);
  assert.equal((await collection.all()).length, 1);
  assert.equal(await sessions.del('a1'), true);
  assert.equal(await achievements.del('a1'), true);
  assert.equal(await collection.del('a1'), true);
  assert.deepEqual(await sessions.all(), []);
  assert.deepEqual(await achievements.all(), []);
  assert.deepEqual(await collection.all(), []);
  await sessions.put({ albumId: 'a2' });
  await sessions.clear();
  assert.deepEqual(await sessions.all(), []);
  DB.db.close();
});

test('overlays/artwork: get/put/del/clear round-trip', async () => {
  await openFresh();
  await overlays.put({ id: 'tr1', fields: { title: 'New title' } });
  assert.deepEqual(await overlays.get('tr1'), { id: 'tr1', fields: { title: 'New title' } });
  const blob = new Blob(['art'], { type: 'image/jpeg' });
  await artwork.put({ id: 'tr1', blob });
  const art = await artwork.get('tr1');
  assert.ok(art.blob instanceof Blob);
  assert.equal(await overlays.del('tr1'), true);
  assert.equal(await artwork.del('tr1'), true);
  assert.equal(await overlays.get('tr1'), undefined);
  assert.equal(await artwork.get('tr1'), undefined);
  await overlays.put({ id: 'tr2', fields: {} });
  await overlays.clear();
  assert.equal(await overlays.get('tr2'), undefined);
  DB.db.close();
});

test('profile: get/put round-trip', async () => {
  await openFresh();
  assert.equal(await profile.get('me'), undefined);
  await profile.put({ k: 'me', name: 'Ken', username: 'ken' });
  assert.deepEqual(await profile.get('me'), { k: 'me', name: 'Ken', username: 'ken' });
  DB.db.close();
});

test('storage unavailable: every method returns the same false/null/[] DB does today, nothing throws', async () => {
  const saved = globalThis.indexedDB;
  delete globalThis.indexedDB;
  resetDB();
  try {
    assert.equal(storage.available(), false);
    assert.equal(await storage.open(), false);

    assert.equal(await tracks.get('x'), null);
    assert.equal(await tracks.put({ id: 'x' }), false);
    assert.deepEqual(await tracks.all(), []);
    assert.equal(await tracks.del('x'), false);
    await tracks.clear();

    assert.equal(await meta.get('x'), null);
    assert.equal(await meta.put('x', 1), false);
    assert.equal(await meta.del('x'), false);
    await meta.clear();
    assert.deepEqual(await meta.thumbs(), []);

    assert.equal(await sessions.put({ albumId: 'a' }), false);
    assert.deepEqual(await sessions.all(), []);
    assert.equal(await sessions.del('a'), false);
    await sessions.clear();

    assert.equal(await achievements.put({ albumId: 'a' }), false);
    assert.deepEqual(await achievements.all(), []);
    assert.equal(await collection.put({ albumId: 'a' }), false);
    assert.deepEqual(await collection.all(), []);

    assert.equal(await overlays.get('x'), null);
    assert.equal(await overlays.put({ id: 'x' }), false);
    assert.equal(await artwork.get('x'), null);
    assert.equal(await artwork.put({ id: 'x' }), false);

    assert.equal(await profile.get('me'), null);
    assert.equal(await profile.put({ k: 'me' }), false);
  } finally {
    globalThis.indexedDB = saved;
  }
});
