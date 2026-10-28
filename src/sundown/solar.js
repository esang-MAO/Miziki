import { S } from '../state.js';
import { clamp } from '../util/math.js';
import { dayEvents, dayPosition } from './day.js';
import { rateAt } from './arc.js';

/* ================= solar ================= */
const rad = Math.PI/180;
function julian(date){ return date.valueOf()/86400000 + 2440587.5; }
function fromJulian(j){ return new Date((j - 2440587.5) * 86400000); }

// (DA1) Mean solar transit (Jt) and the sun's declination (dec, radians)
// for a date/longitude — shared by solarEvent() and the two exports below;
// none of them depend on latitude or a target altitude (only the
// hour-angle/cosW step, further down, does).
function solarTransit(date, lon){
  const lw = -lon;
  const J = julian(date);
  const n = Math.round(J - 2451545.0 - 0.0009 - lw/360);
  const Js = 2451545.0 + 0.0009 + lw/360 + n;
  const M = (357.5291 + 0.98560028*(Js - 2451545)) % 360;
  const C = 1.9148*Math.sin(M*rad) + 0.02*Math.sin(2*M*rad) + 0.0003*Math.sin(3*M*rad);
  const lam = (M + C + 180 + 102.9372) % 360;
  const Jt = Js + 0.0053*Math.sin(M*rad) - 0.0069*Math.sin(2*lam*rad);
  const dec = Math.asin(Math.sin(lam*rad) * Math.sin(23.4397*rad));
  return { Jt, dec };
}

// `rising` picks which side of solar noon — the same hour-angle equation
// either way, Jt - w/360 for the rising (dawn/sunrise) event vs Jt + w/360
// for the setting (sunset/dusk) one. Defaults to false (setting) so a
// 3-argument call (no `rising`) keeps its old meaning.
export function solarEvent(date, lat, lon, altitude, rising = false){
  const { Jt, dec } = solarTransit(date, lon);
  const cosW = (Math.sin(altitude*rad) - Math.sin(lat*rad)*Math.sin(dec)) / (Math.cos(lat*rad)*Math.cos(dec));
  if(cosW > 1 || cosW < -1) return null;
  const w = Math.acos(cosW)/rad;
  return fromJulian(rising ? Jt - w/360 : Jt + w/360);
}

// Solar noon itself — day.js's dayEvents() "noon" event. Unlike
// solarEvent(), this never returns null: the sun transits the local
// meridian every day regardless of latitude, even through polar day and
// polar night, so it's also day.js's one fixed point for classifying a
// polar date (see solarAltitudeAtNoon below).
export function solarNoon(date, lon){
  return fromJulian(solarTransit(date, lon).Jt);
}

// The sun's own highest altitude on this date/location, in degrees, at
// solar noon — 90° minus the angular distance between latitude and
// declination, the standard identity for a body crossing the local
// meridian. day.js's dayPosition() uses this only when solarEvent(...,
// altitude) returns null (the sun never crosses that altitude at all) to
// tell polar day (always above -0.833°) from polar night (never above
// it) apart — solarEvent's own null return collapses that distinction.
export function solarAltitudeAtNoon(date, lat, lon){
  const decDeg = solarTransit(date, lon).dec / rad;
  return 90 - Math.abs(lat - decDeg);
}

// (DA4) Device-only, no-coordinates cache theme-boot.js reads to resolve
// the first-paint theme when the saved appearance choice is Nychthemeron.
// Location is never stored (CLAUDE.md, the privacy policy), so
// theme-boot.js — which runs before any module here, before S.sun exists
// at all — can't compute the sun itself; this is the one small fact about
// today it's allowed to remember instead. Written here (and from
// location.js's fallbackSun()) rather than in ui/theme.js, since this is
// where "today's" rise/set are actually computed, real or fallback alike.
// `date` is only the cache's own freshness check (today's toDateString(),
// compared against theme-boot.js's own reader) — never a coordinate: no
// lat/lon is ever written here. The key literal is duplicated in
// theme-boot.js rather than imported, since that file has to stay
// import-free to run as a plain classic script.
export const SUN_TIMES_STORAGE_KEY = 'miziki-sun-times';

export function persistSunTimesCache(rise, set){
  if(!rise || !set) return;
  try {
    localStorage.setItem(SUN_TIMES_STORAGE_KEY, JSON.stringify({
      date: new Date().toDateString(), rise: rise.toISOString(), set: set.toISOString(),
    }));
  } catch(_e) {}
}

// (DA1) computeSun() fills the full day model, not just tonight's
// sunset/dusk — dayEvents() is day.js's own pure function, a real
// circular import with it (day.js imports solarEvent/solarNoon/
// solarAltitudeAtNoon from here), the same peer-import shape as
// engine.js/transport.js. Recomputed at launch, when location arrives
// (src/sundown/location.js), at local midnight, and on returning to the
// foreground (src/main.js's boot sequence) — that's what keeps "today's"
// dawn/rise/noon/set/dusk from ever going stale, not anything in
// dayEvents()/dayPosition()'s own math.
export function computeSun(){
  const {lat, lon} = S.sun;
  if(lat === null){ S.sun.ok = false; return; }
  const now = new Date();
  const ev = dayEvents(now, lat, lon);
  if(!ev.set || !ev.dusk){ S.sun.ok = false; return; }
  // Guards against an implausibly short set-to-dusk window; dawn/rise get
  // no equivalent guard — a genuinely degenerate dawn/rise gap is covered
  // by dayPosition()'s own polar fallback instead, not a hand-tuned
  // minimum like this one.
  if(ev.dusk - ev.set < 60000) ev.dusk = new Date(ev.set.getTime() + 25*60000);
  S.sun.dawn = ev.dawn; S.sun.rise = ev.rise; S.sun.noon = ev.noon;
  S.sun.set = ev.set; S.sun.dusk = ev.dusk; S.sun.altitudeAtNoon = ev.altitudeAtNoon;
  S.sun.ok = true;
  persistSunTimesCache(ev.rise, ev.set);
}

export function nowClock(){
  const t = Date.now() + S.previewMin*60000;
  return new Date(t);
}

// Shared by currentDayPosition()/realDayPosition() below — dayPosition()'s
// own "no data yet" default (see day.js's own comment on this exact shape).
const FALLBACK_DAY_POSITION = { phase: 'midday', phaseProgress: 0, nightness: 0, rateProgress: 0, duskRampProgress: 0 };

// Exported for drawSun()'s own Dawn/Morning readout text
// (src/player/clock.js) — the one place outside this file that needs
// `phase`/`phaseProgress` directly, rather than the rateProgress-only
// view sunProgress()/easedProgress() give everyone else.
export function currentDayPosition(){
  if(!S.sun.ok) return FALLBACK_DAY_POSITION;
  return dayPosition(nowClock(), S.sun);
}

// DA5 (docs/DAY_ARC.md): the real day position, bypassing S.previewMin —
// nowClock() folds the preview offset in on purpose (every Sundown readout,
// including the Day drift blend, is supposed to follow Preview the day),
// but a *counted* play must never be attributed to a previewed time, or
// dragging the slider could fabricate or skew the listening-rhythm stat.
// history/played.js's incrementTrackPlay() is the one real caller.
export function realDayPosition(){
  if(!S.sun.ok) return FALLBACK_DAY_POSITION;
  return dayPosition(new Date(), S.sun);
}

// Used by drawSun()'s day-arc dot position, the sky animation, and
// easedProgress() below — just dayPosition()'s own rateProgress,
// continuous across the whole day.
export function sunProgress(){
  return currentDayPosition().rateProgress;
}

const smooth = p => p*p*(3 - 2*p);
// Window spreads a transition evenly across its own window; Moment holds
// back, then a felt move near the very end — for the dusk (twilight)
// side. The dawn side mirrors it: "risen" (0 at dawn, 1 at sunrise) is
// the dawn-local equivalent of the dusk side's own raw progress, so the
// identical pace() shape applies to it too, then maps back to "how much
// night-rate remains" (1 - paced risen) — a felt *rise* near sunrise
// under Moment, held back through most of dawn, mirroring "held back,
// then a felt drop near the end" the other way.
function pace(local){
  return S.pace === 'moment' ? smooth(clamp((local - 0.62)/0.38, 0, 1)) : smooth(local);
}

export function easedProgress(){
  const pos = currentDayPosition();
  if(pos.phase === 'dawn'){
    const risen = 1 - pos.rateProgress;
    return 1 - pace(risen);
  }
  if(pos.phase === 'twilight') return pace(pos.rateProgress);
  // every other phase has rateProgress already exactly 0 (day) or 1
  // (night) — pace()/smooth() are no-ops at either end regardless of
  // S.pace, so there's nothing to reshape.
  return pos.rateProgress;
}

// Pure means untouched: no character chain, and no rate change either —
// this is the one place the rate-always-1-in-Pure rule lives. Sundown
// (auto or manual) only ever applies in Vinyl. Manual (auto off) is a
// separate override that wins over the day-arc curve entirely — this
// function's job is only the auto path.
//
// (Day Arc v2, DAY_ARC_BRIEF.md) The auto path goes through arc.js's
// rateAt(): a down-leg/floor/hold shape (continuity confirmed by
// tests/unit/arc.test.js's join tests) plus a fixed-window recovery leg
// before sunrise (§3.3). nowClock() (not a bare `new Date()`) is what
// makes Preview the day audible here.
export function computeRate(){
  if(S.mode === 'pure') return 1;
  if(!S.auto) return S.manualRate;
  return rateAt(nowClock(), S.sun, { target: S.target, paceMode: S.pace });
}

/* (RF9, docs/12_REFINE.md) "How deep the night goes" (Off/Gentle/Medium/
   Deep) collapses Auto/Manual, the full-night-rate setting and the
   Window/Moment pacing row onto one choice. These two pure helpers are
   the mapping both directions need — src/wiring/sundown.js's click
   handler (S.auto/S.target -> the pressed button + its caption) and
   src/storage/meta.js's restore-time sync (so a reload reflects a saved
   choice). computeRate() above is a separate concern — UI only here. */
export const DEPTH_TARGETS = { gentle: 0.85, medium: 0.80, deep: 0.75 };
const DEPTH_LABELS = { gentle: 'Gentle', medium: 'Medium', deep: 'Deep' };

// Off is S.auto === false; among the three auto targets, a value within
// half a hundredth of 0.85/0.75 is unambiguously Gentle/Deep (every write
// this UI makes sets one of the three exactly) and anything else (0.80,
// or a saved value that doesn't match either edge) reads as Medium — the
// safest fallback for a value this control was never built to represent.
export function depthKeyFor(auto, target){
  if(!auto) return 'off';
  if(Math.abs(target - DEPTH_TARGETS.gentle) < 0.005) return 'gentle';
  if(Math.abs(target - DEPTH_TARGETS.deep) < 0.005) return 'deep';
  return 'medium';
}

// (RF27, docs/12_REFINE.md) "Show the number next to the sound" — wherever
// an actual rate change is shown, it reads as a percentage plus an
// approximate semitone count in simple quarter-semitone fractions
// ("-2.4% ~= -1/4 semitone"), never a raw multiplier ("0.80x") or a bare
// decimal semitone count ("3.9 st"). One helper so every reader (the
// depth caption just below, player/clock.js's #trackSpecPhase) shows the
// same number the same way. Only meant for an actual change (rate !== 1)
// — a caller that also needs a "full speed" or "off" label writes that
// text itself.
const SEMITONE_QUARTER_GLYPH = ['', '¼', '½', '¾']; // '', ¼, ½, ¾
export function formatRateChange(rate){
  const pct = (rate - 1) * 100;
  const semis = Math.abs(12 * Math.log2(rate));
  const quarters = Math.round(semis * 4);
  const whole = Math.floor(quarters / 4);
  const semisText = (whole ? String(whole) : '') + SEMITONE_QUARTER_GLYPH[quarters % 4] || '0';
  // Singular reads right only up through a whole semitone (¼, ½, ¾, 1) —
  // "0 semitones" and "1¼ semitones" both want the plural.
  const noun = (quarters >= 1 && quarters <= 4) ? 'semitone' : 'semitones';
  const sign = quarters === 0 ? '' : (pct < 0 ? '−' : '+');
  const pctAbs = Math.abs(pct) < 0.05 ? 0 : Math.abs(pct);
  return sign + pctAbs.toFixed(1) + '% ≈ ' + sign + semisText + ' ' + noun;
}

// "the caption names the current one in rate and semitones" (RF9; reworded
// RF27 to the percentage+semitone format formatRateChange() builds).
export function depthCaptionFor(key, target){
  if(key === 'off') return 'Off — full speed, no change at night.';
  return (DEPTH_LABELS[key] || 'Medium') + ' — ' + formatRateChange(target);
}
