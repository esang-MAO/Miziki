// PL8 item 5 (docs/19_PLAYER.md): "Resampling is the one real quality
// step. Every file is converted to the engine's rate on decode (44.1kHz
// files to 48kHz on iPhone; 96 and 192kHz down to 48kHz). Measure WebKit's
// converter on device: a 44.1->48 and a 192->48 sweep should stay flat to
// 20kHz within 0.1dB with images/aliasing below -90dB."
//
// This exercises the real code path: src/audio/engine.js's decodeAudioFile()
// decodes a file's raw bytes via `new OfflineAudioContext(1, 1,
// S.ctx.sampleRate).decodeAudioData(raw)` -- decodeAudioData always
// resamples to *the context's own sample rate*, regardless of the file's
// native rate. So to measure the browser's actual resampler (not a
// hand-rolled stand-in for it), this encodes real WAV files at the source
// rate and decodes them through an OfflineAudioContext at the target rate,
// the same call shape decodeAudioFile() itself makes.
//
// Per-frequency tones (not a continuous sweep) because the measurement
// needs an exact, leakage-free bin to compare against -- same single-bin
// DFT projection as pl8-eq-guardrails.js. A tone's frequency in Hz is
// unchanged by resampling (only the sample rate/count changes, not the
// tone's own period in time), and an exactly 1.0s analysis window stays an
// exact integer bin at *either* sample rate, so flatness is `measuredDb`
// vs `0dB` (the tone's own source amplitude) and "images/aliasing" is
// measured the same way pl8-eq-guardrails.js measures THD+N: whatever
// energy is left after subtracting the tone's own best-fit reconstruction.
//
// IMPORTANT -- this is a Chromium-only data point, not the measurement the
// doc actually asks for. `npx playwright install webkit` fails in this
// container: the network policy here blocks both
// playwright.download.prss.microsoft.com and cdn.playwright.dev (confirmed
// 2026-10-28), so WebKit -- the engine iOS actually uses -- cannot be
// installed or run here. Item 11 ("measure in WebKit, not just Chromium")
// is explicitly *not* satisfied by this run.
//
// What Chromium's own converter measures (both checks below deliberately
// fail -- this documents a real finding, not a test bug; a sanity check
// ruled out 24-bit quantization as the cause, since its own noise floor
// (~-144dBFS) sits far below every number here):
//   44.1kHz -> 48kHz: flat within 0.003dB up to 15kHz, then rolls off fast
//     -- -2.6dB at 19kHz, -6.9dB at 20kHz -- with images rising from
//     -97.6dB (100Hz) to -67.0dB (20kHz) as that rolloff engages.
//   192kHz -> 48kHz: images stay clean throughout (-136 to -150dB -- this
//     direction's downsampling filter has a textbook-clean stopband), but
//     the *passband* itself rolls off starting well below the new 24kHz
//     Nyquist -- -0.12dB at 10kHz, -1.1dB at 15kHz, -4.3dB at 20kHz.
// Neither result meets the doc's targets (flat within 0.1dB, images below
// -90dB) on Chromium. But Chromium and WebKit use different resamplers
// (WebKit's is Apple's own), and the doc's own gate is explicitly "measure
// WebKit's converter on device" before deciding whether to build a
// replacement -- so this alone is not grounds to build the WASM resampler
// item 5 describes as the fallback. Recommendation: get a real WebKit or
// on-device run of this same spec before acting either way.
import { linearToDb } from '../../../src/audio/loudness.js';

const ANALYSIS_SEC = 1.0;
const SETTLE_SEC = 0.3; // clears any resampler-filter group delay
const END_MARGIN_SEC = 0.1; // keeps the analysis window off the source buffer's own abrupt end
const AMPLITUDE = 0.5;
const TEST_FREQS_HZ = [100, 1000, 5000, 10000, 15000, 19000, 20000];

// Same exact single-bin DFT as pl8-eq-guardrails.js -- valid here too,
// since the analysis window is always exactly 1.0s regardless of which
// sample rate it's measured at, so k = freqHz is always an integer bin.
function projectAtFrequency(signal, freqHz, sampleRate){
  const n = signal.length;
  const w = (2 * Math.PI * freqHz) / sampleRate;
  let c = 0, s = 0;
  for(let i = 0; i < n; i++){
    c += signal[i] * Math.cos(w * i);
    s += signal[i] * Math.sin(w * i);
  }
  c *= 2 / n; s *= 2 / n;
  return { c, s, amplitude: Math.hypot(c, s) };
}

// Non-fundamental residual (images/aliasing/noise), same reconstruct-and-
// subtract method pl8-eq-guardrails.js uses for THD+N.
function residualDb(signal, freqHz, sampleRate){
  const { c, s } = projectAtFrequency(signal, freqHz, sampleRate);
  const w = (2 * Math.PI * freqHz) / sampleRate;
  let sumSqResidual = 0, sumSqFundamental = 0;
  for(let i = 0; i < signal.length; i++){
    const fundamental = c * Math.cos(w * i) + s * Math.sin(w * i);
    const residual = signal[i] - fundamental;
    sumSqResidual += residual * residual;
    sumSqFundamental += fundamental * fundamental;
  }
  const rmsResidual = Math.sqrt(sumSqResidual / signal.length);
  const rmsFundamental = Math.sqrt(sumSqFundamental / signal.length);
  return linearToDb(rmsResidual / rmsFundamental);
}

// A minimal, mono, 24-bit PCM WAV encoder -- real file bytes to decode
// through the browser's own demuxer/decoder, not a synthetic AudioBuffer,
// since decodeAudioFile()'s resampling only happens on a real decode.
// 24-bit keeps quantization noise (~-144dBFS) far below the -90dB images
// floor this test is trying to measure.
function encodeWav24(samples, sampleRate){
  const bytesPerSample = 3;
  const dataSize = samples.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (offset, str) => { for(let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 24, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  const max = 2 ** 23 - 1;
  for(let i = 0; i < samples.length; i++){
    let v = Math.round(Math.max(-1, Math.min(1, samples[i])) * max);
    if(v < 0) v += 2 ** 24;
    const o = 44 + i * 3;
    view.setUint8(o, v & 0xff);
    view.setUint8(o + 1, (v >> 8) & 0xff);
    view.setUint8(o + 2, (v >> 16) & 0xff);
  }
  return buf;
}

function toneSamples(freqHz, sampleRate, durationSec, amplitude){
  const n = Math.round(sampleRate * durationSec);
  const out = new Float32Array(n);
  for(let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  return out;
}

// Decodes through an OfflineAudioContext at targetRate -- the exact call
// shape decodeAudioFile() (src/audio/engine.js) uses: decodeAudioData
// always resamples to the context's own rate.
async function decodeResampled(wavBuf, targetRate){
  const offline = new OfflineAudioContext(1, 1, targetRate);
  return await offline.decodeAudioData(wavBuf);
}

async function measureConversion(sourceRate, targetRate){
  const bufferSec = SETTLE_SEC + ANALYSIS_SEC + END_MARGIN_SEC;
  const results = [];
  for(const freqHz of TEST_FREQS_HZ){
    const samples = toneSamples(freqHz, sourceRate, bufferSec, AMPLITUDE);
    const wav = encodeWav24(samples, sourceRate);
    const decoded = await decodeResampled(wav, targetRate);
    const full = decoded.getChannelData(0);
    const settleN = Math.round(targetRate * SETTLE_SEC);
    const analysisN = Math.round(targetRate * ANALYSIS_SEC);
    const analysis = full.slice(settleN, settleN + analysisN);
    const measuredDb = linearToDb(projectAtFrequency(analysis, freqHz, targetRate).amplitude / AMPLITUDE);
    const imagesDb = residualDb(analysis, freqHz, targetRate);
    results.push({ freqHz, measuredDb, imagesDb });
  }
  return results;
}

function summarize(label, results){
  const worstFlatnessDb = Math.max(...results.map(r => Math.abs(r.measuredDb)));
  const worstImagesDb = Math.max(...results.map(r => r.imagesDb));
  return {
    checks: [
      {
        name: `${label}: flat to 20kHz within 0.1dB (Chromium only -- see header; not yet measured in WebKit)`,
        value: worstFlatnessDb,
        pass: worstFlatnessDb <= 0.1,
        detail: results.map(r => `${r.freqHz}Hz: ${r.measuredDb >= 0 ? '+' : ''}${r.measuredDb.toFixed(3)}dB`),
      },
      {
        name: `${label}: images/aliasing below -90dB (Chromium only -- see header; not yet measured in WebKit)`,
        value: worstImagesDb,
        pass: worstImagesDb < -90,
        detail: results.map(r => `${r.freqHz}Hz: ${r.imagesDb.toFixed(1)}dB`),
      },
    ],
  };
}

export async function run(){
  const r44to48 = await measureConversion(44100, 48000);
  const r192to48 = await measureConversion(192000, 48000);

  const checks = [
    ...summarize('44.1kHz -> 48kHz', r44to48).checks,
    ...summarize('192kHz -> 48kHz', r192to48).checks,
  ];
  return { checks, pass: checks.every(c => c.pass) };
}
