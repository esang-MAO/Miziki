import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// engine.js has temporary circular imports back to main.js and
// transport.js (see the refactor rule in CLAUDE.md), and main.js has
// DOM-dependent top-level code, so loading it for real here would need a
// browser. Module mocking (Node 22, behind
// --experimental-test-module-mocks — see package.json) replaces both
// with no-ops before engine.js is loaded.
//
// engine.js imports applyOutputRoute from main.js directly and stop from
// transport.js; location.js (which engine.js imports applyVolume from)
// imports drawSun/queueSave from main.js too — mock.module replaces the
// whole module by resolved specifier, so every export any importer in
// this chain needs from main.js has to be covered here, not just
// engine.js's own. transport.js itself imports ~20 functions from
// main.js (step 3b), which is exactly why it's mocked directly here too,
// rather than trying to also list transport.js's main.js dependencies.
mock.module(new URL('../../src/main.js', import.meta.url).href, {
  namedExports: { applyOutputRoute(){}, drawSun(){}, queueSave(){} },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { stop(){} },
});

global.window = { AudioContext: function(){}, webkitAudioContext: function(){} };

const { satCurve, buildGraph, routeSource } = await import('../../src/audio/engine.js');
const { S } = await import('../../src/state.js');

test('satCurve(0) is an identity curve with trim 1', () => {
  const { curve, trim } = satCurve(0);
  assert.equal(trim, 1);
  assert.equal(curve[0], -1);
  assert.equal(curve[curve.length - 1], 1);
  assert.ok(Math.abs(curve[Math.floor(curve.length / 2)]) < 1e-6);
});

// The asym*x² term is an intentional asymmetry (for even-harmonic
// coloration), so the curve overshoots [-1, 1] slightly at the extremes —
// measured up to ~0.0033 at amount=0.35 and ~0.0018 at amount=1. That's a
// real property of the math, not float noise, so EPS is sized to it
// rather than to double-precision rounding.
const EPS = 0.005;
for (const amount of [0.35, 1]) {
  test(`satCurve(${amount}) stays within range (± a small, intentional overshoot), is monotonic, and trims below 1`, () => {
    const { curve, trim } = satCurve(amount);
    assert.ok(trim < 1);
    let prev = -Infinity;
    for (const v of curve) {
      assert.ok(v >= -1 - EPS && v <= 1 + EPS, `curve value ${v} out of [-1-EPS, 1+EPS]`);
      assert.ok(v >= prev, 'curve must be monotonically increasing');
      prev = v;
    }
  });
}

class FakeParam {
  constructor(value) { this.value = value; }
  setTargetAtTime() {}
}

class FakeNode {
  constructor(name) { this.name = name; this.connections = []; }
  connect(dest) { this.connections.push(dest); return dest; }
  disconnect() { this.connections = []; }
}

function makeFakeContext() {
  return {
    destination: new FakeNode('destination'),
    createDelay() { const n = new FakeNode('delay'); n.delayTime = new FakeParam(0); return n; },
    createOscillator() { const n = new FakeNode('oscillator'); n.frequency = new FakeParam(0); n.start = () => {}; return n; },
    createGain() { const n = new FakeNode('gain'); n.gain = new FakeParam(0); return n; },
    createWaveShaper() { const n = new FakeNode('waveshaper'); n.curve = null; n.oversample = ''; return n; },
    createBiquadFilter() { const n = new FakeNode('biquad'); n.type = ''; n.frequency = new FakeParam(0); n.Q = new FakeParam(0); n.gain = new FakeParam(0); return n; },
    createDynamicsCompressor() {
      const n = new FakeNode('compressor');
      n.knee = new FakeParam(0); n.attack = new FakeParam(0); n.release = new FakeParam(0);
      n.threshold = new FakeParam(0); n.ratio = new FakeParam(0);
      return n;
    },
  };
}

test('buildGraph wires wobble -> sat -> satTrim -> dc -> tone -> comp -> makeup -> master, in that order', () => {
  const ctx = makeFakeContext();
  const n = buildGraph(ctx);
  assert.ok(n.wobble.connections.includes(n.sat));
  assert.ok(n.sat.connections.includes(n.satTrim));
  assert.ok(n.satTrim.connections.includes(n.dc));
  assert.ok(n.dc.connections.includes(n.tone));
  assert.ok(n.tone.connections.includes(n.comp));
  assert.ok(n.comp.connections.includes(n.makeup));
  assert.ok(n.makeup.connections.includes(n.master));
  assert.ok(n.master.connections.includes(ctx.destination));
});

test('routeSource connects to master in Pure mode', () => {
  S.mode = 'pure';
  S.nodes = { master: new FakeNode('master'), wobble: new FakeNode('wobble') };
  const src = new FakeNode('source');
  routeSource(src);
  assert.ok(src.connections.includes(S.nodes.master));
  assert.ok(!src.connections.includes(S.nodes.wobble));
});

test('routeSource connects to wobble in Vinyl mode', () => {
  S.mode = 'vinyl';
  S.nodes = { master: new FakeNode('master'), wobble: new FakeNode('wobble') };
  const src = new FakeNode('source');
  routeSource(src);
  assert.ok(src.connections.includes(S.nodes.wobble));
  assert.ok(!src.connections.includes(S.nodes.master));
});
