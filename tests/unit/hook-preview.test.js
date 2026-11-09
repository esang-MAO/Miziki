import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// LI2 (docs/35_LEAD_IN.md): hook-preview.js imports audio/engine.js (for
// ensureContext) and player/buffers.js (for ensureBuffer), and engine.js's
// own real import chain pulls in things node:test can't load directly
// (e.g. a .svg asset) -- mocked the same way tests/unit/queue.test.js
// mocks them, since this test only needs the pure window-math export.
mock.module(new URL('../../src/audio/engine.js', import.meta.url).href, {
  namedExports: { ensureContext: async () => {} },
});
mock.module(new URL('../../src/ui/path-note.js', import.meta.url).href, {
  namedExports: { setPathNote(){} },
});

const { computeHookPreviewWindow } = await import('../../src/audio/hook-preview.js');

test('computeHookPreviewWindow: hook near the start clamps the lead-in to 0', () => {
  // hookStart at 2s, lead-in is 5s -- can't go negative.
  const { playStart, hookEnd, span } = computeHookPreviewWindow(2, null, 180);
  assert.equal(playStart, 0);
  assert.equal(hookEnd, 22); // default 20s span from hookStart
  assert.equal(span, 22);
});

test('computeHookPreviewWindow: ordinary hook starts 5s before it', () => {
  const { playStart, hookEnd, span } = computeHookPreviewWindow(60, 75, 180);
  assert.equal(playStart, 55);
  assert.equal(hookEnd, 75);
  assert.equal(span, 20); // grows by the 5s lead-in, not eaten from the hook
});

test('computeHookPreviewWindow: hook near the end clamps hookEnd to the duration', () => {
  const { playStart, hookEnd, span } = computeHookPreviewWindow(178, null, 180);
  assert.equal(playStart, 173);
  assert.equal(hookEnd, 180);
  assert.equal(span, 7);
});

test('computeHookPreviewWindow: no stored hook falls back to the track start', () => {
  const { playStart, hookEnd, span } = computeHookPreviewWindow(null, null, 180);
  assert.equal(playStart, 0);
  assert.equal(hookEnd, 20);
  assert.equal(span, 20);
});
