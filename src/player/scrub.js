import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { drawTime } from './clock.js';
import { pause, play, seek } from './transport.js';

/* ================= spin-to-scrub =================
   Full player only. Rotating the disc clockwise fast-forwards, counter-clockwise
   rewinds. Two ratios, chosen by whether Scratch is on (Character menu) and
   whether Vinyl mode is active:
   - Scratch on, in Vinyl: the real turntable ratio, so spinning the disc
     doubles as true scratching (F2) — see the worklet section below.
   - Scratch off, or Pure mode: an invented fast ratio, since the real
     ~1.8s/rotation would need ~130 rotations to cross a four-minute track.
   Radius sensitivity is not simulated in either case — measuring angle from
   the spindle via atan2 already gives fine control near the rim and coarse
   control near the center for free, because a given finger travel covers
   fewer degrees the farther out it is. */
export const SCRUB_SEC_PER_ROTATION = 30;
// 33⅓ rpm -> one rotation every 60/33.333 ≈ 1.8s, the actual speed audio
// moves under the needle on a real record.
export const SCRATCH_SEC_PER_ROTATION = 1.8;
const SCRUB_CLAIM_THRESHOLD_DEG = 8;
let scrubGesture = null;

/* ---- F2: the scratch worklet ----
   A decoded track is tens of MB, and GitHub Pages can't send the headers
   SharedArrayBuffer needs, so only a window of audio around the current
   position is ever copied to the worklet — see loadScratchWindow(). Safari
   can't reliably play an AudioBufferSourceNode backward (negative
   playbackRate), which is why this is a worklet rather than another source
   node: see src/audio/scratch-processor.js for the actual playback math. */
const SCRATCH_WINDOW_SEC = 10;          // +/- this many seconds around the position
const SCRATCH_REFETCH_MARGIN_SEC = 2;   // reload the window once this close to its edge
const SCRATCH_RAMP_SEC = 0.008;         // gain ramp at gesture start/end, avoids clicks
const SCRATCH_WORKLET_URL = new URL('../audio/scratch-processor.js', import.meta.url);

let scratchSupported = true;      // false forever once a load/create attempt fails
let moduleLoadedCtx = null;       // the AudioContext the worklet module is registered in
let scratchNode = null, scratchGain = null, scratchGraphCtx = null;
let scratchWindowStart = 0, scratchWindowEnd = 0;

async function ensureScratchModule(ctx){
  if(!scratchSupported) return false;
  if(moduleLoadedCtx === ctx) return true;
  if(!ctx.audioWorklet){ scratchSupported = false; return false; }
  try{
    await ctx.audioWorklet.addModule(SCRATCH_WORKLET_URL);
    moduleLoadedCtx = ctx;
    return true;
  }catch(err){
    console.warn('Scratch unavailable (worklet failed to load); falling back to silent scrub.', err);
    scratchSupported = false;
    return false;
  }
}

function freeScratchNode(){
  if(scratchNode){ try{ scratchNode.port.postMessage({type:'stop'}); scratchNode.disconnect(); }catch(err){} }
  if(scratchGain){ try{ scratchGain.disconnect(); }catch(err){} }
  scratchNode = null; scratchGain = null; scratchGraphCtx = null;
}

function loadScratchWindow(buffer, centerSec){
  const sr = buffer.sampleRate, dur = buffer.duration;
  const startSec = clamp(centerSec - SCRATCH_WINDOW_SEC, 0, dur);
  const endSec = clamp(centerSec + SCRATCH_WINDOW_SEC, 0, dur);
  const startSample = Math.floor(startSec * sr);
  const endSample = Math.min(buffer.length, Math.ceil(endSec * sr));
  const chans = [];
  for(let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c).slice(startSample, endSample));
  scratchWindowStart = startSample / sr;
  scratchWindowEnd = endSample / sr;
  scratchNode.port.postMessage({
    type:'window', channels: chans.map(c => c.buffer), sampleRate: sr,
    windowStart: scratchWindowStart, trackDuration: dur,
  }, chans.map(c => c.buffer));
}

// Called once a gesture is claimed and confirmed to be a scratch (Vinyl +
// Scratch on). Builds the worklet graph lazily, the first time it's needed,
// and reuses it afterward as long as the AudioContext hasn't been rebuilt.
async function startScratch(t){
  const ctx = S.ctx;
  if(!ctx || !t || !t.buffer) return false;
  const ok = await ensureScratchModule(ctx);
  if(!ok) return false;
  if(scratchGraphCtx !== ctx) freeScratchNode();
  if(!scratchNode){
    try{
      scratchNode = new AudioWorkletNode(ctx, 'scratch-processor', {numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2]});
    }catch(err){
      console.warn('Scratch unavailable (worklet node failed to create); falling back to silent scrub.', err);
      scratchSupported = false;
      return false;
    }
    scratchGain = ctx.createGain(); scratchGain.gain.value = 0;
    // the scratch signal joins the Vinyl chain at the same point the normal
    // source does, so wow & flutter, saturation etc. color it the same way
    scratchNode.connect(scratchGain).connect(S.nodes.wobble);
    scratchGraphCtx = ctx;
  }
  loadScratchWindow(t.buffer, S.pos);
  scratchNode.port.postMessage({type:'start', position: S.pos});
  const now = ctx.currentTime;
  scratchGain.gain.cancelScheduledValues(now);
  scratchGain.gain.setValueAtTime(scratchGain.gain.value, now);
  scratchGain.gain.linearRampToValueAtTime(1, now + SCRATCH_RAMP_SEC);
  return true;
}

function updateScratchTarget(t){
  if(!scratchNode) return;
  scratchNode.port.postMessage({type:'target', target: S.pos});
  if(S.pos < scratchWindowStart + SCRATCH_REFETCH_MARGIN_SEC || S.pos > scratchWindowEnd - SCRATCH_REFETCH_MARGIN_SEC){
    loadScratchWindow(t.buffer, S.pos);
  }
}

function stopScratch(){
  if(!scratchNode || !scratchGain) return;
  const ctx = scratchGraphCtx;
  const now = ctx.currentTime;
  scratchGain.gain.cancelScheduledValues(now);
  scratchGain.gain.setValueAtTime(scratchGain.gain.value, now);
  scratchGain.gain.linearRampToValueAtTime(0, now + SCRATCH_RAMP_SEC);
  setTimeout(freeScratchNode, SCRATCH_RAMP_SEC * 1000 + 20);
}

function pointerAngle(clientX, clientY, rect){
  const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  return Math.atan2(clientY - cy, clientX - cx) * 180/Math.PI;
}
export function angleDelta(a, b){
  let d = a - b;
  while(d > 180) d -= 360;
  while(d < -180) d += 360;
  return d;
}

export function wireSpinToScrub(){
  const disc = $('#disc');
  disc.addEventListener('pointerdown', e => {
    if(!current()) return;
    // resume while still inside the tap, before any await — iOS only allows
    // this from a real user gesture, the same reason play()'s bgPrime() runs
    // first and before any await
    if(S.ctx) S.ctx.resume();
    const rect = disc.getBoundingClientRect();
    const ang = pointerAngle(e.clientX, e.clientY, rect);
    scrubGesture = {pointerId:e.pointerId, startAngle:ang, lastAngle:ang, claimed:false,
      wasPlaying:S.playing, hapticAccum:0, scratching:false};
  });
  window.addEventListener('pointermove', e => {
    if(!scrubGesture || e.pointerId !== scrubGesture.pointerId) return;
    const t = current(); if(!t){ scrubGesture = null; return; }
    const rect = disc.getBoundingClientRect();
    const ang = pointerAngle(e.clientX, e.clientY, rect);

    if(!scrubGesture.claimed){
      // small angular threshold before rotation claims the gesture, so an
      // ordinary drag/scroll can still win if this wasn't really a spin
      if(Math.abs(angleDelta(ang, scrubGesture.startAngle)) < SCRUB_CLAIM_THRESHOLD_DEG) return;
      scrubGesture.claimed = true;
      try{ disc.setPointerCapture(e.pointerId); }catch(err){}
      if(S.playing) pause();               // silence the normal transport during a scrub...
      // ...replaced by real scratch audio if Vinyl + Scratch are both on.
      // Scratch works even while paused, same as a real record moved by hand
      // with the motor off, so this doesn't depend on wasPlaying.
      scrubGesture.scratching = S.mode === 'vinyl' && S.char.scratch;
      if(scrubGesture.scratching) startScratch(t);
    }

    e.preventDefault();
    const d = angleDelta(ang, scrubGesture.lastAngle);
    scrubGesture.lastAngle = ang;
    S.angle = (S.angle + d + 360) % 360;    // the disc visually turns 1:1 with the finger
    const secPerRotation = scrubGesture.scratching ? SCRATCH_SEC_PER_ROTATION : SCRUB_SEC_PER_ROTATION;
    S.pos = clamp(S.pos + d * (secPerRotation/360), 0, t.duration || 0);
    drawTime();
    if(scrubGesture.scratching) updateScratchTarget(t);

    scrubGesture.hapticAccum += Math.abs(d) * (secPerRotation/360);
    if(scrubGesture.hapticAccum >= 2){
      scrubGesture.hapticAccum = 0;
      if(navigator.vibrate) navigator.vibrate(8);
    }
  }, {passive:false});
  const release = e => {
    if(!scrubGesture || e.pointerId !== scrubGesture.pointerId) return;
    const {claimed, wasPlaying, scratching} = scrubGesture;
    scrubGesture = null;
    if(scratching) stopScratch();
    if(claimed){ seek(S.pos); if(wasPlaying) play(); }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
}
