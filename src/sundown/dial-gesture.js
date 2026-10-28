/* ================= Day Arc v2: spin-to-preview gesture (PR 5) =================
   DAY_ARC_BRIEF.md §4.4/§4.4a: dragging the dial changes the previewed
   time; the sun-record marker follows the finger; the 24h circle wraps
   continuously with no end stops, multiple turns are fine, 1-minute
   resolution; a light haptic at sunrise/sunset; the NOW button returns to
   live time. §4.4's own "leaving Sundown always resets to live" no longer
   holds now that Sundown is a sheet rather than a tab — see this file's
   own 2026-10-21 note on setPreviewMinutes()'s entry below.
   Keyboard/VoiceOver: arrows +/-15 min, PageUp/PageDown +/-1h.

   setPreviewMinutes() is the one place S.previewMin is ever written from
   this view, and the dial is now the only control for it (the old
   #preview range slider and its "Back to live" button were removed), so
   everything writes through here instead of setting S.previewMin directly.

   Ken, 2026-10-21: closing the Sundown sheet (src/shell/sundown-sheet.js)
   no longer calls resetPreview() — a preview now survives the sheet being
   dismissed, by design, superseding the "leaving Sundown always resets
   to live" rule DAY_ARC_BRIEF.md §4.4 stated for the old tab-based
   Sundown. resetPreview() itself is unchanged — the NOW button still
   calls it directly, so that's still an explicit way back to live time.

   Mirrors player/scrub.js's own wireSpinToScrub() shape (pointerAngle +
   an angleDelta-style helper, pointerdown/pointermove/pointerup on
   window) — same gesture family, just degrees of rotation mapped to
   minutes-of-day instead of seconds of audio. prefers-reduced-motion is
   handled where each animation actually lives: the marker's own glow is
   a plain CSS @media query (25-day-arc-v2.css, no JS needed), and the sky
   crossfade checks REDUCED directly inside dial-view.js's
   updateSkyBackground() — neither needs anything from this file. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { nowClock } from './solar.js';
import { angleDeltaMinutes } from './dial.js';
import { renderDialView } from './dial-view.js';

const KEY_STEP_MIN = 15;
const KEY_PAGE_MIN = 60;

function pointerAngleDeg(clientX, clientY, rect) {
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  const dx = clientX - cx, dy = clientY - cy;
  // the inverse of dial-view.js's own polarOffset() — 0deg at top (noon),
  // 90deg at right (18:00), clockwise — so a sample straight off this
  // function feeds angleDeltaMinutes() with no sign flip needed.
  const deg = Math.atan2(dx, -dy) * 180 / Math.PI;
  return ((deg % 360) + 360) % 360;
}

// Whether the previewed moment crossed sun.rise or sun.set between two
// samples, in either direction — a single light haptic right at the
// crossing, per §4.4, not a buzz for the whole drag. Checks every
// calendar day's occurrence of each transit's own time of day, not just
// today's, since a long drag can span many days — the same reasoning
// dial.js's own nextOccurrence() loop uses for "more than one day away."
function crossedSunEvent(fromMs, toMs, sun) {
  if (!sun) return false;
  const lo = Math.min(fromMs, toMs), hi = Math.max(fromMs, toMs);
  for (const transit of [sun.rise, sun.set]) {
    if (!transit) continue;
    let probe = transit.getTime() - 2 * 24 * 3600000;
    while (probe <= hi + 24 * 3600000) {
      if (probe > lo && probe <= hi) return true;
      probe += 24 * 3600000;
    }
  }
  return false;
}

export function setPreviewMinutes(v) {
  S.previewMin = Math.round(v);
  const eyebrow = $('#sundownEyebrow');
  if (S.previewMin === 0) {
    if (eyebrow) { eyebrow.textContent = 'Now'; eyebrow.classList.remove('sd-previewing'); }
  } else {
    const label = nowClock().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (eyebrow) { eyebrow.textContent = 'Previewing · ' + label; eyebrow.classList.add('sd-previewing'); }
  }
  renderDialView();
}

export function resetPreview() {
  if (S.previewMin !== 0) setPreviewMinutes(0);
}

// Day has the one dial now, but `.day-dial`'s own querySelectorAll stays
// a selector rather than a fixed id — same reasoning `.sd-now-btn` just
// below still has with one button left.
export function wireDialGesture() {
  const dials = document.querySelectorAll('.day-dial');
  if (!dials.length) return;

  let gesture = null; // {dial, pointerId, lastAngle}

  dials.forEach(dial => {
    dial.addEventListener('pointerdown', e => {
      const rect = dial.getBoundingClientRect();
      gesture = { dial, pointerId: e.pointerId, lastAngle: pointerAngleDeg(e.clientX, e.clientY, rect) };
      try { dial.setPointerCapture(e.pointerId); } catch (_err) { /* unsupported */ }
      dial.classList.add('dragging');
    });

    dial.addEventListener('keydown', e => {
      let delta = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = KEY_STEP_MIN;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -KEY_STEP_MIN;
      else if (e.key === 'PageUp') delta = KEY_PAGE_MIN;
      else if (e.key === 'PageDown') delta = -KEY_PAGE_MIN;
      else return;
      e.preventDefault();
      setPreviewMinutes(S.previewMin + delta);
    });
  });

  window.addEventListener('pointermove', e => {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    e.preventDefault();
    const rect = gesture.dial.getBoundingClientRect();
    const ang = pointerAngleDeg(e.clientX, e.clientY, rect);
    const deltaMin = angleDeltaMinutes(ang, gesture.lastAngle);
    gesture.lastAngle = ang;
    const fromMs = nowClock().getTime();
    setPreviewMinutes(S.previewMin + deltaMin);
    if (navigator.vibrate && crossedSunEvent(fromMs, nowClock().getTime(), S.sun)) navigator.vibrate(10);
  }, { passive: false });

  const release = e => {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    gesture.dial.classList.remove('dragging');
    gesture = null;
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  // Every `.sd-now-btn` shares the exact same reset behavior.
  document.querySelectorAll('.sd-now-btn').forEach(btn => btn.addEventListener('click', resetPreview));
}
