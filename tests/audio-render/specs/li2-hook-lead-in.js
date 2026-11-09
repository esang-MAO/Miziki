// LI2 (docs/35_LEAD_IN.md): offline-render proof that the crate hook
// preview actually starts LEAD_IN_SEC before the detector's own hookStart,
// and that the fade-in reaches a near-steady level by FADE_IN_SEC.
//
// Mirrors src/audio/hook-preview.js's own computeHookPreviewWindow() and
// playHookPreview()'s scheduling exactly (constants and formula copied
// below), the same way tests/audio-render/specs/pl3-gapless-boundary.js
// mirrors transport.js's own boundary formula rather than importing it:
// hook-preview.js's own imports (audio/engine.js, player/buffers.js) pull
// in main.js's whole module graph (down to a Vite-only `?raw` asset
// import), which this unbundled-serve harness can't load. The pure
// window-math itself (computeHookPreviewWindow) is unit-tested directly,
// with those two imports mocked out, in tests/unit/hook-preview.test.js.
//
// The source buffer is built in three amplitude-coded segments rather
// than three frequencies, so lib/signal.js's existing dB-only helpers are
// enough to tell them apart:
//   [0, 5)   "before the lead-in" -- never reached, since playback starts
//            at hookStart (10s) - LEAD_IN_SEC (5s) = 5s into the buffer
//   [5, 10)  "the lead-in" itself -- amplitude 0.25 (~ -12 dBFS)
//   [10, 25) "the hook" (hookStart..hookEnd) -- amplitude 0.7 (~ -3 dBFS)
// A real tap plays this once, so playHookPreview()'s own `now` is ctx
// time 0 -- the same anchoring pl1-fade-in.js relies on.
import { windowDb } from '../lib/signal.js';

const SAMPLE_RATE = 44100;
const FADE_SEC = 0.35;    // src/audio/hook-preview.js's own FADE_SEC
const FADE_IN_SEC = 1.0;  // src/audio/hook-preview.js's own FADE_IN_SEC
const LEAD_IN_SEC = 5;    // src/audio/hook-preview.js's own LEAD_IN_SEC
const HOOK_START = 10;
const HOOK_END = 25;
const LEAD_START = HOOK_START - LEAD_IN_SEC; // 5s
const SPAN = HOOK_END - LEAD_START;          // 20s
const RENDER_SEC = SPAN + 1; // a little past the fade-out
const A_LEAD = 0.25;
const A_HOOK = 0.7;

function buildSourceBuffer(ctx){
  const length = Math.round(40 * SAMPLE_RATE);
  const buf = ctx.createBuffer(1, length, SAMPLE_RATE);
  const data = buf.getChannelData(0);
  for(let i = 0; i < length; i++){
    const t = i / SAMPLE_RATE;
    const amp = t < LEAD_START ? 0 : t < HOOK_START ? A_LEAD : t < HOOK_END ? A_HOOK : 0;
    data[i] = amp * Math.sin(2 * Math.PI * 440 * t);
  }
  return buf;
}

export async function run(){
  const ctx = new OfflineAudioContext(1, Math.round(SAMPLE_RATE * RENDER_SEC), SAMPLE_RATE);
  const source = ctx.createBufferSource();
  source.buffer = buildSourceBuffer(ctx);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(ctx.destination);

  // playHookPreview()'s own envelope and start() call, verbatim.
  const now = ctx.currentTime;
  const fadeIn = Math.min(FADE_IN_SEC, SPAN / 2);
  const fadeOutAt = Math.max(fadeIn, SPAN - FADE_SEC);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1, now + fadeIn);
  gain.gain.setValueAtTime(1, now + fadeOutAt);
  gain.gain.linearRampToValueAtTime(0, now + SPAN);
  source.start(now, LEAD_START, SPAN);

  const buffer = await ctx.startRendering();

  // Offset correctness: output t=0 reads the source buffer at LEAD_START
  // (5s), not HOOK_START (10s) -- the lead-in segment's amplitude (-12
  // dBFS), not the hook's (-3 dBFS), once the fade-in has settled.
  const steadyLeadInDb = windowDb(buffer, 2.0, 0.3);
  // By output t=5 the source position has reached HOOK_START (10s) --
  // the louder hook segment should be audible there.
  const hookDb = windowDb(buffer, 5.3, 0.3);
  // The fade-in (1.0s): 50ms before it completes, level should already
  // be within 1 dB of the segment's own steady level.
  const nearFadeInEndDb = windowDb(buffer, 0.95, 0.05);

  // A sine's RMS is amplitude/sqrt(2) (its crest factor), so the expected
  // dBFS of a steady tone is 20*log10(amp) - ~3.01 dB, not 20*log10(amp).
  const expectedLeadInDb = 20 * Math.log10(A_LEAD / Math.SQRT2);
  const checks = [
    { name: 'offset: steady lead-in level ~ -12 dBFS peak (5s before hookStart)', value: steadyLeadInDb, pass: Math.abs(steadyLeadInDb - expectedLeadInDb) < 1 },
    { name: 'offset: hook segment is audibly louder once reached', value: hookDb, pass: hookDb > steadyLeadInDb + 5 },
    { name: 'fade-in: within 1 dB of steady level by 1.0s', value: nearFadeInEndDb, pass: Math.abs(nearFadeInEndDb - steadyLeadInDb) < 1 },
  ];
  return { checks, pass: checks.every(c => c.pass) };
}
