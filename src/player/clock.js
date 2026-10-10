import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { sleepCheckDeadline } from './sleep-timer.js';
import { computeRate, sunProgress, easedProgress } from '../sundown/solar.js';
import { addPlayedRange, checkTrackCompletion } from '../history/played.js';
import { bgPosition, easeOutCubic, REDUCED } from '../main.js';

/* ================= render loop ================= */
let last = performance.now();
// The playback clock: position, played-range tracking (which feeds the 95% rule,
// sessions and metals) and Sundown's rate. Split out of frame() so it can also run
// while the page is hidden — the browser stops calling frame() then, but audio can
// keep playing (Background playback, or a background desktop tab).
export function tick(now, maxDt){
  const dt = Math.min(maxDt, (now - last)/1000); last = now;
  sleepCheckDeadline();   // fallback check — the setTimeout chain is primary

  const r = computeRate();
  if(Math.abs(r - S.rate) > 0.0001){
    S.rate = r;
    if(S.source) S.source.playbackRate.setTargetAtTime(r, S.ctx.currentTime, 0.08);
  }

  const t = current();
  if(S.playing && t){
    const prevPos = S.pos;
    S.pos += dt * S.rate;
    if(S.pos >= t.duration){ S.pos = t.duration; }
    addPlayedRange(prevPos, S.pos);
    checkTrackCompletion(t);
  }
  return dt;
}

// a track that ended on its own while hidden: bring the clock up to date, then credit
// whatever remained, since the source really did play to its end
export function settleTrackEnd(){
  const t = current(); if(!t) return;
  tick(performance.now(), 120);
  if(S.pos < t.duration){ addPlayedRange(S.pos, t.duration); S.pos = t.duration; }
  checkTrackCompletion(t);
}

export function frame(now){
  const dt = tick(now, 0.1);

  if(!REDUCED){
    let spin;
    if(S.playing) spin = S.rate;
    else if(S.spinDown){
      const p = clamp((now - S.spinDown.start) / S.spinDown.ms, 0, 1);
      spin = S.spinDown.from * (1 - easeOutCubic(p));
      if(p >= 1) S.spinDown = null;
    } else spin = 0;
    S.angle = (S.angle + dt * spin * 200) % 360;              // 33⅓ rpm = 200°/s
    $('#disc').style.transform = 'rotate(' + S.angle + 'deg)';
  }

  if(now - lastUI > 90){ lastUI = now; drawTime(); }
  if(now - lastSky > 220){ lastSky = now; drawSun(); }
  requestAnimationFrame(frame);
}
let lastUI = 0, lastSky = 0;

// hidden pages get no frames; keep the clock honest from a timer. A long gap here is
// real elapsed time (audio kept playing), not a stall, so the cap is much larger.
setInterval(() => {
  if(!document.hidden || !S.playing) return;
  tick(performance.now(), 120);
  bgPosition();
}, 1000);

export function fmt(s){ s = Math.max(0, Math.floor(s)); return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); }

export function drawTime(){
  const t = current();
  const dur = t ? (t.duration || 0) : 0;
  $('#tElapsed').textContent = fmt(S.pos);
  $('#tTotal').textContent = fmt(dur);
  const p = dur ? S.pos/dur : 0;
  if(!S.scrubbing) $('#scrub').value = Math.round(p*1000);
}

export function drawSun(){
  const p = sunProgress(), e = easedProgress();
  $('#sunFill').style.width = (p*100).toFixed(1) + '%';
  const semis = 12 * Math.log2(S.rate);
  $('#rateOut').textContent = S.rate.toFixed(3) + '× · ' + (semis >= -0.05 ? '0.0' : semis.toFixed(1)) + ' st';
  $('#rpmText').textContent = (33.333 * S.rate).toFixed(1);

  // Pure means untouched — Sundown only ever reaches the recording in Vinyl.
  // The settings below stay live and usable in Pure anyway, since they
  // describe what Vinyl will do the moment you switch back.
  if(S.mode === 'pure') $('#rateWhy').textContent = 'Pure — always full speed (Sundown applies in Vinyl)';
  else if(!S.auto) $('#rateWhy').textContent = 'Set by hand';
  else if(p <= 0) $('#rateWhy').textContent = 'Daylight — full speed';
  else if(p >= 1) $('#rateWhy').textContent = 'Night — settled at ' + S.target.toFixed(2) + '×';
  else $('#rateWhy').textContent = 'Twilight — ' + Math.round(e*100) + '% of the way down';

  if(S.sun.ok){
    const f = d => d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    $('#legStart').textContent = 'Sunset ' + f(S.sun.set);
    $('#legEnd').textContent = 'Dusk ' + f(S.sun.dusk);
  }

  // sky follows the same progress the platter does
  const A = [[29,47,56],[16,26,32]], B = [[59,33,48],[26,16,24]], C = [[18,14,25],[8,7,12]];
  const mix = (x,y,k) => x.map((v,i)=> Math.round(v + (y[i]-v)*k));
  const key = p < 0.5 ? [mix(A[0],B[0],p*2), mix(A[1],B[1],p*2)] : [mix(B[0],C[0],(p-0.5)*2), mix(B[1],C[1],(p-0.5)*2)];
  document.documentElement.style.setProperty('--sky1','rgb('+key[0].join(',')+')');
  document.documentElement.style.setProperty('--sky2','rgb('+key[1].join(',')+')');
}
