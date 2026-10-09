import { S } from '../state.js';
import { applyVolume } from '../sundown/location.js';
import { stop, applyOutputRoute } from '../main.js';

/* ================= audio graph ================= */
export function makeContext(sampleRate){
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx;
  try { ctx = sampleRate ? new AC({sampleRate, latencyHint:'playback'}) : new AC(); }
  catch(e){ ctx = new AC(); }
  return ctx;
}

export function buildGraph(ctx){
  const n = {};
  // mechanical: platter wobble as modulated delay -> real pitch variation
  n.wobble = ctx.createDelay(0.05); n.wobble.delayTime.value = 0.012;
  n.wowOsc = ctx.createOscillator(); n.wowOsc.frequency.value = 0.55;
  n.wowAmt = ctx.createGain();
  n.flutOsc = ctx.createOscillator(); n.flutOsc.frequency.value = 6.3;
  n.flutAmt = ctx.createGain();
  n.wowOsc.connect(n.wowAmt).connect(n.wobble.delayTime);
  n.flutOsc.connect(n.flutAmt).connect(n.wobble.delayTime);
  n.wowOsc.start(); n.flutOsc.start();
  // electrical colorations
  n.sat = ctx.createWaveShaper(); n.sat.oversample = '4x';
  n.satTrim = ctx.createGain();
  n.dc = ctx.createBiquadFilter(); n.dc.type='highpass'; n.dc.frequency.value=14; n.dc.Q.value=0.7;
  n.tone = ctx.createBiquadFilter(); n.tone.type='highshelf'; n.tone.frequency.value=7000; n.tone.gain.value=0;
  n.comp = ctx.createDynamicsCompressor();
  n.comp.knee.value = 12; n.comp.attack.value = 0.012; n.comp.release.value = 0.26;
  n.makeup = ctx.createGain();
  n.master = ctx.createGain(); n.master.gain.value = 1;

  n.wobble.connect(n.sat).connect(n.satTrim).connect(n.dc).connect(n.tone).connect(n.comp).connect(n.makeup).connect(n.master);
  n.master.connect(ctx.destination);
  return n;
}

export function satCurve(amount){
  const N = 2049, c = new Float32Array(N);
  if(amount < 0.005){ for(let i=0;i<N;i++) c[i] = (i*2)/(N-1) - 1; return {curve:c, trim:1}; }
  // gentle soft clip blended with the dry signal; the x² term is the asymmetry
  // that makes even harmonics rather than the harsher odd-order kind
  const mix = amount*0.8, k = 1 + amount*2.2, asym = amount*0.18, norm = Math.tanh(k);
  for(let i=0;i<N;i++){
    const x = (i*2)/(N-1) - 1;
    c[i] = (1 - mix)*x + mix * Math.tanh(k*(x + asym*x*x)) / norm;
  }
  return {curve:c, trim: 1/(1 + amount*0.5)};
}

export function applyCharacter(){
  if(!S.nodes) return;
  const n = S.nodes, c = S.char, t = S.ctx.currentTime;
  n.wowAmt.gain.setTargetAtTime(0.00050 * c.wow, t, 0.05);
  n.flutAmt.gain.setTargetAtTime(0.000015 * c.wow, t, 0.05);
  const s = satCurve(c.sat);
  n.sat.curve = s.curve;
  n.satTrim.gain.setTargetAtTime(s.trim, t, 0.05);
  n.tone.gain.setTargetAtTime(-9 * c.soft, t, 0.05);
  n.comp.threshold.setTargetAtTime(-6 - 18*c.comp, t, 0.05);
  n.comp.ratio.setTargetAtTime(1 + 3*c.comp, t, 0.05);
  n.makeup.gain.setTargetAtTime(1 + 0.4*c.comp, t, 0.05);
}

export function routeSource(src){
  src.disconnect();
  src.connect(S.mode === 'pure' ? S.nodes.master : S.nodes.wobble);
}

// from the "file loading" section in main.js — rebuilds the context when
// a file's sample rate differs, then re-applies character, volume and
// output route
export async function ensureContext(rate){
  if(S.ctx && (!rate || S.ctx.sampleRate === rate)) { await S.ctx.resume(); return; }
  if(S.ctx){ stop(); try{ await S.ctx.close(); }catch(e){} }
  S.ctx = makeContext(rate);
  S.nodes = buildGraph(S.ctx);
  applyCharacter();
  applyVolume();
  applyOutputRoute();
  await S.ctx.resume();
}
