import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { sleepCheckDeadline } from './sleep-timer.js';
import { computeRate, sunProgress, easedProgress, currentDayPosition } from '../sundown/solar.js';
import { addPlayedRange, checkTrackCompletion } from '../history/played.js';
import { bgPosition } from './background.js';
import { easeOutCubic, REDUCED } from '../util/motion.js';
import { effectiveTheme } from '../ui/theme.js';

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

  // D4 (docs/DESKTOP_LAYOUT.md): the desktop player bar's own seek
  // readout mirrors this exact value, the same "reuse the readout
  // rather than compute it twice" approach drawSun() already uses for
  // the sidebar's Sundown card below — null-guarded since these ids
  // exist only in the player bar's own markup (miziki.html), hidden
  // below 1024px by CSS, never a breakpoint check.
  const barElapsed = $('#barElapsed'), barTotal = $('#barTotal');
  if(barElapsed) barElapsed.textContent = fmt(S.pos);
  if(barTotal) barTotal.textContent = fmt(dur);
  if(!S.scrubbing){ const barScrub = $('#barScrub'); if(barScrub) barScrub.value = Math.round(p*1000); }
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
  //
  // DA1 (docs/DAY_ARC.md): Dawn and Morning are the two new cases — every
  // other phase (midday/afternoon/golden, all still "full daylight" as
  // far as the rate is concerned) keeps the existing "Daylight — full
  // speed" wording, since DA1 only asks for Dawn's and Morning's own text,
  // not a distinct line for each of the seven phases (that's DA3's own
  // richer phase line).
  const dayPos = currentDayPosition();
  if(S.mode === 'pure') $('#rateWhy').textContent = 'Pure — always full speed (Sundown applies in Vinyl)';
  else if(!S.auto) $('#rateWhy').textContent = 'Set by hand';
  else if(dayPos.phase === 'dawn') $('#rateWhy').textContent = 'Dawn — rising, ' + Math.round(dayPos.phaseProgress*100) + '% of the way up';
  else if(dayPos.phase === 'morning') $('#rateWhy').textContent = 'Morning — full speed';
  else if(p <= 0) $('#rateWhy').textContent = 'Daylight — full speed';
  else if(p >= 1) $('#rateWhy').textContent = 'Night — settled at ' + S.target.toFixed(2) + '×';
  else $('#rateWhy').textContent = 'Twilight — ' + Math.round(e*100) + '% of the way down';

  if(S.sun.ok){
    const f = d => d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    $('#legStart').textContent = 'Sunset ' + f(S.sun.set);
    $('#legEnd').textContent = 'Dusk ' + f(S.sun.dusk);
  }

  // D3 (docs/DESKTOP_LAYOUT.md): the desktop sidebar's own Sundown summary
  // card mirrors this exact readout — "reuse the Sundown readout drawSun()
  // already writes rather than computing it twice," per that doc — rather
  // than having a second module call sunProgress()/computeRate() on its
  // own. These ids exist only in the sidebar's own DOM (src/shell/
  // sidebar.js has no render function of its own for them), hidden below
  // the 1024px breakpoint by CSS, so the null guard here is just "does
  // the sidebar card exist in the DOM," never a breakpoint check.
  const sideWhy = $('#sideRateWhy');
  if(sideWhy) sideWhy.textContent = $('#rateWhy').textContent;
  if(S.sun.ok){
    const sideStart = $('#sideLegStart'), sideEnd = $('#sideLegEnd');
    if(sideStart) sideStart.textContent = $('#legStart').textContent;
    if(sideEnd) sideEnd.textContent = $('#legEnd').textContent;
  }

  // sky follows the same progress the platter does — but this animated
  // palette (A/B/C below) is the dark theme's own visual language, a
  // daylight-teal-to-dusk-to-near-black descent that was written years
  // before Light/Auto/Dark (D2) existed, when --sky1/--sky2 had only one
  // possible value. Since D2, both are real theme tokens too (22-theme.css
  // sets light values for them), read by html/body's own background and
  // by the ground gradient in 00-base.css/13-player-overlay.css/
  // 09-launch-intro.css — but document.documentElement.style.setProperty()
  // writes an *inline* style, which always wins over a stylesheet rule
  // regardless of theme, so this was clobbering the light tokens with a
  // dark gradient every 220ms whenever the effective theme was Light
  // (flagged as a known, deliberately-deferred gap in CLAUDE.md's own D2
  // changelog entry, now actually fixed). Rather than invent a second,
  // light-appropriate animated palette — Sundown's whole premise is a
  // sunset, which is the dark theme's own chrome palette already answers
  // for — Light theme simply keeps the light tokens 22-theme.css already
  // set: no inline override to fight them, consistent with D2's "only
  // chrome changes" rule (the disc/sleeve/metals/share-image colors stay
  // as they are in both themes; the sky *is* chrome, so it follows suit).
  if(effectiveTheme() === 'light'){
    document.documentElement.style.removeProperty('--sky1');
    document.documentElement.style.removeProperty('--sky2');
  } else {
    const [sky1, sky2] = skyGradientStops(p);
    document.documentElement.style.setProperty('--sky1', sky1);
    document.documentElement.style.setProperty('--sky2', sky2);
  }
}

// The dark-theme sky animation's own color math, pulled out to a small
// pure function (exported for its own unit test — same precedent as
// angleDelta in scrub.js) rather than tested only through drawSun()
// itself, which needs a real document for everything else it touches.
export function skyGradientStops(p){
  const A = [[29,47,56],[16,26,32]], B = [[59,33,48],[26,16,24]], C = [[18,14,25],[8,7,12]];
  const mix = (x,y,k) => x.map((v,i)=> Math.round(v + (y[i]-v)*k));
  const key = p < 0.5 ? [mix(A[0],B[0],p*2), mix(A[1],B[1],p*2)] : [mix(B[0],C[0],(p-0.5)*2), mix(B[1],C[1],(p-0.5)*2)];
  return ['rgb('+key[0].join(',')+')', 'rgb('+key[1].join(',')+')'];
}
