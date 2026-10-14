// CEREMONY PR 3 (docs/CEREMONY.md §2): the synthesised run-out groove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runoutSamples, startRunout } from '../../src/audio/runout.js';
import { S } from '../../src/state.js';

const SR = 8000;

test('runoutSamples is as long as asked', () => {
  assert.equal(runoutSamples(SR, 2.5, []).length, 20000);
  assert.equal(runoutSamples(SR, 0, []).length, 0);
});

test('the groove fades in from silence, so it never clicks', () => {
  const s = runoutSamples(SR, 1, []);
  assert.equal(Math.abs(s[0]), 0);
  const early = Math.max(...Array.from(s.slice(0, 40), Math.abs));
  const late = Math.max(...Array.from(s.slice(4000, 8000), Math.abs));
  assert.ok(early < late);
});

test('a thump is much louder than the hiss around it', () => {
  const s = runoutSamples(SR, 2, [1]);
  const peak = (a, b) => Math.max(...Array.from(s.slice(a, b), Math.abs));
  assert.ok(peak(8000, 8960) > 4 * peak(4000, 4960));
  assert.ok(peak(0, SR * 2) < 0.4);
});

test('the same seed gives the same groove, a different seed a different one', () => {
  const a = runoutSamples(SR, 0.5, [0.2], 7), b = runoutSamples(SR, 0.5, [0.2], 7), c = runoutSamples(SR, 0.5, [0.2], 9);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('startRunout is a safe no-op without an audio graph, or in Pure', () => {
  S.ctx = null;
  const g = startRunout(1);
  g.stop(100); g.stop();
  S.ctx = {}; S.nodes = {wobble:{}}; S.mode = 'pure';
  startRunout(1).stop();
  S.ctx = null; S.mode = 'vinyl';
});
