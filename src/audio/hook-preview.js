/* ================= hook preview playback (AU12, docs/16_AUDIO.md §7) =================
   "It fades in and out, goes through the output stage, and stops when the
   card closes. It never counts as a play or a session." — a deliberately
   isolated, parallel playback path: a dedicated AudioBufferSourceNode that
   connects straight into the engine's existing n.master (the same node
   Pure routing already feeds — see audio/engine.js's routeSource()),
   skipping the mode-specific Vinyl coloration chain entirely so the
   preview is always a clean hook regardless of which mode the real
   transport is in, while still passing through the shared output stage
   downstream of it (norm/EQ/mono-balance/limiter/deviceVolume, §1).

   This never touches S.source, S.gen, play()/pause()/load() or any of the
   rule-9 transport code — it's a second, independent source node the same
   way AU6/RF28's audition-hold functions (auditionStageAlone, etc.,
   engine.js) are a second, independent gain setting, not a second
   playback path through the real transport. The crate hold card
   (crate/view.js's openCrateHoldCard()) is the one caller. */
import { S } from '../state.js';
import { ensureContext } from './engine.js';
import { ensureBuffer } from '../player/buffers.js';

const FADE_SEC = 0.35;
const DEFAULT_SPAN_SEC = 20;

let active = null;   // {source, gain, analyser, ctx, trackIdx, hookStart, hookEnd, span, startedAt}

export function isHookPreviewActive(){
  return !!active;
}

export function hookPreviewInfo(){
  if(!active) return null;
  const {trackIdx, hookStart, hookEnd, span} = active;
  return {trackIdx, hookStart, hookEnd, span};
}

export function hookPreviewElapsedSec(){
  if(!active) return 0;
  return Math.max(0, active.ctx.currentTime - active.startedAt);
}

export function hookPreviewAnalyser(){
  return active ? active.analyser : null;
}

export function stopHookPreview(){
  if(!active) return;
  const {source, gain, ctx} = active;
  active = null;
  try{
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + FADE_SEC);
  }catch(_e){ /* context already gone — nothing left to fade */ }
  setTimeout(() => {
    try{ source.stop(); }catch(_e){}
    try{ source.disconnect(); gain.disconnect(); }catch(_e){}
  }, FADE_SEC * 1000 + 60);
}

// trackIdx into S.tracks (not a track object) — the same shape
// player/buffers.js's ensureBuffer() already takes, so this reuses the
// exact same decoded-audio LRU cache every other preload already shares.
export async function playHookPreview(trackIdx, onEnded){
  stopHookPreview();
  await ensureContext();
  if(!S.ctx || !S.nodes) return null;
  const ok = await ensureBuffer(trackIdx);
  const t = S.tracks[trackIdx];
  if(!ok || !t || !t.buffer) return null;
  const buf = t.buffer;
  const dur = buf.duration;
  const d = t.details || {};
  const rawStart = typeof d.hookStart === 'number' ? d.hookStart : null;
  const rawEnd = typeof d.hookEnd === 'number' ? d.hookEnd : null;
  const hookStart = rawStart != null ? Math.max(0, Math.min(rawStart, Math.max(0, dur - 1))) : 0;
  const hookEnd = rawEnd != null && rawEnd > hookStart
    ? Math.min(rawEnd, dur)
    : Math.min(hookStart + DEFAULT_SPAN_SEC, dur);
  const span = Math.max(1, hookEnd - hookStart);

  const ctx = S.ctx;
  const source = ctx.createBufferSource();
  source.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(gain);
  gain.connect(analyser);
  gain.connect(S.nodes.master);

  const now = ctx.currentTime;
  const fadeIn = Math.min(FADE_SEC, span / 2);
  const fadeOutAt = Math.max(fadeIn, span - FADE_SEC);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1, now + fadeIn);
  gain.gain.setValueAtTime(1, now + fadeOutAt);
  gain.gain.linearRampToValueAtTime(0, now + span);

  source.start(now, hookStart, span);
  active = {source, gain, analyser, ctx, trackIdx, hookStart, hookEnd, span, startedAt: now};
  source.onended = () => {
    if(active && active.source === source){
      active = null;
      if(onEnded) onEnded();
    }
  };
  return {hookStart, hookEnd, span};
}
