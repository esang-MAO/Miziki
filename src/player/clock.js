import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { sleepCheckDeadline } from './sleep-timer.js';
import { computeRate, sunProgress, easedProgress, currentDayPosition, nowClock } from '../sundown/solar.js';
import { driftSummaryText, effectiveChar } from '../sundown/drift.js';
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
  const semis = 12 * Math.log2(S.rate);

  // DA3's own header eyebrow ("Now · 6:49 PM") — only while live;
  // src/wiring/sundown.js's own #preview input handler owns the
  // "Previewing · <time>" text the instant the slider moves, since that
  // has to feel immediate, not wait for this ~220ms-throttled tick.
  if(S.previewMin === 0){
    const eyebrow = $('#sundownEyebrow');
    if(eyebrow){
      eyebrow.textContent = 'Now · ' + nowClock().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
      eyebrow.classList.remove('sd-previewing');
    }
  }
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

  // D3 (docs/DESKTOP_LAYOUT.md): the desktop sidebar's own Sundown summary
  // card mirrors this exact readout — "reuse the Sundown readout drawSun()
  // already writes rather than computing it twice," per that doc — rather
  // than having a second module call sunProgress()/computeRate() on its
  // own. These ids exist only in the sidebar's own DOM (src/shell/
  // sidebar.js has no render function of its own for them), hidden below
  // the 1024px breakpoint by CSS, so the null guard here is just "does
  // the sidebar card exist in the DOM," never a breakpoint check. Since
  // DA3, the sunset/dusk leg mirror reads the day arc's own two time
  // labels (#arcTimeSunset/#arcTimeDusk, set by updateDayArc() below)
  // instead of the now-removed #legStart/#legEnd row.
  const sideWhy = $('#sideRateWhy');
  if(sideWhy) sideWhy.textContent = $('#rateWhy').textContent;
  if(S.sun.ok){
    const sideStart = $('#sideLegStart'), sideEnd = $('#sideLegEnd');
    const f = d => d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    if(sideStart) sideStart.textContent = 'Sunset ' + f(S.sun.set);
    if(sideEnd) sideEnd.textContent = 'Dusk ' + f(S.sun.dusk);
  }

  // DA3 (docs/DAY_ARC.md): the sky now follows the whole day in both
  // themes, not just the dusk window in dark — see skyGradientStops()'s
  // own header comment for the 8-anchor design. This replaces the D2-era
  // "Light keeps its static tokens, no inline override" behavior
  // (CLAUDE.md's own D2 changelog entry, and the sky-fix entry right
  // after it) on purpose: that was a deliberate stand-in for "we haven't
  // designed a light sky arc yet," not a permanent rule — the design
  // README (docs/design/day-arc/README.md) now gives Light its own full,
  // contrast-checked anchor table, so there's no longer a reason to skip
  // animating it. document.documentElement.style.setProperty() still
  // writes an inline style (always wins over the stylesheet's own
  // 22-theme.css tokens), which is exactly the point now in both themes.
  const [sky1, sky2] = skyGradientStops(dayPos, effectiveTheme());
  document.documentElement.style.setProperty('--sky1', sky1);
  document.documentElement.style.setProperty('--sky2', sky2);

  // DA3's own phase block: a big phase name ("Twilight") plus a muted
  // sub-line ("60% of the way down"), kept separate from #rateWhy just
  // above (which stays the existing, shorter "Now playing at" sub-copy —
  // the doc's own "keep the existing readout and add a new phase line"
  // instruction, not a replacement for it). phaseText() is a small, pure
  // DOM-free helper so the actual phase-name/phase-sub strings are
  // directly unit-testable without a document.
  const { name, sub } = phaseText(dayPos, p, e);
  const phaseNameEl = $('#phaseName'), phaseSubEl = $('#phaseSub');
  if(phaseNameEl) phaseNameEl.textContent = name;
  if(phaseSubEl) phaseSubEl.textContent = sub;
  const sidePhaseName = $('#sidePhaseName'), sidePhaseSub = $('#sidePhaseSub');
  if(sidePhaseName) sidePhaseName.textContent = name;
  if(sidePhaseSub) sidePhaseSub.textContent = sub;

  updateDayArc(dayPos);

  // DA3's "Rise at dawn" row — the next sunrise time, same source as the
  // arc's own Sunrise label.
  const sunriseNext = $('#sunriseNext');
  if(sunriseNext && S.sun.ok) sunriseNext.textContent = 'Next ' + S.sun.rise.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});

  // DA3's Day-drift shortcut row ("Character now: a touch warmer
  // (Subtle)") — reuses the exact intensity Sound's own sliders drift
  // by (effectiveChar()'s own S.charDrift read, src/audio/engine.js),
  // computed fresh every drawSun() tick alongside everything else here
  // rather than on its own timer.
  const driftSummary = $('#dayDriftSummary');
  const intensity = S.mode === 'pure' ? 'off' : S.charDrift;
  if(driftSummary) driftSummary.textContent = driftSummaryText(dayPos, intensity);

  // DA2/DA3: each Sound slider's own "now" badge — the same drifted value
  // applyCharacter() (src/audio/engine.js) actually sent to the audio
  // graph, read back here rather than recomputed a third time. Shown only
  // once it would say something different from the slider's own user
  // value, the same "don't clutter the UI with a number that matches
  // what's already on screen" judgment the mockup's own dual-label
  // slider design implies — '' clears the badge (CSS hides an empty one).
  if(S.char){
    const now = effectiveChar(S.char, dayPos, intensity);
    for(const k of ['wow', 'sat', 'soft', 'comp']){
      const badge = $('#' + k + 'Now');
      if(!badge) continue;
      const nowPct = Math.round(now[k] * 100), userPct = Math.round(S.char[k] * 100);
      badge.textContent = nowPct === userPct ? '' : 'now ' + nowPct + '%';
    }
    const legend = $('#charNowLegend');
    if(legend) legend.style.display = intensity === 'off' ? 'none' : '';
  }
}

// DA3's day arc: moves the sun-or-moon dot and highlights the current
// phase's label. Null-guarded the same way every other optional id in
// this function is — #dayArc only exists in the Sundown route's own
// markup (miziki.html), not in every test harness that loads this file.
function updateDayArc(dayPos){
  const dot = $('#sunDot');
  if(dot){
    const { x, y, isNight } = dayArcPosition(dayPos);
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
    dot.classList.toggle('arc-dot-night', isNight);
  }
  const active = DAY_ARC_ACTIVE_LABEL[dayPos.phase] || null;
  for(const key of ['dawn', 'sunrise', 'noon', 'sunset', 'dusk']){
    const label = $('#arcLabel' + key[0].toUpperCase() + key.slice(1));
    if(label) label.classList.toggle('arc-label-active', key === active);
  }
  if(S.sun.ok){
    const f = d => d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    const times = { dawn: S.sun.dawn, sunrise: S.sun.rise, noon: S.sun.noon, sunset: S.sun.set, dusk: S.sun.dusk };
    for(const key in times){
      const el = $('#arcTime' + key[0].toUpperCase() + key.slice(1));
      if(el && times[key]) el.textContent = f(times[key]);
    }
  }
}

// Which of the arc's five labels (dawn/sunrise/noon/sunset/dusk) takes the
// accent color for each of dayPosition()'s seven phases — a schematic
// many-to-one mapping (seven phases, five labelled moments), since the
// arc itself is schematic (the design README's own "not to scale" note):
// each phase highlights whichever labelled moment it's currently
// building toward or holding at. Night highlights nothing — none of the
// five labelled instants is "now" for the whole rest of the night.
const DAY_ARC_ACTIVE_LABEL = {
  dawn: 'dawn', morning: 'sunrise', midday: 'noon', afternoon: 'noon',
  golden: 'sunset', twilight: 'dusk', night: null,
};

// The arc's own schematic (not-to-scale — see the design README) x/y
// position for the sun-or-moon dot, in the SVG's own 0..342 x 0..150
// viewBox coordinate space. Day phases (dawn through twilight) walk left
// to right along a fixed, evenly-spaced schematic span per phase — not
// real elapsed fractions of each phase's own true duration, the same
// "the five labels are evenly spread, the bands are widened so they fit"
// simplification the design README's own arc component already
// describes — rising from the horizon at dawn to a peak around midday
// and back down to the horizon by the end of twilight. Night has no
// finer-grained progress of its own (dayPosition()'s phaseProgress is
// always 0 there, by design — see day.js's own duskRampProgress note) so
// the moon sits at one fixed, representative point under the horizon
// rather than animating across the night — a deliberate, documented
// simplification, not a bug: tracking the moon's real position would
// need a value dayPosition() doesn't expose anywhere else in this
// feature, for a purely decorative dot. Exported for its own unit test,
// same precedent as angleDelta (scrub.js)/skyGradientStops above.
const DAY_ARC_GEOMETRY = { marginX: 24, width: 294, horizonY: 92, dayAmp: 68, nightY: 128 };
const DAY_ARC_PHASE_SPAN = {
  dawn:      [0.00, 0.14],
  morning:   [0.14, 0.32],
  midday:    [0.32, 0.50],
  afternoon: [0.50, 0.68],
  golden:    [0.68, 0.86],
  twilight:  [0.86, 1.00],
};

export function dayArcPosition(dayPos){
  const { marginX, width, horizonY, dayAmp, nightY } = DAY_ARC_GEOMETRY;
  if(dayPos.phase === 'night') return { x: marginX + width / 2, y: nightY, isNight: true };
  const span = DAY_ARC_PHASE_SPAN[dayPos.phase] || DAY_ARC_PHASE_SPAN.midday;
  const t = clamp(span[0] + clamp(dayPos.phaseProgress || 0, 0, 1) * (span[1] - span[0]), 0, 1);
  return { x: marginX + t * width, y: horizonY - dayAmp * Math.sin(Math.PI * t), isNight: false };
}

// DA3's phase-name/phase-sub text, pulled out of drawSun() as a small pure
// function (same precedent as skyGradientStops/angleDelta) so its wording
// is testable directly. dayPos is dayPosition()'s own shape; p/e are
// sunProgress()/easedProgress()'s pre-existing 0=day/1=night values, reused
// rather than recomputed a second time (drawSun()'s existing #rateWhy
// cascade already has them in scope).
export function phaseText(dayPos, p, e){
  switch(dayPos.phase){
    case 'dawn': return { name: 'Dawn', sub: Math.round(dayPos.phaseProgress*100) + '% of the way up' };
    case 'morning': return { name: 'Morning', sub: 'Bright, full speed' };
    case 'midday': return { name: 'Midday', sub: 'Full speed' };
    case 'afternoon': return { name: 'Afternoon', sub: 'Full speed' };
    case 'golden': return { name: 'Golden hour', sub: 'Full speed' };
    case 'twilight': return { name: 'Twilight', sub: Math.round(e*100) + '% of the way down' };
    case 'night': return { name: 'Night', sub: 'Settled in for the night' };
    default: return { name: 'Midday', sub: 'Full speed' };
  }
}

// The sky's own color math — 8 named anchors (docs/design/day-arc/
// README.md's own sky-token table), smoothstep-blended between
// neighbours by dayPosition()'s phase/phaseProgress, the same
// architecture DA2's own character drift (src/sundown/drift.js) already
// uses and for the same reason: every phase boundary is continuous by
// construction (the next phase's blend source is always the previous
// phase's blend target), with no separate continuity mechanism to keep
// in sync. Dusk is the one anchor with no dayPosition() phase of its
// own — like Golden's "sunset − 1h"/Midday's "solar noon," the design
// README's "When" column names the representative instant each swatch
// was picked at, not a separate phase (Golden/Midday apply flat across
// their whole phase, the same judgment call drift.js already made) — but
// Dusk is the one true interior waypoint: Twilight ramps Golden -> Dusk
// across its own phaseProgress (reaching the Dusk anchor exactly at the
// dusk instant), and the first 30 minutes of Night (day.js's own
// duskRampProgress, added for exactly this) ramps Dusk -> Night,
// continuous with Twilight's own ending value, before settling flat at
// the Night anchor for the rest of the night. Dawn then ramps Night ->
// Morning the same way DA2's own dawn branch already does. Pure, no
// document — exported for its own unit test, same precedent as
// angleDelta (scrub.js)/gatefoldSideSplits (gatefold/view.js).
const SKY_ANCHORS = {
  dark: {
    night:     [[18,14,25],[8,7,12]],
    dawn:      [[56,40,66],[24,19,31]],
    morning:   [[28,56,67],[15,31,39]],
    midday:    [[29,47,56],[16,26,32]],
    afternoon: [[35,53,60],[17,25,30]],
    golden:    [[61,42,31],[26,19,16]],
    twilight:  [[59,33,48],[26,16,24]],
    dusk:      [[30,24,40],[13,11,19]],
  },
  light: {
    night:     [[232,227,238],[224,218,232]],
    dawn:      [[245,229,224],[237,216,209]],
    morning:   [[239,244,242],[227,236,234]],
    midday:    [[246,241,231],[236,229,216]],
    afternoon: [[245,239,227],[235,227,211]],
    golden:    [[247,230,205],[240,217,182]],
    twilight:  [[243,230,231],[235,221,224]],
    dusk:      [[236,230,238],[227,221,232]],
  },
};

const smoothstep = p => p*p*(3 - 2*p);
const mixRGB = (a,b,k) => a.map((v,i) => Math.round(v + (b[i]-v)*k));
const mixPair = (a,b,k) => [mixRGB(a[0],b[0],k), mixRGB(a[1],b[1],k)];
const toStops = pair => ['rgb('+pair[0].join(',')+')', 'rgb('+pair[1].join(',')+')'];

export function skyGradientStops(dayPos, theme){
  const T = SKY_ANCHORS[theme === 'light' ? 'light' : 'dark'];
  if(!dayPos) return toStops(T.midday);
  const p = clamp(dayPos.phaseProgress || 0, 0, 1);
  switch(dayPos.phase){
    case 'dawn': return toStops(mixPair(T.night, T.morning, smoothstep(p)));
    case 'morning': return toStops(p < 0.5 ? T.morning : mixPair(T.morning, T.midday, smoothstep((p - 0.5) / 0.5)));
    case 'midday': return toStops(T.midday);
    case 'afternoon': return toStops(mixPair(T.midday, T.golden, smoothstep(p)));
    case 'golden': return toStops(T.golden);
    case 'twilight': return toStops(mixPair(T.golden, T.dusk, smoothstep(p)));
    case 'night': {
      const ramp = clamp(dayPos.duskRampProgress != null ? dayPos.duskRampProgress : 1, 0, 1);
      return toStops(mixPair(T.dusk, T.night, smoothstep(ramp)));
    }
    default: return toStops(T.midday);
  }
}
