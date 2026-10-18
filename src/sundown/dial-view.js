/* ================= Day Arc v2: Day view dial rendering (PR 4, gesture PR 5) =================
   The DOM-painting half of dial.js's dialStateAt() — renderDialView()
   reads S, computes the state once via dialStateAt(), and writes it into
   the new markup miziki.html's #sundownDayView carries (§4.1/§4.2). Called
   from player/clock.js's drawSun(), the one place already recomputing the
   day position on a steady ~220ms cadence while the app is visible — no
   new timer, same "reuse the loop that's already ticking" precedent
   skyGradientStops()/syncNychthemeronTheme() already follow there; also
   called directly from dial-gesture.js's setPreviewMinutes() on every
   drag/keyboard change, so a preview update never waits for the next
   tick.

   Always paints nowClock() (real clock, or real clock + S.previewMin
   while previewing — the same single state every other Sundown readout
   already follows), never a half-dragged intermediate angle: the drag
   gesture (dial-gesture.js) writes S.previewMin first, then calls this to
   repaint from that new, settled value, so there's exactly one source of
   truth for "what time is the dial showing" at any instant. The old
   day-arc SVG/phase-block/"Now playing at" row (miziki.html, DA3) stay in
   the DOM, hidden by CSS only (#sundownDayView .sdv1), so player/clock.js's
   own drawSun() keeps writing to them with zero code change there — the
   sidebar's own mirror ids (#sidePhaseName etc.) read those, not this. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { REDUCED } from '../util/motion.js';
import { nowClock } from './solar.js';
import { dialStateAt, soundCardsAt, toneCurveSamples } from './dial.js';

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

function verticalGradient(stops) {
  // §3.5B's own stop positions: 0, 28, 50, 66, 82, 100%.
  const pct = [0, 28, 50, 66, 82, 100];
  return 'linear-gradient(180deg, ' + stops.map((c, i) => c + ' ' + pct[i] + '%').join(', ') + ')';
}

// PR 6 gave the Sound view its own copy of this same crossfade
// (#sdSkySoundA/B) — RF9 (docs/12_REFINE.md) removed that view's own dial
// and sky background outright (Day has the one dial now), leaving a
// single caller below; kept parameterized by layer-id prefix and its own
// module-private front/lastPhase pair (via `state`, below) regardless,
// since that's what made the two independent in the first place and
// costs nothing with one caller.
function makeSkyUpdater(idPrefix) {
  const state = { front: 'A', lastPhase: null };
  return function updateSkyBackground(skyPhase, stops) {
    if (skyPhase === state.lastPhase) return;
    const isFirstPaint = state.lastPhase === null;
    state.lastPhase = skyPhase;
    const frontLayer = $('#' + idPrefix + state.front);
    if (isFirstPaint) {
      // The very first paint shows the real sky immediately, with no
      // transition and no 3-minute fade-in from blank — only a phase
      // *change* after that crossfades.
      if (frontLayer) { frontLayer.style.transition = 'none'; frontLayer.style.background = verticalGradient(stops); frontLayer.style.opacity = '1'; }
      return;
    }
    const backLayer = state.front === 'A' ? $('#' + idPrefix + 'B') : $('#' + idPrefix + 'A');
    if (!frontLayer || !backLayer) return;
    backLayer.style.background = verticalGradient(stops);
    // §4.4: "Respect prefers-reduced-motion (no... sky cross-fade
    // animation; values still update)" — the new gradient still lands on
    // the back layer so a render mid-crossfade is never wrong, but with
    // REDUCED it swaps instantly instead of fading over SKY_CROSSFADE_MS.
    const duration = REDUCED ? 0 : SKY_CROSSFADE_MS;
    backLayer.style.transition = frontLayer.style.transition = duration ? 'opacity ' + duration + 'ms linear' : 'none';
    backLayer.style.opacity = '1';
    frontLayer.style.opacity = '0';
    state.front = state.front === 'A' ? 'B' : 'A';
  };
}
const updateSkyBackground = makeSkyUpdater('sdSky');

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

function paintDayView(dial, st) {
  const ring = $('#dayDialRing');
  if (ring) ring.style.background = conicGradientFromRingStops(st.ringStops) || '';

  updateSkyBackground(st.skyPhase, st.skyStops);

  const time = $('#dayDialTime'), ampm = $('#dayDialAmPm');
  if (time) time.textContent = st.timeBig;
  if (ampm) ampm.textContent = st.timeAmPm + ' · ' + st.phaseLabel;

  // §4.4a: "the dial exposes role='slider' with aria-valuetext" — role
  // and the static valuemin/valuemax live on the element itself
  // (miziki.html); only the live value changes here, same as every other
  // per-tick text write in this function.
  dial.setAttribute('aria-valuenow', String(st.ariaValueNow));
  dial.setAttribute('aria-valuetext', st.ariaValueText);

  paintMarker($('#dayDialMarker'), dial, st.markerAngleDeg);
  paintMarker($('#dayDialSunriseTick'), dial, st.sunriseAngleDeg);
  paintMarker($('#dayDialSunsetTick'), dial, st.sunsetAngleDeg);

  const sunriseEl = $('#sdSunrise'), sunsetEl = $('#sdSunset'), nextEl = $('#sdNextEvent');
  if (sunriseEl) sunriseEl.textContent = 'SUNRISE ' + st.sunriseLabel;
  if (sunsetEl) sunsetEl.textContent = 'SUNSET ' + st.sunsetLabel;
  if (nextEl) nextEl.textContent = st.nextEvent ? st.nextEvent.label + ' ' + st.nextEvent.text : '—';
  // RF9 (docs/12_REFINE.md): the three reading cards (Platter/Sound/Sky)
  // this function used to paint here are gone -- the dial above is
  // already the one preview. st.platterPct/trend/paletteName stay on
  // dialStateAt()'s own return (dial.js, still covered by dial.test.js)
  // even though nothing paints them any more -- "cut is UI only."
}

const CARD_ID = { wow: 'sdCharWow', sat: 'sdCharSat', soft: 'sdCharSoft', comp: 'sdCharComp' };

// §4.3 item 4: "The white tick is the user's own Character setting. The
// amber fill is where the time of day has moved it." — paints each of
// soundCardsAt()'s four cards' word + track.
function paintCharCards(now) {
  const intensity = S.mode === 'pure' ? 'off' : S.charDrift;
  const cards = soundCardsAt(S.char, now, S.sun, intensity);
  for (const c of cards) {
    const idBase = CARD_ID[c.key];
    const wordEl = $('#' + idBase + 'Word'), fillEl = $('#' + idBase + 'Fill'), tickEl = $('#' + idBase + 'Tick');
    if (wordEl) wordEl.textContent = c.word;
    if (fillEl) fillEl.style.width = c.nowPct + '%';
    if (tickEl) tickEl.style.left = c.userPct + '%';
  }
}

// §4.3 item 5: "Tone today" card — a 24h curve (warmthAt(), bright at the
// top, warm at the bottom) with a dashed "now" line and a dot on the
// curve. The curve's own path is a plain polyline through
// toneCurveSamples()'s 49 points — smooth enough to read as a curve
// without needing a spline fit, since warmthAt() itself is already a
// smooth cosine (see dial.js's own comment on "do not copy its bezier").
const TONECURVE_W = 322, TONECURVE_H = 44, TONECURVE_TOP = 6, TONECURVE_BOTTOM = 38;
function paintToneCurve(now, st) {
  const svg = $('#sdToneCurveSvg');
  if (!svg) return;
  const pts = toneCurveSamples(now, S.sun);
  const xy = p => [p.frac * TONECURVE_W, TONECURVE_TOP + p.warmth * (TONECURVE_BOTTOM - TONECURVE_TOP)];
  const coords = pts.map(xy);
  const line = coords.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const fill = line + ' L ' + TONECURVE_W + ' ' + TONECURVE_H + ' L 0 ' + TONECURVE_H + ' Z';
  const lineEl = $('#sdToneCurveLine'), fillEl = $('#sdToneCurveFill');
  if (lineEl) lineEl.setAttribute('d', line);
  if (fillEl) fillEl.setAttribute('d', fill);

  const nowFrac = (now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60) / 1440;
  const nowX = nowFrac * TONECURVE_W;
  const nowY = TONECURVE_TOP + st.warmth * (TONECURVE_BOTTOM - TONECURVE_TOP);
  const nowLine = $('#sdToneCurveNowLine'), nowDot = $('#sdToneCurveNowDot');
  if (nowLine) { nowLine.setAttribute('x1', nowX.toFixed(1)); nowLine.setAttribute('x2', nowX.toFixed(1)); }
  if (nowDot) { nowDot.setAttribute('cx', nowX.toFixed(1)); nowDot.setAttribute('cy', nowY.toFixed(1)); }

  const word = $('#sdToneCurveWord');
  if (word) word.textContent = st.tone;
}

// RF9 (docs/12_REFINE.md): "the 'Tone today' chart shows only when drift
// isn't Off" -- a plain display toggle tied to S.charDrift, not a repaint,
// so it's called once at boot (wireCharacter()) and again on every drift
// click/restore (wireCharacter()'s own handler, storage/meta.js's
// applyPrefs()) rather than from the per-tick renderDialView() below,
// which has nothing to do with drift intensity.
export function updateToneCurveVisibility(){
  const wrap = $('#sdToneCurveWrap');
  if(wrap) wrap.style.display = S.charDrift === 'off' ? 'none' : '';
}

// renderDialView() — null-guarded on #dayDial the same way every other
// optional id in drawSun() already is, since the Sundown route's own
// markup (and this dial with it) isn't in every test harness that loads
// player/clock.js. RF9 (docs/12_REFINE.md) removed the Sound view's own
// second dial — paintCharCards()/paintToneCurve() paint unconditionally
// now (both already null-guard on their own ids) rather than behind that
// dial's own existence, since neither one is dial-dependent.
export function renderDialView() {
  const dayDial = $('#dayDial');
  if (!dayDial) return;

  const settings = { mode: S.mode, auto: S.auto, target: S.target, paceMode: S.pace };
  const now = nowClock();
  const st = dialStateAt(now, S.sun, settings);

  paintDayView(dayDial, st);
  paintCharCards(now);
  paintToneCurve(now, st);

  // §4.3/§4.4's own amber-when-previewing rule for the NOW button — by id
  // rather than `.sd-now-btn` querySelectorAll, since $() (util/dom.js) is
  // the one DOM entry point every test harness in this suite already stubs.
  const dayNowBtn = $('#sdNowBtn');
  if (dayNowBtn) dayNowBtn.classList.toggle('previewing', S.previewMin !== 0);
}
