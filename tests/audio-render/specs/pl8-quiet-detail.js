// PL8 item 6 (docs/19_PLAYER.md): "keep the whole path in 32-bit float...
// a 24-bit file's quiet detail stays intact end to end." Code audit (not
// repeated here) confirmed no intermediate 16-bit step anywhere in the
// signal path: decodeAudioData() is native, spec-guaranteed float32
// (src/audio/engine.js's decodeAudioFile()); src/player/scrub.js's
// scratch windows and src/audio/limiter-processor.js's lookahead ring
// buffers are both plain Float32Array throughout.
//
// This render test proves the *result* that audit implies: a tone well
// below 16-bit's own noise floor (-96dBFS) survives the full Pure,
// untouched chain (normalization/EQ off, unity volume) at its real
// level. If any stage along the way truncated to 16 bits without
// dither, a -110dBFS tone would either vanish (hard truncation) or read
// far louder than it should (quantization noise swamping it near
// -96dBFS) -- 24-bit's own noise floor is near -144dBFS, so a real
// 32-bit-float path has no trouble reproducing this faithfully.
//
// This also exercises PL8 item 7 ("unity gain by default... the output
// is the file") at an extreme quiet level, as a complement to PL5's own
// null test (tests/audio-render/specs/pl5-transparent-output.js), which
// already proves unity gain at a normal listening level bit-for-bit.
import { S } from '../../../src/state.js';
import { buildGraph, routeSource, applyEQ, applyLoudnessNorm, applyMonoBalance, applyDeviceVolume } from '../../../src/audio/engine.js';
import { defaultEqState } from '../../../src/audio/eq.js';
import { windowDb } from '../lib/signal.js';

const SAMPLE_RATE = 44100;
const TONE_PEAK_DB = -110; // comfortably below 16-bit's own ~-96dBFS floor
// windowDb (lib/signal.js) measures RMS, which for any sine sits exactly
// 3.0103dB below its own peak amplitude (crest factor sqrt(2)) -- the
// expected target for comparison, not TONE_PEAK_DB itself.
const EXPECTED_RMS_DB = TONE_PEAK_DB - 20 * Math.log10(Math.SQRT2);
const TONE_HZ = 1000;
const DURATION_SEC = 1.0;

function resetS(){
  S.mode = 'pure';
  S.rate = 1;
  S.recordFormat = null;
  S.char = { wow: 0, sat: 0, soft: 0, comp: 0 };
  S.charDrift = 'off';
  S.mono = false;
  S.balance = 0;
  S.deviceVolume = 1;
  S.loudnessMode = 'off';
  S.tracks = [];
  S.index = 0;
  S.queue = [];
  S.shuffle = false;
  S.eq = defaultEqState();
}

export async function run(){
  resetS();
  const amplitude = Math.pow(10, TONE_PEAK_DB / 20);
  const ctx = new OfflineAudioContext(2, Math.round(SAMPLE_RATE * (DURATION_SEC + 0.05)), SAMPLE_RATE);
  S.ctx = ctx;
  S.nodes = await buildGraph(ctx);

  const n = Math.round(SAMPLE_RATE * DURATION_SEC);
  const src = new Float32Array(n);
  for(let i = 0; i < n; i++) src[i] = amplitude * Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE);
  const buf = ctx.createBuffer(2, n, SAMPLE_RATE);
  buf.copyToChannel(src, 0); buf.copyToChannel(src, 1);
  const node = ctx.createBufferSource();
  node.buffer = buf;

  applyEQ(0);
  applyLoudnessNorm(0);
  applyMonoBalance(0);
  applyDeviceVolume(0);
  routeSource(node);
  node.start(0);

  const rendered = await ctx.startRendering();
  // skip a small settle margin at the start (limiter lookahead) and stop
  // short of the source's own end, same reasoning as pl8-eq-guardrails.js.
  const measuredDb = windowDb(rendered, 0.02, DURATION_SEC - 0.04);
  const errorDb = Math.abs(measuredDb - EXPECTED_RMS_DB);

  const checks = [{
    name: `a ${TONE_PEAK_DB}dBFS-peak tone (well below 16-bit's own noise floor) survives Pure/untouched within 1dB of its real RMS level`,
    value: errorDb,
    pass: errorDb <= 1,
    detail: [`measured ${measuredDb.toFixed(2)}dBFS RMS vs expected ${EXPECTED_RMS_DB.toFixed(2)}dBFS RMS`],
  }];
  return { checks, pass: checks.every(c => c.pass) };
}
