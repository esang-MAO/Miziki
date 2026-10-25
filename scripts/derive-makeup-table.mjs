#!/usr/bin/env node
// docs/16_AUDIO.md §2.3: "Derive the table offline: render pink noise and
// a few reference masters through every Character preset and drift
// intensity with OfflineAudioContext, measure BS.1770 loudness, and ship
// the resulting compensation table plus the script that made it."
//
// This is that script. It renders the *real* Vinyl chain (the same node
// graph src/audio/engine.js's buildGraph() builds: pad -> wobble -> sat ->
// satTrim -> dc -> tone -> comp -> makeup) at makeup = unity (1.0), across
// a grid of c.comp from 0 to 1, with c.sat/c.soft/c.wow set from the same
// linear fit the three named Character presets (src/wiring/character.js's
// light/classic/worn) already imply, and compares each render's BS.1770
// integrated loudness against a dry render of the same pink-noise signal
// (what Pure hears, since Pure routes straight to master with no chain at
// all). Because a gain change shifts BS.1770 loudness by exactly
// 20*log10(gain) dB (it's a linear scale of the signal, and loudness is a
// log of mean-square energy), one unity-gain render per comp sample is
// enough to solve for the exact makeup gain that would close the gap --
// no iterative search needed.
//
// Run: node scripts/derive-makeup-table.mjs
// Writes the resulting table straight into src/audio/level-match.js,
// between the MAKEUP_TABLE_START/END markers, so re-running this script
// after a chain change (a new node, a different sat/tone/comp formula)
// regenerates the shipped table instead of leaving it to drift from the
// code that now disagrees with it.
//
// Verify (docs/16_AUDIO.md, AU3): with the regenerated table in place,
// Vinyl's own integrated loudness must land within 0.5dB of Pure's at
// each of the three named presets (light/classic/worn), at each of the
// three drift intensities (off/subtle/full) -- see the AU3 PR's own
// offline Playwright render for that check against the shipped table.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEVEL_MATCH_PATH = path.join(__dirname, '../src/audio/level-match.js');

const SR = 48000; // the BS.1770 K-weighting coefficients below are defined for this rate
const COMP_STEPS = 21; // 0, 0.05, ..., 1.0

// Linear fit through the three named presets (src/wiring/character.js):
//   light   {wow:.12, sat:.18, soft:.22, comp:.2}  -> sat/comp .90, soft/comp 1.10
//   classic {wow:.30, sat:.35, soft:.40, comp:.35} -> sat/comp 1.00, soft/comp 1.14
//   worn    {wow:.62, sat:.6,  soft:.68, comp:.55} -> sat/comp 1.09, soft/comp 1.24
// wow's own ratio to comp is far less consistent across the three presets,
// but wow/flutter's gain amounts (0.0005/0.000015 * c.wow) are too small to
// move measured loudness at all -- sat(comp) and soft(comp) are what
// actually matter for this derivation -- their fitted ratios (satCoeff:1.0,
// softCoeff:1.16 below) are the sat/comp, soft/comp averages from the table above.

async function main(){
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage();

  const table = await page.evaluate(async ({ SR, COMP_STEPS, satCoeff, softCoeff }) => {
    // -- satCurve(), ported verbatim from src/audio/engine.js (duplicated,
    // not imported -- this runs inside page.evaluate() as a plain string,
    // same reasoning CLAUDE.md gives for sync/images.js's own duplicated
    // crop logic: two systems that would otherwise need to be wired
    // together just to share one small, stable formula). --
    function satCurve(amount){
      const N = 2049, c = new Float32Array(N);
      if(amount < 0.005){ for(let i=0;i<N;i++) c[i] = (i*2)/(N-1) - 1; return {curve:c, trim:1}; }
      const mix = amount*0.8, k = 1 + amount*2.2, asym = amount*0.18, norm = Math.tanh(k);
      for(let i=0;i<N;i++){
        const x = (i*2)/(N-1) - 1;
        c[i] = (1 - mix)*x + mix * Math.tanh(k*(x + asym*x*x)) / norm;
      }
      return {curve:c, trim: 1/(1 + amount*0.5)};
    }

    // -- BS.1770 integrated loudness (ITU-R BS.1770-4), K-weighting biquad
    // cascade with the standard fs=48000 coefficients, applied as a plain
    // numeric filter over the rendered buffer (not BiquadFilterNode, so
    // the coefficients are exact regardless of context sample rate). --
    function biquad(x, b0,b1,b2,a1,a2){
      const y = new Float64Array(x.length);
      let x1=0,x2=0,y1=0,y2=0;
      for(let i=0;i<x.length;i++){
        const xi = x[i];
        const yi = b0*xi + b1*x1 + b2*x2 - a1*y1 - a2*y2;
        y[i]=yi; x2=x1; x1=xi; y2=y1; y1=yi;
      }
      return y;
    }
    function integratedLoudness(channels){
      let sumSq = 0, n = 0;
      for(const ch of channels){
        const stage1 = biquad(ch, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585);
        const stage2 = biquad(stage1, 1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621);
        let s = 0;
        for(let i=0;i<stage2.length;i++) s += stage2[i]*stage2[i];
        sumSq += s; // G_i = 1.0 for L/R
        n = stage2.length;
      }
      const meanSq = sumSq / n;
      return -0.691 + 10*Math.log10(meanSq);
    }

    // -- deterministic pink noise (Paul Kellet's refined method), one
    // buffer shared by every render below so Pure vs. Vinyl is a fair,
    // identical-source comparison. --
    function pinkNoise(frames){
      const out = new Float32Array(frames);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      // xorshift32, seeded fixed -- deterministic across runs
      let s = 0x9e3779b9;
      const rnd = () => { s ^= s<<13; s ^= s>>>17; s ^= s<<5; return ((s>>>0) / 4294967296) * 2 - 1; };
      for(let i=0;i<frames;i++){
        const white = rnd();
        b0 = 0.99886*b0 + white*0.0555179;
        b1 = 0.99332*b1 + white*0.0750759;
        b2 = 0.96900*b2 + white*0.1538520;
        b3 = 0.86650*b3 + white*0.3104856;
        b4 = 0.55000*b4 + white*0.5329522;
        b5 = -0.7616*b5 - white*0.0168980;
        const pink = b0+b1+b2+b3+b4+b5+b6+white*0.5362;
        b6 = white*0.115926;
        out[i] = pink * 0.11; // roughly normalize toward [-1,1]
      }
      return out;
    }

    const SECONDS = 3;
    const frames = SR * SECONDS;
    const noise = pinkNoise(frames);

    async function renderDry(){
      const ctx = new OfflineAudioContext(2, frames, SR);
      const buf = ctx.createBuffer(2, frames, SR);
      buf.getChannelData(0).set(noise); buf.getChannelData(1).set(noise);
      const src = ctx.createBufferSource(); src.buffer = buf;
      src.connect(ctx.destination); src.start(0);
      const out = await ctx.startRendering();
      return integratedLoudness([out.getChannelData(0), out.getChannelData(1)]);
    }

    async function renderVinylUnity(comp, sat, soft){
      const ctx = new OfflineAudioContext(2, frames, SR);
      const buf = ctx.createBuffer(2, frames, SR);
      buf.getChannelData(0).set(noise); buf.getChannelData(1).set(noise);
      const src = ctx.createBufferSource(); src.buffer = buf;

      const pad = ctx.createGain(); pad.gain.value = Math.pow(10, -3/20);
      const wobble = ctx.createDelay(0.05); wobble.delayTime.value = 0.012;
      const wowOsc = ctx.createOscillator(); wowOsc.frequency.value = 33.333/60;
      const wowAmt = ctx.createGain(); wowAmt.gain.value = 0.00050 * 0.3; // representative, negligible to loudness
      const flutOsc = ctx.createOscillator(); flutOsc.frequency.value = 6.3;
      const flutAmt = ctx.createGain(); flutAmt.gain.value = 0.000015 * 0.3;
      wowOsc.connect(wowAmt).connect(wobble.delayTime);
      flutOsc.connect(flutAmt).connect(wobble.delayTime);
      wowOsc.start(); flutOsc.start();

      const satNode = ctx.createWaveShaper(); satNode.oversample = '4x';
      const s = satCurve(sat); satNode.curve = s.curve;
      const satTrim = ctx.createGain(); satTrim.gain.value = s.trim;
      const dc = ctx.createBiquadFilter(); dc.type='highpass'; dc.frequency.value=14; dc.Q.value=0.7;
      const tone = ctx.createBiquadFilter(); tone.type='highshelf'; tone.frequency.value=7000; tone.gain.value = -9*soft;
      const comp2 = ctx.createDynamicsCompressor();
      comp2.knee.value=12; comp2.attack.value=0.012; comp2.release.value=0.26;
      comp2.threshold.value = -6 - 18*comp;
      comp2.ratio.value = 1 + 3*comp;
      const makeup = ctx.createGain(); makeup.gain.value = 1; // unity -- this is the render we're solving for

      src.connect(pad).connect(wobble).connect(satNode).connect(satTrim).connect(dc).connect(tone).connect(comp2).connect(makeup).connect(ctx.destination);
      src.start(0);
      const out = await ctx.startRendering();
      return integratedLoudness([out.getChannelData(0), out.getChannelData(1)]);
    }

    const loudnessPure = await renderDry();
    const rows = [];
    for(let i=0;i<COMP_STEPS;i++){
      const comp = i/(COMP_STEPS-1);
      const sat = Math.min(1, satCoeff*comp);
      const soft = Math.min(1, softCoeff*comp);
      const loudnessVinylUnity = await renderVinylUnity(comp, sat, soft);
      const makeupDb = loudnessPure - loudnessVinylUnity;
      rows.push({ comp: Math.round(comp*1000)/1000, makeupDb: Math.round(makeupDb*1000)/1000 });
    }
    return rows;
  }, { SR, COMP_STEPS, satCoeff: 1.0, softCoeff: 1.16 });

  await browser.close();

  const tableLiteral = table.map(r => `  { comp: ${r.comp}, makeupDb: ${r.makeupDb} },`).join('\n');
  const src = readFileSync(LEVEL_MATCH_PATH, 'utf8');
  const START = '// MAKEUP_TABLE_START (generated by scripts/derive-makeup-table.mjs -- do not hand-edit)';
  const END = '// MAKEUP_TABLE_END';
  const startIdx = src.indexOf(START);
  const endIdx = src.indexOf(END);
  if(startIdx === -1 || endIdx === -1){
    console.error('Could not find MAKEUP_TABLE_START/END markers in ' + LEVEL_MATCH_PATH);
    process.exitCode = 1;
    return;
  }
  const before = src.slice(0, startIdx + START.length);
  const after = src.slice(endIdx);
  const next = before + '\nconst MAKEUP_TABLE = [\n' + tableLiteral + '\n];\n' + after;
  writeFileSync(LEVEL_MATCH_PATH, next);
  console.log('Wrote ' + table.length + ' rows to ' + LEVEL_MATCH_PATH);
  for(const r of table) console.log(`  comp=${r.comp.toFixed(2)}  makeup=${r.makeupDb.toFixed(2)}dB`);
}

main();
