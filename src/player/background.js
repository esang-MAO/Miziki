import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { setPathNote } from '../ui/path-note.js';
import { ensureContext } from '../audio/engine.js';
import { play, pause, seek } from './transport.js';
import { prevTrack, nextTrack } from './controls.js';
import { queueSave } from '../main.js';

/* ================= background playback (optional) =================
   Off by default, and when it is off none of this runs: audio goes master ->
   destination exactly as before. When on, the output goes master -> a
   MediaStreamDestination -> a hidden <audio> element instead. Browsers treat
   an <audio> element as real media playback, so the OS keeps it running when
   the app is left or the screen locks, and shows lock-screen controls through
   the Media Session API. The Pure/Vinyl chain (Sundown's rate included,
   in Vinyl) and Car Mode gain all sit in front of that destination, so
   none of them change.
   Trade-offs: the browser's media pipeline may resample to the device's output
   rate, and iOS/Android can still end playback for their own reasons (a call,
   battery saver). If the element cannot start, output falls back to the normal
   path rather than going silent. */
const BG_NOTE = "Keeps music playing when you leave the app or lock the screen, and adds lock-screen controls. Audio is routed through the browser's media player, which may convert it to the device's output rate. Pure and Vinyl still apply first.";
const BG_SUPPORTED = (function(){
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    return !!(AC && AC.prototype && typeof AC.prototype.createMediaStreamDestination === 'function'
      && typeof HTMLMediaElement !== 'undefined' && 'srcObject' in HTMLMediaElement.prototype);
  }catch(e){ return false; }
})();

export function bgRouteActive(){ return BG_SUPPORTED && S.bgAudio && !S.bg.failed; }

function bgEl(){
  if(S.bg.el) return S.bg.el;
  const el = document.createElement('audio');
  el.setAttribute('playsinline', ''); el.setAttribute('aria-hidden', 'true');
  el.preload = 'auto'; el.style.display = 'none';
  // something outside Miziki paused the stream (a call, a headset button, the OS) — follow it
  el.addEventListener('pause', () => {
    if(S.bg.swapping || !S.playing || !bgRouteActive()) return;
    pause();
  });
  document.body.appendChild(el);
  S.bg.el = el;
  return el;
}

// a quarter second of silence, used only to let the element start inside the tap
// before the real stream exists — browsers allow later source swaps on an element
// that has already played from a user gesture
function bgSilentURL(){
  if(S.bg.silentURL) return S.bg.silentURL;
  const rate = 8000, n = 2000, buf = new ArrayBuffer(44 + n), dv = new DataView(buf);
  const wr = (o, s) => { for(let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  wr(36, 'data'); dv.setUint32(40, n, true);
  for(let i = 0; i < n; i++) dv.setUint8(44 + i, 128);
  S.bg.silentURL = URL.createObjectURL(new Blob([buf], {type:'audio/wav'}));
  return S.bg.silentURL;
}

function bgStartEl(){
  const p = bgEl().play();
  if(p && typeof p.catch === 'function') p.catch(err => {
    if(err && err.name === 'AbortError') return;   // a source swap interrupted it; the swap restarts it
    bgFallback();
  });
}

function bgFallback(){
  if(S.bg.failed) return;
  S.bg.failed = true;
  applyOutputRoute();
  bgUpdateUI();
  setPathNote('Background playback could not start on this device, so Miziki is playing normally. Turn it off and on again in Character to retry.', true);
}

// call from inside a tap that is about to start playback
export function bgPrime(){
  if(!bgRouteActive()) return;
  const el = bgEl();
  if(el.srcObject){ if(el.paused) bgStartEl(); return; }
  if(!el.paused) return;
  el.src = bgSilentURL(); el.loop = true;
  bgStartEl();
}

function bgSwapGuard(){
  S.bg.swapping = true;
  setTimeout(() => { S.bg.swapping = false; }, 400);
}

export function applyOutputRoute(){
  if(!S.ctx || !S.nodes) return;
  const n = S.nodes, want = bgRouteActive();
  if(want && !n.bgDest){
    try{
      n.bgDest = S.ctx.createMediaStreamDestination();
      n.master.disconnect();
      n.master.connect(n.bgDest);
    }catch(e){
      try{ n.master.connect(S.ctx.destination); }catch(_){}
      n.bgDest = null;
      bgFallback();
      return;
    }
    const el = bgEl();
    bgSwapGuard();
    el.loop = false; el.removeAttribute('src');
    el.srcObject = n.bgDest.stream;
    if(S.playing) bgStartEl();
  } else if(!want && n.bgDest){
    try{ n.master.disconnect(); }catch(e){}
    n.master.connect(S.ctx.destination);
    try{ n.bgDest.disconnect(); }catch(e){}
    n.bgDest = null;
    bgTeardown();
  }
}

function bgTeardown(){
  clearTimeout(S.bg.idleTimer);
  const el = S.bg.el;
  if(el){ bgSwapGuard(); el.pause(); el.srcObject = null; el.removeAttribute('src'); }
  bgRemoveHandlers();
}

// load() calls stop() and then play() a moment later, so a track change looks like a
// brief pause. Only treat it as really paused if nothing starts again quickly — that
// keeps the lock screen from flickering and the media element running across tracks
// (iOS is touchy about restarting an element outside a tap).
export function bgSync(){
  if(!bgRouteActive()) return;
  clearTimeout(S.bg.idleTimer);
  if(S.playing){
    const el = bgEl();
    if(el.srcObject && el.paused) bgStartEl();
  } else {
    S.bg.idleTimer = setTimeout(() => { if(!S.playing) bgIdleNow(); }, 1500);
  }
  mediaSessionSync();
}

export function bgIdleNow(){
  const el = S.bg.el;
  if(el && el.srcObject && !el.paused) el.pause();
  if('mediaSession' in navigator){ try{ navigator.mediaSession.playbackState = 'paused'; }catch(e){} }
}

function mediaSessionSync(){
  if(!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession, t = current();
  if(!t) return;
  if(!S.bg.handlers) bgInstallHandlers();
  const key = [t.id, t.tags.title, t.tags.artist, t.tags.album, t.art || ''].join('|');
  if(key !== S.bg.msKey){
    S.bg.msKey = key;
    const base = {title:t.tags.title, artist:t.tags.artist, album:t.tags.album};
    try{
      ms.metadata = new MediaMetadata(Object.assign({}, base, {artwork: t.art ? [{src:t.art, sizes:'512x512'}] : []}));
    }catch(e){
      try{ ms.metadata = new MediaMetadata(base); }catch(_){}
    }
  }
  if(S.playing){ try{ ms.playbackState = 'playing'; }catch(e){} }
  bgPosition();
}

function bgInstallHandlers(){
  const ms = navigator.mediaSession;
  const set = (action, fn) => { try{ ms.setActionHandler(action, fn); }catch(e){} };
  set('play', async () => { if(!S.ctx) await ensureContext(null); if(!S.playing) play(); });
  set('pause', () => { if(S.playing) pause(); });
  set('stop', () => { if(S.playing) pause(); });
  set('previoustrack', prevTrack);
  set('nexttrack', nextTrack);
  set('seekto', d => { if(d && typeof d.seekTime === 'number') seek(d.seekTime); });
  // Left unset, iOS supplies its own default ±10s skip for these on the
  // lock screen, which takes over the Now Playing widget instead of the
  // previoustrack/nexttrack buttons above. Registering them as null
  // explicitly turns that default off.
  set('seekforward', null);
  set('seekbackward', null);
  S.bg.handlers = true;
}

function bgRemoveHandlers(){
  S.bg.msKey = '';
  if(!('mediaSession' in navigator) || !S.bg.handlers) return;
  const ms = navigator.mediaSession;
  ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekto', 'seekforward', 'seekbackward'].forEach(a => { try{ ms.setActionHandler(a, null); }catch(e){} });
  try{ ms.metadata = null; ms.playbackState = 'none'; }catch(e){}
  S.bg.handlers = false;
}

export function bgPosition(){
  if(!bgRouteActive() || !('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
  const t = current(); if(!t || !t.duration) return;
  try{
    navigator.mediaSession.setPositionState({duration:t.duration, playbackRate:S.rate > 0 ? S.rate : 1,
      position:clamp(S.pos, 0, t.duration)});
  }catch(e){}
}

export function bgUpdateUI(){
  const b = $('#bgAudioBtn'), note = $('#bgAudioNote');
  if(!b || !note) return;
  if(!BG_SUPPORTED){
    b.style.display = 'none';
    note.textContent = "This browser can't route audio this way, so music pauses when you leave the app.";
    return;
  }
  b.style.display = '';
  b.textContent = S.bgAudio ? 'On' : 'Off';
  b.setAttribute('aria-pressed', String(S.bgAudio));
  note.textContent = (S.bgAudio && S.bg.failed)
    ? "It couldn't start on this device this session, so Miziki is playing normally. Toggle it off and on to retry."
    : BG_NOTE;
}

export function applyBgAudioSetting(){
  // on iOS this also lets Web Audio play with the silent switch on
  try{ if('audioSession' in navigator) navigator.audioSession.type = bgRouteActive() ? 'playback' : 'auto'; }catch(e){}
  applyOutputRoute();
  if(bgRouteActive()) mediaSessionSync();
  else bgTeardown();
}

export function toggleBgAudio(){
  S.bgAudio = !S.bgAudio;
  S.bg.failed = false;
  if(S.bgAudio) bgPrime();   // still inside the tap, which is what lets the element start later
  applyBgAudioSetting();
  bgUpdateUI();
  queueSave();
}
