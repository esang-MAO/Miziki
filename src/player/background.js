import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { setPathNote } from '../ui/path-note.js';
import { ensureContext } from '../audio/engine.js';
import { play, pause, seek } from './transport.js';
import { prevTrack, nextTrack } from './controls.js';
import { queueSave } from '../storage/meta.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';

/* ================= background playback (optional) =================
   Off by default, and when it is off none of this runs: audio goes master ->
   destination exactly as before. When on, the output goes master -> a
   MediaStreamDestination -> a hidden <audio> element instead. Browsers treat
   an <audio> element as real media playback, so the OS keeps it running when
   the app is left or the screen locks, and shows lock-screen controls through
   the Media Session API. The Pure/Vinyl chain (Sundown's rate included,
   in Vinyl) sits in front of that destination, so none of it changes.
   Trade-offs: the browser's media pipeline may resample to the device's output
   rate, and iOS/Android can still end playback for their own reasons (a call,
   battery saver). If the element cannot start, output falls back to the normal
   path rather than going silent. */
// RF11 (docs/12_REFINE.md, point 5): one line — the rest of this copy lives
// in the static (i) disclosure right next to #bgAudioNote in miziki.html,
// which this function's own note.textContent write never touches.
const BG_NOTE = "Keeps music playing when you leave the app or lock the screen.";
const BG_SUPPORTED = (function(){
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    return !!(AC && AC.prototype && typeof AC.prototype.createMediaStreamDestination === 'function'
      && typeof HTMLMediaElement !== 'undefined' && 'srcObject' in HTMLMediaElement.prototype);
  }catch(_e){ return false; }
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

// AU3 (docs/16_AUDIO.md §1): the output stage now ends at n.out (master ->
// limiter -> out), not n.master -- applyOutputRoute() moves to n.out;
// everything else about background routing is unchanged.
export function applyOutputRoute(){
  if(!S.ctx || !S.nodes) return;
  const n = S.nodes, want = bgRouteActive();
  if(want && !n.bgDest){
    try{
      n.bgDest = S.ctx.createMediaStreamDestination();
      n.out.disconnect();
      n.out.connect(n.bgDest);
    }catch(_e){
      try{ n.out.connect(S.ctx.destination); }catch(_){}
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
    try{ n.out.disconnect(); }catch(_e){}
    n.out.connect(S.ctx.destination);
    try{ n.bgDest.disconnect(); }catch(_e){}
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
//
// Found 2026-10-26 ("the lock screen doesn't even recognize the song"):
// mediaSessionSync()/bgPosition() used to be gated behind bgRouteActive()
// here (and in applyBgAudioSetting()), on the assumption that Media
// Session metadata only matters once the hidden <audio> element is what
// keeps the OS treating this as real media playback. But
// navigator.mediaSession is a plain JS API independent of that element —
// it's exactly as cheap to keep populated whether or not Background
// playback (the opt-in "keep playing when the screen locks" toggle) is
// on, and leaving it unset meant Control Center/the lock screen fell back
// to iOS's own generic widget (the page's bare hostname for a title, and
// its default ±10s skip buttons instead of real previous/next — see
// bgInstallHandlers()'s own comment on that default) for as long as the
// page happened to still be alive without it. The <audio> element itself
// — what actually lets playback survive a real background/lock, not just
// this metadata — stays exactly as gated on bgRouteActive() as before.
export function bgSync(){
  if(bgRouteActive()){
    clearTimeout(S.bg.idleTimer);
    if(S.playing){
      const el = bgEl();
      if(el.srcObject && el.paused) bgStartEl();
    } else {
      S.bg.idleTimer = setTimeout(() => { if(!S.playing) bgIdleNow(); }, 1500);
    }
  }
  mediaSessionSync();
}

export function bgIdleNow(){
  const el = S.bg.el;
  if(el && el.srcObject && !el.paused) el.pause();
  if('mediaSession' in navigator){ try{ navigator.mediaSession.playbackState = 'paused'; }catch(_e){} }
}

function mediaSessionSync(){
  if(!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession, t = current();
  if(!t) return;
  if(!S.bg.handlers) bgInstallHandlers();
  const key = [t.id, t.tags.title, t.tags.artist, t.tags.album, t.art || ''].join('|');
  if(key !== S.bg.msKey){
    const base = {title:t.tags.title, artist:t.tags.artist, album:t.tags.album};
    let assigned = false;
    try{
      ms.metadata = new MediaMetadata(Object.assign({}, base, {artwork: t.art ? [{src:t.art, sizes:'512x512'}] : []}));
      assigned = true;
    }catch(_e){
      try{ ms.metadata = new MediaMetadata(base); assigned = true; }catch(_){}
    }
    // Only remember this key once a MediaMetadata assignment actually
    // succeeded (found 2026-10-26, alongside the bgRouteActive() gating
    // above) — committing the key on a failed attempt meant a single
    // transient MediaMetadata/artwork error permanently skipped every
    // future retry for that same track, since the key comparison above
    // would never see a change again until the track itself changed.
    if(assigned) S.bg.msKey = key;
  }
  if(S.playing){ try{ ms.playbackState = 'playing'; }catch(_e){} }
  bgPosition();
}

function bgInstallHandlers(){
  const ms = navigator.mediaSession;
  const set = (action, fn) => { try{ ms.setActionHandler(action, fn); }catch(_e){} };
  set('play', async () => { if(!S.ctx) await ensureContext(); if(!S.playing) play(); });
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
  ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekto', 'seekforward', 'seekbackward'].forEach(a => { try{ ms.setActionHandler(a, null); }catch(_e){} });
  try{ ms.metadata = null; ms.playbackState = 'none'; }catch(_e){}
  S.bg.handlers = false;
}

export function bgPosition(){
  if(!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
  const t = current(); if(!t || !t.duration) return;
  try{
    navigator.mediaSession.setPositionState({duration:t.duration, playbackRate:S.rate > 0 ? S.rate : 1,
      position:clamp(S.pos, 0, t.duration)});
  }catch(_e){}
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
  try{ if('audioSession' in navigator) navigator.audioSession.type = bgRouteActive() ? 'playback' : 'auto'; }catch(_e){}
  // applyOutputRoute() already tears down the hidden <audio> element on
  // an on->off transition (its own else branch, bgTeardown()) — that's
  // the real, audio-element-specific cleanup this toggle controls.
  // Media Session metadata/handlers are kept either way (see bgSync()'s
  // own comment above): bgTeardown() still wipes them as a side effect of
  // that transition, so re-sync right after to put them straight back.
  applyOutputRoute();
  mediaSessionSync();
}

export function toggleBgAudio(){
  S.bgAudio = !S.bgAudio;
  S.bg.failed = false;
  if(S.bgAudio) bgPrime();   // still inside the tap, which is what lets the element start later
  applyBgAudioSetting();
  bgUpdateUI();
  queueSave();
}

// RF7 (docs/12_REFINE.md): the "keep it playing in the background?" offer,
// shown once on return from backgrounding — never at boot, never more than
// once total. docs/design/refine/ReturnCard.dc.html is the design source
// for its wording; its own markup lives in miziki.html as #bgOfferCard.
const BG_OFFER_ANSWERED_KEY = 'miziki-bg-offer-answered';

function bgOfferAnswered(){
  try{ return localStorage.getItem(BG_OFFER_ANSWERED_KEY) === '1'; }catch(_e){ return false; }
}
function markBgOfferAnswered(){
  try{ localStorage.setItem(BG_OFFER_ANSWERED_KEY, '1'); }catch(_e){}
}

// Call on visibilitychange -> hidden. Remembers whether losing playback
// during this hide would actually mean something — a track was genuinely
// playing, and Background playback is off, so the OS is free to suspend it
// — so the matching return check (below) can tell "it stopped because we
// left" from "it was already paused anyway."
export function bgNoteHidden(){
  S.bg.awaitingReturnOffer = S.playing && !bgRouteActive();
}

// Call on visibilitychange -> visible, after the usual foreground work. If
// this return matches the scenario bgNoteHidden() flagged, and playback
// really did stop while hidden, show the one-time offer card — never
// again once either of its buttons has been tapped.
export function bgCheckReturnOffer(){
  const awaiting = S.bg.awaitingReturnOffer;
  S.bg.awaitingReturnOffer = false;
  if(!awaiting || !BG_SUPPORTED || bgOfferAnswered()) return;
  // Without a background route, the OS is free to suspend the whole
  // AudioContext while hidden — nothing in this app resumes it on its
  // own, so a suspended context (not just a stale S.playing) is the
  // reliable sign that this is exactly the silence the offer is for.
  const stoppedWhileHidden = !S.playing || (S.ctx && S.ctx.state === 'suspended');
  if(!stoppedWhileHidden) return;
  const card = $('#bgOfferCard');
  if(!card) return;
  card.classList.add('open');
  card.setAttribute('aria-hidden', 'false');
  openLayer('bg-offer', closeBgOfferCardInstant, { container: card });
}

function closeBgOfferCardInstant(){
  const card = $('#bgOfferCard');
  if(card){ card.classList.remove('open'); card.setAttribute('aria-hidden', 'true'); }
}

// What the card's own two buttons call — Back/Escape closing it the same
// way resolves as "Not now" (answered, not turned on), the same default a
// dismissed confirm dialog gets everywhere else in this app.
export function resolveBgOffer(turnOn){
  markBgOfferAnswered();
  if(turnOn && !S.bgAudio) toggleBgAudio();
  closeLayer('bg-offer');
}
