// BD5 (docs/38_BEFORE_THE_DOMAIN.md): "storage you can see" -- formatUsage()'s
// pure formatting and readUsage()'s navigator.storage.estimate() wrapper.
// usage.js's only import is util/text.js's formatBytes, a real leaf module
// (no DOM/IndexedDB dependency chain), so no mock.module is needed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { readUsage, formatUsage } = await import('../../src/storage/usage.js');

const GB = 1024 * 1024 * 1024;

test('formatUsage: builds the "Using X of about Y" sentence from byte counts', () => {
  assert.equal(
    formatUsage(3.2 * GB, 60 * GB),
    'Using 3.2 GB of about 60.0 GB Miziki can use on this device.'
  );
});

test('formatUsage: zero usage still reads as a real (not blank) amount', () => {
  assert.equal(formatUsage(0, 10 * GB), 'Using 0 MB of about 10.0 GB Miziki can use on this device.');
});

test('readUsage: returns null when navigator.storage.estimate is unsupported', async () => {
  const saved = globalThis.navigator.storage;
  delete globalThis.navigator.storage;
  try{
    assert.equal(await readUsage(), null);
  }finally{ globalThis.navigator.storage = saved; }
});

test('readUsage: returns usage/quota from a real estimate() result', async () => {
  const saved = globalThis.navigator.storage;
  globalThis.navigator.storage = { estimate: async () => ({ usage: 3 * GB, quota: 60 * GB }) };
  try{
    assert.deepEqual(await readUsage(), { usage: 3 * GB, quota: 60 * GB });
  }finally{ globalThis.navigator.storage = saved; }
});

test('readUsage: a missing/non-numeric quota reads the same as unsupported', async () => {
  const saved = globalThis.navigator.storage;
  globalThis.navigator.storage = { estimate: async () => ({ usage: 3 * GB }) };
  try{
    assert.equal(await readUsage(), null);
  }finally{ globalThis.navigator.storage = saved; }
});

test('readUsage: a thrown estimate() is swallowed, same posture as unsupported', async () => {
  const saved = globalThis.navigator.storage;
  globalThis.navigator.storage = { estimate: async () => { throw new Error('nope'); } };
  try{
    assert.equal(await readUsage(), null);
  }finally{ globalThis.navigator.storage = saved; }
});
