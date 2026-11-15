import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// BD3 (docs/38_BEFORE_THE_DOMAIN.md): stop the chain at the door the same
// way transport-interruption.test.js does for transport.js — buffers.js's
// own direct imports (storage/repo.js, ui/path-note.js, audio/engine.js)
// all reach into IndexedDB/DOM/Web Audio, none of which exist under node:test.
mock.module(new URL('../../src/storage/repo.js', import.meta.url).href, {
  namedExports: { tracks: { async get(){ return null; } } },
});
const pathNoteCalls = [];
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(msg, warn){ pathNoteCalls.push([msg, warn]); } },
});
const ensureContextMock = mock.fn(async () => {});
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext: ensureContextMock },
});

const { S } = await import('../../src/state.js');
const { decodedBytesFor, touchLRU, ensureBuffer, DECODE_SOLO_BYTES, DECODE_MAX_BYTES } =
  await import('../../src/player/buffers.js');

test('decodedBytesFor: duration * channels * rate * 4 bytes/sample', () => {
  assert.equal(decodedBytesFor(10, 2, 48000), 10 * 2 * 48000 * 4);
});

test('decodedBytesFor: missing/invalid inputs clamp to 0, never negative or NaN', () => {
  assert.equal(decodedBytesFor(null, null, null), 0);
  assert.equal(decodedBytesFor(-5, 2, 48000), 0);
  assert.equal(decodedBytesFor(10, 0, 48000), 10 * 1 * 48000 * 4);
});

test('touchLRU: moves the touched index to the front and evicts past maxKeep, never the current track', () => {
  S.lru = [];
  S.index = 0;
  S.tracks = [{buffer: 'a'}, {buffer: 'b'}, {buffer: 'c'}, {buffer: 'd'}];
  touchLRU(1, 3);
  touchLRU(2, 3);
  touchLRU(3, 3);
  assert.deepEqual(S.lru, [3, 2, 1]);
  touchLRU(0, 3);
  // S.index === 0, so dropping 1 (the oldest beyond maxKeep=3) must not
  // touch S.tracks[0]'s buffer even though it's now the least-recent entry.
  assert.deepEqual(S.lru, [0, 3, 2]);
  assert.equal(S.tracks[1].buffer, null);
  assert.equal(S.tracks[0].buffer, 'a');
});

test('touchLRU: a lower maxKeep (the solo case) evicts down to one', () => {
  S.lru = [0, 1, 2];
  S.index = 99;
  S.tracks = [{buffer: 'a'}, {buffer: 'b'}, {buffer: 'c'}];
  touchLRU(2, 1);
  assert.deepEqual(S.lru, [2]);
  assert.equal(S.tracks[0].buffer, null);
  assert.equal(S.tracks[1].buffer, null);
  assert.equal(S.tracks[2].buffer, 'c');
});

test('ensureBuffer: a track with no blob and nothing stored reports the file unavailable', async () => {
  S.tracks = [{ id: 't1', stored: false, blob: null }];
  S.lru = [];
  S.index = 0;
  const ok = await ensureBuffer(0);
  assert.equal(ok, false);
  assert.ok(pathNoteCalls.some(([msg]) => /no longer available/.test(msg)));
});

test('ensureBuffer: an already-missing index returns false without throwing', async () => {
  S.tracks = [];
  assert.equal(await ensureBuffer(0), false);
});

test('ensureBuffer: a track whose estimated decode exceeds DECODE_MAX_BYTES is refused without decoding', async () => {
  S.ctx = { sampleRate: 48000, decodeAudioData: mock.fn(async () => { throw new Error('should not be called'); }) };
  const hugeDurationSec = DECODE_MAX_BYTES / (2 * 48000 * 4) + 60; // just over the ceiling, stereo/48kHz
  S.tracks = [{ id: 't1', stored: false, blob: { arrayBuffer: async () => new ArrayBuffer(0) },
    duration: hugeDurationSec, meta: { ch: 2 }, tags: { title: 'Long Track' } }];
  S.lru = [];
  S.index = 0;
  const ok = await ensureBuffer(0);
  assert.equal(ok, false);
  assert.equal(S.ctx.decodeAudioData.mock.calls.length, 0);
  assert.ok(pathNoteCalls.some(([msg]) => /too long to play/.test(msg)));
});

test('ensureBuffer: an already-decoded track under the solo threshold keeps the normal LRU cap', async () => {
  S.ctx = { sampleRate: 48000 };
  const buf = { length: 100, numberOfChannels: 2 };
  S.tracks = [{ id: 't1', stored: true, buffer: buf }];
  S.lru = [];
  S.index = 0;
  const ok = await ensureBuffer(0);
  assert.equal(ok, true);
  assert.equal((buf.length * buf.numberOfChannels * 4) < DECODE_SOLO_BYTES, true);
  assert.deepEqual(S.lru, [0]);
});
