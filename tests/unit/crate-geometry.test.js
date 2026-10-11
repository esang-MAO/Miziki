import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowPose, flowZIndex } from '../../src/crate/geometry.js';

// crate/geometry.js has no imports of its own and no DOM-dependent top
// level -- shared, pure 3D-pose math used by both src/launch/intro.js and
// src/crate/view.js (CRATE spec §3: "one geometry implementation so the
// two views can never drift apart"), so this needs no mocking at all.

test('flowPose: distance 0 is dead centre, undeflected, fully opaque, at the front', () => {
  const pose = flowPose(0, 0, 0, {});
  // +0/-0 both render identically as a CSS transform -- this just confirms
  // no deflection, not which signed zero floating point happened to produce
  assert.equal(pose.y + 0, 0);
  assert.equal(pose.rotX, 0);
  assert.equal(pose.opacity, 1);
  assert.equal(pose.z + 0, 0);
});

test('flowPose: direction sign follows the sign of `d`, not its magnitude', () => {
  const above = flowPose(2, -2, 0, {});
  const below = flowPose(2, 2, 0, {});
  assert.ok(above.y < 0, 'negative d should offset upward (negative y)');
  assert.ok(below.y > 0, 'positive d should offset downward (positive y)');
  assert.equal(above.rotX, -below.rotX, 'tilt should mirror across the centre');
});

test('flowPose: opacity fades past |a|=3 and never goes negative', () => {
  assert.equal(flowPose(3, 3, 0, {}).opacity, 1);
  assert.ok(flowPose(5, 5, 0, {}).opacity < 1);
  assert.equal(flowPose(50, 50, 0, {}).opacity, 0);
});

test('flowPose: higher speed pushes farther cards out more than near ones (the speed-stretch)', () => {
  const nearSlow = flowPose(1, 1, 0, {}), nearFast = flowPose(1, 1, 1, {});
  const farSlow = flowPose(4, 4, 0, {}), farFast = flowPose(4, 4, 1, {});
  const nearGrowth = nearFast.y - nearSlow.y;
  const farGrowth = farFast.y - farSlow.y;
  assert.ok(farGrowth > nearGrowth, 'the far card should stretch out more than the near one at the same speed');
});

test('flowPose: opts.originY shifts the whole pose; opts.spread scales the offset', () => {
  const plain = flowPose(1, 1, 0, {});
  const shifted = flowPose(1, 1, 0, {originY: 170});
  assert.equal(shifted.y, plain.y + 170);
  const spreadOut = flowPose(1, 1, 0, {spread: 2});
  assert.equal(spreadOut.y, plain.y * 2);
});

test('flowZIndex: closest card (a=0) stacks highest, farther cards stack lower, floored at a=9', () => {
  assert.ok(flowZIndex(0) > flowZIndex(1));
  assert.ok(flowZIndex(1) > flowZIndex(5));
  assert.equal(flowZIndex(9), flowZIndex(20), 'z-index floors out past |a|=9');
});
