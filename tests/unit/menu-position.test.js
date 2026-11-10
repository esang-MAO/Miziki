// UN3 (docs/36_UNIFORMITY.md): anchoredMenuTop()'s "anchor above, flip
// below if there's no room" math, the fix for the player ⋯ menu running
// off the bottom of a 390x844 screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchoredMenuTop } from '../../src/util/menu-position.js';

test('anchors above the button when there is room', () => {
  const top = anchoredMenuTop({
    buttonTop: 700, buttonBottom: 740, menuHeight: 200,
    viewportHeight: 844, scrollY: 0, margin: 8,
  });
  assert.equal(top, 700 - 200 - 8);
});

test('flips below the button when there is no room above', () => {
  // the 390x844 bug: the button sits near the top, the menu is tall
  // enough that it would run off the bottom either way once below --
  // clamp it to stay fully on screen instead.
  const top = anchoredMenuTop({
    buttonTop: 60, buttonBottom: 96, menuHeight: 260,
    viewportHeight: 844, scrollY: 0, margin: 8,
  });
  assert.ok(top >= 96 + 8, 'does not overlap the button');
  assert.ok(top + 260 <= 844, 'the flipped menu still fits on screen');
});

test('clamps to the viewport when the menu is taller than the available space either way', () => {
  const top = anchoredMenuTop({
    buttonTop: 400, buttonBottom: 440, menuHeight: 2000,
    viewportHeight: 844, scrollY: 0, margin: 8,
  });
  assert.ok(top >= 8, 'never clamps above the top margin');
});

test('accounts for scroll position', () => {
  const top = anchoredMenuTop({
    buttonTop: 700, buttonBottom: 740, menuHeight: 200,
    viewportHeight: 844, scrollY: 500, margin: 8,
  });
  assert.equal(top, 500 + 700 - 200 - 8);
});
