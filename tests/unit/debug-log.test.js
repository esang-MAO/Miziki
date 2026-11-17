import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDebugLog } from '../../src/util/debug-log.js';

const ENV = { buildId: 'abc1234', browser: 'TestAgent/1.0' };

test('formatDebugLog: no entries still shows the build id, browser and a zero count', () => {
  const text = formatDebugLog([], ENV);
  assert.match(text, /Build: abc1234/);
  assert.match(text, /Browser: TestAgent\/1\.0/);
  assert.match(text, /^0 entries$/m);
});

test('formatDebugLog: one entry shows its time, call site and message, singular "entry"', () => {
  const at = Date.UTC(2026, 0, 2, 3, 4, 5);
  const text = formatDebugLog([{ context: 'transport.play', err: new Error('boom'), at }], ENV);
  assert.match(text, /^1 entry$/m);
  assert.ok(text.includes('transport.play: boom'));
  assert.ok(text.includes(new Date(at).toISOString()));
});

test('formatDebugLog: a non-Error caught value and a plain string both format without throwing', () => {
  const text = formatDebugLog([
    { context: 'a', err: 'plain string', at: 0 },
    { context: 'b', err: { code: 7 }, at: 0 },
  ], ENV);
  assert.ok(text.includes('a: plain string'));
  assert.ok(text.includes('b: {"code":7}'));
});

test('formatDebugLog: a full 200-entry buffer (the ring buffer\'s own cap) formats every entry, none dropped', () => {
  const entries = Array.from({ length: 200 }, (_, i) => ({ context: 'ctx' + i, err: 'e' + i, at: i }));
  const text = formatDebugLog(entries, ENV);
  assert.match(text, /^200 entries$/m);
  assert.ok(text.includes('ctx0: e0'));
  assert.ok(text.includes('ctx199: e199'));
  assert.equal(text.split('\n').filter(l => /^\[.*\] ctx/.test(l)).length, 200);
});

test('formatDebugLog: missing env falls back to "unknown" rather than throwing', () => {
  const text = formatDebugLog([], undefined);
  assert.match(text, /Build: unknown/);
  assert.match(text, /Browser: unknown/);
});
