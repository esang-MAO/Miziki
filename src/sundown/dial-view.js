/* ================= Day Arc v2: Day view dial rendering (PR 4) =================
   The DOM-painting half of dial.js's dialStateAt() — renderDialView()
   reads S, computes the state once via dialStateAt(), and writes it into
   the new markup miziki.html's #sundownDayView carries (§4.1/§4.2). Called
   from player/clock.js's drawSun(), the one place already recomputing the
   day position on a steady ~220ms cadence while the app is visible — no
   new timer, same "reuse the loop that's already ticking" precedent
   skyGradientStops()/syncNychthemeronTheme() already follow there.

   No gesture yet (PR 5's own job, DAY_ARC_BRIEF.md §8) — this always
   paints the *real* clock (nowClock(), so Preview the day still moves it,
   same as every other Sundown readout), never a dragged preview angle,
   and there is no NOW button or hint row here yet (§4.2 items 4-5's
   touch-interaction half is PR 5's). The old day-arc SVG/phase-block/
   "Now playing at" row (miziki.html, DA3) stay in the DOM, hidden by CSS
   only (#sundownDayView .sdv1), so player/clock.js's own drawSun() keeps
   writing to them with zero code change there — the sidebar's own mirror
   ids (#sidePhaseName etc.) read those, not this. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { nowClock } from './solar.js';
import { dialStateAt } from './dial.js';

// The dial's own ring sits at the outer 17% of its radius (§4.1) — the
// sun-record marker and the sunrise/sunset ticks are drawn at the ring's
// own mid-radius, a fraction of the dial's half-size, kept here as a
// named constant rather than repeated at each call site below.
const RING_MID_RADIUS_FRAC = 0.915;

function polarOffset(angleDeg, radiusPx) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: radiusPx * Math.sin(rad), y: -radiusPx * Math.cos(rad) };
}

function paintMarker(el, dial, angleDeg) {
  if (!el || angleDeg === null) return;
  const r = (dial.clientWidth / 2) * RING_MID_RADIUS_FRAC;
  const { x, y } = polarOffset(angleDeg, r);
  el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
}

// §3.5B: "cross-fade between phases over a few minutes; never hard-cut."
// Two stacked layers (#sdSkyA/#sdSkyB, miziki.html), each a plain static
// vertical gradient — whichever one currently holds the *new* phase's
// gradient fades in over SKY_CROSSFADE_MS while the other fades out, via
// a plain CSS opacity transition (interpolating two static gradients
// this way, rather than animating the gradient itself, works identically
// in every browser this app supports, unlike animating gradient stops
// directly). Recomputed only when the sky phase actually changes — the
// same "don't touch the DOM for a no-op" guard drawSun()'s own
// --sky1/--sky2 write already uses.
const SKY_CROSSFADE_MS = 180000;
let skyLayerFront = 'A';
let lastSkyPhase = null;

function verticalGradient(stops) {
  // §3.5B's own stop positions: 0, 28, 50, 66, 82, 100%.
  const pct = [0, 28, 50, 66, 82, 100];
  return 'linear-gradient(180deg, ' + stops.map((c, i) => c + ' ' + pct[i] + '%').join(', ') + ')';
}

function updateSkyBackground(skyPhase, stops) {
  if (skyPhase === lastSkyPhase) return;
  const isFirstPaint = lastSkyPhase === null;
  lastSkyPhase = skyPhase;
  const frontLayer = $('#sdSky' + skyLayerFront);
  if (isFirstPaint) {
    // The very first paint shows the real sky immediately, with no
    // transition and no 3-minute fade-in from blank — only a phase
    // *change* after that crossfades.
    if (frontLayer) { frontLayer.style.transition = 'none'; frontLayer.style.background = verticalGradient(stops); frontLayer.style.opacity = '1'; }
    return;
  }
  const backLayer = skyLayerFront === 'A' ? $('#sdSkyB') : $('#sdSkyA');
  if (!frontLayer || !backLayer) return;
  backLayer.style.background = verticalGradient(stops);
  backLayer.style.transition = 'opacity ' + SKY_CROSSFADE_MS + 'ms linear';
  frontLayer.style.transition = 'opacity ' + SKY_CROSSFADE_MS + 'ms linear';
  backLayer.style.opacity = '1';
  frontLayer.style.opacity = '0';
  skyLayerFront = skyLayerFront === 'A' ? 'B' : 'A';
}

function conicGradientFromRingStops(stops) {
  if (!stops || !stops.length) return null;
  // skyRingStops() already returns {min, color} sorted by minute-of-day
  // (0..1440); `from 180deg` rotates the gradient's own 0% so min=0
  // (midnight) lands at the bottom and min=720 (noon) lands at the top —
  // the same mapping dial.js's angleDegAt() uses, so the ring and the
  // marker/ticks always agree on where "now" sits.
  const parts = stops.map(s => s.color + ' ' + ((s.min / 1440) * 100).toFixed(2) + '%');
  return 'conic-gradient(from 180deg at 50% 50%, ' + parts.join(', ') + ')';
}

// renderDialView() — null-guarded on its own host element the same way
// every other optional id in drawSun() already is, since #dayDial only
// exists in the Sundown route's own markup, not in every test harness
// that loads player/clock.js.
export function renderDialView() {
  const dial = $('#dayDial');
  if (!dial) return;

  const settings = { mode: S.mode, auto: S.auto, target: S.target, paceMode: S.pace };
  const st = dialStateAt(nowClock(), S.sun, settings);

  const ring = $('#dayDialRing');
  if (ring) {
    const gradient = conicGradientFromRingStops(st.ringStops);
    ring.style.background = gradient || '';
  }

  updateSkyBackground(st.skyPhase, st.skyStops);

  const time = $('#dayDialTime'), ampm = $('#dayDialAmPm');
  if (time) time.textContent = st.timeBig;
  if (ampm) ampm.textContent = st.timeAmPm + ' · ' + st.phaseLabel;

  paintMarker($('#dayDialMarker'), dial, st.markerAngleDeg);
  paintMarker($('#dayDialSunriseTick'), dial, st.sunriseAngleDeg);
  paintMarker($('#dayDialSunsetTick'), dial, st.sunsetAngleDeg);

  const sunriseEl = $('#sdSunrise'), sunsetEl = $('#sdSunset'), nextEl = $('#sdNextEvent');
  if (sunriseEl) sunriseEl.textContent = 'SUNRISE ' + st.sunriseLabel;
  if (sunsetEl) sunsetEl.textContent = 'SUNSET ' + st.sunsetLabel;
  if (nextEl) nextEl.textContent = st.nextEvent ? st.nextEvent.label + ' ' + st.nextEvent.text : '—';

  const platterEl = $('#sdCardPlatter'), platterSub = $('#sdCardPlatterSub');
  if (platterEl) platterEl.textContent = st.platterPct + '%';
  if (platterSub) platterSub.textContent = st.trend;

  const soundEl = $('#sdCardSound'), soundSub = $('#sdCardSoundSub');
  if (soundEl) soundEl.textContent = st.tone;
  if (soundSub) soundSub.textContent = 'Vinyl · ' + (S.charDrift === 'full' ? 'Full' : S.charDrift === 'off' ? 'Off' : 'Subtle');

  const skyEl = $('#sdCardSky'), skySub = $('#sdCardSkySub');
  if (skyEl) skyEl.textContent = st.paletteName;
  if (skySub) skySub.textContent = st.paletteName.toLowerCase() + ' palette';
}
