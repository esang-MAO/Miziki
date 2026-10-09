import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { drawTime } from './clock.js';
import { pause, play, seek } from './transport.js';

/* ================= spin-to-scrub =================
   Full player only. Rotating the disc clockwise fast-forwards, counter-clockwise
   rewinds, at an invented ratio (not the real ~1.8s/rotation, which would need
   ~130 rotations to cross a four-minute track). Radius sensitivity is not
   simulated — measuring angle from the spindle via atan2 already gives fine
   control near the rim and coarse control near the center for free, because a
   given finger travel covers fewer degrees the farther out it is. */
const SCRUB_SEC_PER_ROTATION = 30;
const SCRUB_CLAIM_THRESHOLD_DEG = 8;
let scrubGesture = null;

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
    const rect = disc.getBoundingClientRect();
    const ang = pointerAngle(e.clientX, e.clientY, rect);
    scrubGesture = {pointerId:e.pointerId, startAngle:ang, lastAngle:ang, claimed:false,
      wasPlaying:S.playing, hapticAccum:0};
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
      if(S.playing) pause();               // silence during scrub
    }

    e.preventDefault();
    const d = angleDelta(ang, scrubGesture.lastAngle);
    scrubGesture.lastAngle = ang;
    S.angle = (S.angle + d + 360) % 360;    // the disc visually turns 1:1 with the finger
    S.pos = clamp(S.pos + d * (SCRUB_SEC_PER_ROTATION/360), 0, t.duration || 0);
    drawTime();

    scrubGesture.hapticAccum += Math.abs(d) * (SCRUB_SEC_PER_ROTATION/360);
    if(scrubGesture.hapticAccum >= 2){
      scrubGesture.hapticAccum = 0;
      if(navigator.vibrate) navigator.vibrate(8);
    }
  }, {passive:false});
  const release = e => {
    if(!scrubGesture || e.pointerId !== scrubGesture.pointerId) return;
    const {claimed, wasPlaying} = scrubGesture;
    scrubGesture = null;
    if(claimed){ seek(S.pos); if(wasPlaying) play(); }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
}
