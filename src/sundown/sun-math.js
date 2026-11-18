/* ================= sun math ================= */
// BD19 (docs/38_BEFORE_THE_DOMAIN.md): split out of solar.js so day.js can
// import solarEvent/solarNoon/solarAltitudeAtNoon without importing
// solar.js itself -- solar.js's own dayEvents()/dayPosition() import from
// day.js, so day.js importing back from solar.js was a real circular
// import (plan 35's first-named easy break). This file has no imports and
// nothing here depends on day.js, so it can sit underneath both.
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
