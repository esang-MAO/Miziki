import { test } from 'node:test';
import assert from 'node:assert/strict';

// src/ui/slipmat.js only reaches the DOM inside functions; the pure crop and
// file-type helpers are tested here (CEREMONY §6).
const { slipmatCrop, isSlipmatFile, SLIPMAT_MAX_ZOOM } = await import('../../src/ui/slipmat.js');

test('slipmatCrop: zoom 1 is the largest centred square that fits', () => {
  assert.deepEqual(slipmatCrop(2000, 1000, 1, 1000, 500), { sx: 500, sy: 0, side: 1000, cx: 1000, cy: 500 });
});

test('slipmatCrop: zooming in shrinks the square around the same centre', () => {
  const c = slipmatCrop(1000, 1000, 2, 500, 500);
  assert.equal(c.side, 500);
  assert.equal(c.sx, 250);
  assert.equal(c.sy, 250);
});

test('slipmatCrop: a centre dragged past the edge is clamped so the square stays inside the image', () => {
  const c = slipmatCrop(2000, 1000, 1, -500, 9999);
  assert.equal(c.sx, 0);
  assert.equal(c.sy, 0);
  const d = slipmatCrop(2000, 1000, 2, 5000, -50);
  assert.equal(d.sx + d.side, 2000);
  assert.equal(d.sy, 0);
});

test('slipmatCrop: zoom is limited to 1..SLIPMAT_MAX_ZOOM and a bad centre falls back to the middle', () => {
  assert.equal(slipmatCrop(800, 800, 0.2, 400, 400).side, 800);
  assert.equal(slipmatCrop(800, 800, 99, 400, 400).side, 800 / SLIPMAT_MAX_ZOOM);
  const c = slipmatCrop(800, 400, 1, NaN, undefined);
  assert.equal(c.cx, 400);
  assert.equal(c.cy, 200);
});

test('isSlipmatFile: accepts PNG, JPG, WebP and SVG, by type or by name when the type is empty', () => {
  for(const type of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']) assert.ok(isSlipmatFile({ type, name: 'x' }));
  assert.ok(isSlipmatFile({ type: '', name: 'logo.SVG' }));
  assert.ok(isSlipmatFile({ type: '', name: 'photo.jpeg' }));
  assert.equal(isSlipmatFile({ type: 'image/gif', name: 'a.gif' }), false);
  assert.equal(isSlipmatFile({ type: 'text/html', name: 'a.png' }), false);
  assert.equal(isSlipmatFile({ type: '', name: 'notes.txt' }), false);
  assert.equal(isSlipmatFile(null), false);
});
