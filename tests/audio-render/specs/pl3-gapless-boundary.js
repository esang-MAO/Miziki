// PL3 (docs/19_PLAYER.md, "gapless that always lands"): offline-render
// proof for item 1's exact-boundary formula -- the current source ends at
// `anchor.ctxTime + (duration - anchor.offset) / anchor.rate`, and arming
// the next source at that exact context time (armGaplessNext(), src/
// player/transport.js) must leave no audible seam, at rate 1.0 and at a
// Sundown-style slowed rate (0.85).
//
// Two "tracks" are really one continuous low-frequency sine, split at
// durA seconds of *source* time into bufferA/bufferB -- the same way two
// real, separately-decoded files joined end-to-end would be. bufferA is
// started at output time 0; bufferB is started at exactly the formula's
// own computed endCtxTime, the way maybeScheduleGaplessNext()/
// armGaplessNext() actually schedule it. If the boundary lands anywhere
// but exactly where bufferA's own last sample ends, the sine's phase
// jumps discontinuously at the splice -- a large, easy-to-detect spike
// against a 2 Hz tone's own tiny natural per-sample slope (chosen so even
// a full-scale phase jump is unmistakably larger than anything the sine
// itself ever produces, at either rate tested).
const SAMPLE_RATE = 44100;
const FREQ_HZ = 2;          // low enough that the sine's own per-sample slope stays far under -60 dBFS
const AMP = 0.9;
const DUR_A_SEC = 3;        // bufferA's own duration, in *source* time
const DUR_B_SEC = 3;

function buildSplitSine(){
  const totalSamples = Math.round((DUR_A_SEC + DUR_B_SEC) * SAMPLE_RATE);
  const full = new Float32Array(totalSamples);
  for(let i = 0; i < totalSamples; i++){
    full[i] = AMP * Math.sin(2 * Math.PI * FREQ_HZ * (i / SAMPLE_RATE));
  }
  const splitAt = Math.round(DUR_A_SEC * SAMPLE_RATE);
  return { a: full.subarray(0, splitAt), b: full.subarray(splitAt) };
}

// Mirrors maybeScheduleGaplessNext()'s own formula exactly (src/player/
// transport.js): the current source's exact end, derived from the anchor
// it started at -- not re-estimated from a live position.
function exactBoundary(anchor, duration){
  return anchor.ctxTime + (duration - anchor.offset) / anchor.rate;
}

async function renderAtRate(rate){
  const { a, b } = buildSplitSine();
  const anchor = { ctxTime: 0, offset: 0, rate };
  const endCtxTime = exactBoundary(anchor, DUR_A_SEC);

  const totalOutputSec = endCtxTime + DUR_B_SEC / rate + 0.02;
  const ctx = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * totalOutputSec), SAMPLE_RATE);

  const bufA = ctx.createBuffer(1, a.length, SAMPLE_RATE);
  bufA.copyToChannel(Float32Array.from(a), 0);
  const srcA = ctx.createBufferSource();
  srcA.buffer = bufA;
  srcA.playbackRate.value = rate;
  srcA.connect(ctx.destination);
  srcA.start(0);

  const bufB = ctx.createBuffer(1, b.length, SAMPLE_RATE);
  bufB.copyToChannel(Float32Array.from(b), 0);
  const srcB = ctx.createBufferSource();
  srcB.buffer = bufB;
  srcB.playbackRate.value = rate;
  srcB.connect(ctx.destination);
  // armGaplessNext()'s own call shape: src.start(when, gaplessDelaySec, duration)
  srcB.start(endCtxTime, 0, DUR_B_SEC);

  const rendered = await ctx.startRendering();
  const data = rendered.getChannelData(0);

  let maxDiff = 0;
  for(let i = 1; i < data.length; i++){
    const d = Math.abs(data[i] - data[i - 1]);
    if(d > maxDiff) maxDiff = d;
  }
  const maxDiffDb = maxDiff > 0 ? 20 * Math.log10(maxDiff) : -Infinity;
  return { maxDiffDb, endCtxTime };
}

export async function run(){
  const checks = [];
  for(const rate of [1.0, 0.85]){
    const { maxDiffDb, endCtxTime } = await renderAtRate(rate);
    checks.push({
      name: `rate ${rate}: no sample-to-sample jump above -60 dBFS (boundary at ${endCtxTime.toFixed(4)}s)`,
      value: maxDiffDb,
      pass: maxDiffDb < -60,
    });
  }
  return { checks, pass: checks.every(c => c.pass) };
}
