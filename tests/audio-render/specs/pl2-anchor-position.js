// PL2 (docs/19_PLAYER.md, "one clock, the root fix"): offline-render proof
// that player/clock.js's real currentPos() -- re-anchored whenever S.rate
// changes, the exact replacement for the old `S.pos += dt * S.rate`
// accumulation -- tracks a continuously ramping Sundown rate within the
// doc's own 5ms tolerance ("a 3-minute track with Sundown rate ramping
// 1.0 -> 0.8; reported position at the end within 5 ms of the true sample
// position").
//
// Scaled down to a 10s render (OfflineAudioContext is sample-accurate
// regardless of real-world duration, so this proves the same property the
// doc's own 3-minute framing does, just faster to run) with a continuous,
// analytic rate(t) = 1 - 0.2*(t/T) -- linear, not setTargetAtTime's own
// exponential smoothing, so there is one unambiguous ground truth for
// "where the audio really is" at any output instant: a single-sample
// click embedded at a known position in the source buffer, found by its
// real sample index in the rendered output.
//
// The software side replays the real currentPos() (imported directly from
// src/player/clock.js, not the whole tick() -- that pulls in played.js's
// history/backup side effects this spec has no reason to exercise) through
// a fine-grained loop that re-anchors exactly the way tick()'s own
// `if(Math.abs(r - S.rate) > 0.0001)` branch does, fed the *same* analytic
// rate(t) that drove the real automation curve -- proving the JS-side
// anchor bookkeeping agrees with what the audio hardware actually played,
// not just with itself.
import { S } from '../../../src/state.js';
import { currentPos } from '../../../src/player/clock.js';

const SAMPLE_RATE = 44100;
const DURATION_SEC = 10;
const CLICK_AT_SOURCE_SEC = 4.0; // where the click sits in the source buffer
const RATE_CURVE_STEPS = 400;    // automation curve resolution
const TICK_SEC = 0.02;           // finer than Sundown's own ~220ms cadence

function rateAt(t, T){ return 1 - 0.2 * (t / T); } // 1.0 -> 0.8 linearly over [0, T]

async function renderClick(){
  const ctx = new OfflineAudioContext(1, Math.round(SAMPLE_RATE * DURATION_SEC), SAMPLE_RATE);
  const buf = ctx.createBuffer(1, Math.round(SAMPLE_RATE * (CLICK_AT_SOURCE_SEC + 2)), SAMPLE_RATE);
  const data = buf.getChannelData(0);
  data[Math.round(CLICK_AT_SOURCE_SEC * SAMPLE_RATE)] = 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  const curve = new Float32Array(RATE_CURVE_STEPS + 1);
  for(let i = 0; i <= RATE_CURVE_STEPS; i++) curve[i] = rateAt((i / RATE_CURVE_STEPS) * DURATION_SEC, DURATION_SEC);
  src.playbackRate.setValueCurveAtTime(curve, 0, DURATION_SEC);
  src.start(0);
  return ctx.startRendering();
}

function findClickSample(buffer){
  const data = buffer.getChannelData(0);
  let bestIdx = 0, bestVal = 0;
  for(let i = 0; i < data.length; i++){
    if(Math.abs(data[i]) > bestVal){ bestVal = Math.abs(data[i]); bestIdx = i; }
  }
  return bestIdx;
}

// Replays the real anchor re-anchoring logic up to exactly `untilSec` of
// fake audio-clock time, fed the same analytic rateAt() the real
// automation curve above was built from -- mirrors tick()'s own rate-
// change branch (player/clock.js) exactly, just without tick()'s other,
// unrelated side effects (history, gapless scheduling).
function replayAnchor(untilSec){
  const fakeCtx = { currentTime: 0, state: 'running' };
  S.tracks = [{ duration: CLICK_AT_SOURCE_SEC + 2 }];
  S.index = 0;
  S.playing = true;
  S.rate = 1;
  S.ctx = fakeCtx;
  S.anchor = { ctxTime: 0, offset: 0, rate: 1 };
  let t = 0;
  while(t < untilSec){
    t = Math.min(untilSec, t + TICK_SEC);
    fakeCtx.currentTime = t;
    const r = rateAt(t, DURATION_SEC);
    if(Math.abs(r - S.rate) > 0.0001){
      const pos = currentPos();
      S.rate = r;
      S.anchor = { ctxTime: fakeCtx.currentTime, offset: pos, rate: r };
    }
  }
  return currentPos();
}

export async function run(){
  const rendered = await renderClick();
  const actualClickSample = findClickSample(rendered);
  const actualOutputSec = actualClickSample / SAMPLE_RATE;

  const reportedPos = replayAnchor(actualOutputSec);
  const diffMs = Math.abs(reportedPos - CLICK_AT_SOURCE_SEC) * 1000;

  const checks = [
    { name: 'click lands inside the render window (sanity)', value: actualOutputSec, pass: actualOutputSec > 0 && actualOutputSec < DURATION_SEC },
    { name: 'currentPos() at the click (doc: within 5ms of the true sample position)', value: diffMs, pass: diffMs < 5 },
  ];
  return { checks, pass: checks.every(c => c.pass) };
}
