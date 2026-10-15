import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// engine.js has temporary circular imports back to main.js and
// transport.js (see the refactor rule in CLAUDE.md), and main.js has
// DOM-dependent top-level code, so loading it for real here would need a
// browser. Module mocking (Node 22, behind
// --experimental-test-module-mocks — see package.json) replaces the
// whole module by resolved specifier before engine.js is loaded, so
// every real module in the chain that engine.js pulls in transitively
// needs a stand-in here, not just engine.js's own two direct imports.
//
// engine.js imports stop from transport.js and, since step 6c,
// applyOutputRoute from player/background.js rather than main.js —
// mocked directly rather than letting it load for real, since its own
// real player/controls.js import would reach player/queue.js and
// history/sessions.js's full chain (the same reasoning clock.js is
// mocked for below). location.js (loaded for applyVolume), since step 7a,
// imports queueSave from storage/meta.js instead of main.js — mocked
// directly below, since meta.js's own real imports (audio/mode.js,
// player/controls.js, player/background.js, for applyPrefs()) would
// otherwise reach the same wide chains this file already stops at the
// door. drawSun from clock.js — mocking clock.js directly (rather than
// letting it load for real) avoids also needing stand-ins for everything
// *it* needs (sleep-timer.js, and several more main.js exports).
// transport.js itself still imports ~11 functions from main.js (step 3b),
// which is why it's mocked directly too, rather than listing its main.js
// dependencies here.
mock.module(new URL('../../src/storage/meta.js', import.meta.url).href, {
  namedExports: { queueSave(){} },
});
mock.module(new URL('../../src/player/background.js', import.meta.url).href, {
  namedExports: { applyOutputRoute(){} },
});
mock.module(new URL('../../src/player/transport.js', import.meta.url).href, {
  namedExports: { stop(){} },
});
mock.module(new URL('../../src/player/clock.js', import.meta.url).href, {
  namedExports: { drawSun(){} },
});

global.window = { AudioContext: function(){}, webkitAudioContext: function(){} };

const { satCurve, buildGraph, routeSource, applyCharacter } = await import('../../src/audio/engine.js');
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
  constructor(value) { this.value = value; this.lastTarget = null; }
  setTargetAtTime(target) { this.lastTarget = target; }
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

// Day Arc v2 (DAY_ARC_BRIEF.md, PR 3): applyCharacter() now sources its
// drift from arc.js's effectiveCharAt() (warmth-based, §3.4) rather than
// drift.js's old DA2 anchor table — a fixture with `noon` set exactly 12h
// before "now" gives warmthAt() == 1 (solar midnight) exactly, the
// warmest/most-drifted point of the whole curve, so Full-intensity drift
// is nonzero if it weren't gated — this is what makes the Pure test below
// meaningful rather than vacuously true (warmthAt() falls back to a
// neutral, drift-free 0.5 only when S.sun.noon itself is missing).
const now = Date.now();
S.sun = { lat: 39.20, lon: -76.86, noon: new Date(now - 12 * 3600000), ok: true };

test('applyCharacter: Pure never applies drift, even at Full intensity and solar midnight (max warmth)', () => {
  S.mode = 'pure';
  S.charDrift = 'full';
  S.char = { wow: 0.30, sat: 0.35, soft: 0.40, comp: 0.35, scratch: true };
  S.ctx = { currentTime: 0 };
  S.nodes = buildGraph(makeFakeContext());
  applyCharacter();
  // undrifted: soft 0.40 -> tone gain -9*0.40; drifted (warmth=1, Full)
  // would instead be soft 0.67 -> -6.03 (§3.4: soft +0.27 at Full), so this
  // also confirms the gate actually does something, not just that nothing
  // threw.
  assert.equal(S.nodes.tone.gain.lastTarget, -9 * 0.40);
  assert.equal(S.nodes.comp.threshold.lastTarget, -6 - 18 * 0.35);
});

test('applyCharacter: Vinyl applies the warmth-based drift at Full intensity', () => {
  S.mode = 'vinyl';
  S.charDrift = 'full';
  S.char = { wow: 0.30, sat: 0.35, soft: 0.40, comp: 0.35, scratch: true };
  S.ctx = { currentTime: 0 };
  S.nodes = buildGraph(makeFakeContext());
  applyCharacter();
  // warmth=1, Full (§3.4's own table): soft +0.27, comp +0 ("unchanged" —
  // deliberately not drifted, unlike DA2's old anchor table) — an
  // epsilon-tolerant compare, same EPS as satCurve's own above, for the
  // same float-ULP reason as before.
  assert.ok(Math.abs(S.nodes.tone.gain.lastTarget - (-9 * 0.67)) < EPS);
  assert.equal(S.nodes.comp.threshold.lastTarget, -6 - 18 * 0.35, 'bus compression never drifts (§3.4)');
});

test('applyCharacter: Vinyl with intensity off matches the user\'s own raw sliders, same as Pure', () => {
  S.mode = 'vinyl';
  S.charDrift = 'off';
  S.char = { wow: 0.30, sat: 0.35, soft: 0.40, comp: 0.35, scratch: true };
  S.ctx = { currentTime: 0 };
  S.nodes = buildGraph(makeFakeContext());
  applyCharacter();
  assert.equal(S.nodes.tone.gain.lastTarget, -9 * 0.40);
  assert.equal(S.nodes.comp.threshold.lastTarget, -6 - 18 * 0.35);
});
