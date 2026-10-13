import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../../src/sync/images.js';

/* ================= src/sync/images.js: sha256Hex =================
   The one pure, DOM-free piece of this file (see its own header comment)
   — the hash-naming scheme content-addressed uploads depend on: same
   bytes always produce the same name, different bytes never collide in
   practice, so "upload the same picture again" is a harmless same-name
   overwrite and any real change gets a new name (step 07, B4, point 3). */

test('sha256Hex: identical bytes produce the identical hash, twice', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const a = await sha256Hex(bytes.buffer.slice(0));
  const b = await sha256Hex(bytes.buffer.slice(0));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('sha256Hex: different bytes produce a different hash', async () => {
  const a = await sha256Hex(new Uint8Array([1, 2, 3]).buffer);
  const b = await sha256Hex(new Uint8Array([1, 2, 4]).buffer);
  assert.notEqual(a, b);
});

test('sha256Hex: accepts a Blob-like object via its own arrayBuffer() method', async () => {
  const raw = new Uint8Array([9, 9, 9]).buffer;
  const fakeBlob = { arrayBuffer: async () => raw };
  const fromBlob = await sha256Hex(fakeBlob);
  const fromRaw = await sha256Hex(raw);
  assert.equal(fromBlob, fromRaw);
});

test('sha256Hex: matches a known SHA-256 test vector (empty input)', async () => {
  const hash = await sha256Hex(new ArrayBuffer(0));
  assert.equal(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
