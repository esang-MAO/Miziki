import { S } from '../state.js';
import { clamp } from '../util/math.js';

/* ================= solar ================= */
const rad = Math.PI/180;
function julian(date){ return date.valueOf()/86400000 + 2440587.5; }
function fromJulian(j){ return new Date((j - 2440587.5) * 86400000); }

export function solarEvent(date, lat, lon, altitude){
  const lw = -lon;
  const J = julian(date);
  const n = Math.round(J - 2451545.0 - 0.0009 - lw/360);
  const Js = 2451545.0 + 0.0009 + lw/360 + n;
  const M = (357.5291 + 0.98560028*(Js - 2451545)) % 360;
  const C = 1.9148*Math.sin(M*rad) + 0.02*Math.sin(2*M*rad) + 0.0003*Math.sin(3*M*rad);
  const lam = (M + C + 180 + 102.9372) % 360;
  const Jt = Js + 0.0053*Math.sin(M*rad) - 0.0069*Math.sin(2*lam*rad);
  const dec = Math.asin(Math.sin(lam*rad) * Math.sin(23.4397*rad));
  const cosW = (Math.sin(altitude*rad) - Math.sin(lat*rad)*Math.sin(dec)) / (Math.cos(lat*rad)*Math.cos(dec));
  if(cosW > 1 || cosW < -1) return null;
  const w = Math.acos(cosW)/rad;
  return fromJulian(Jt + w/360);
}

export function computeSun(){
  const {lat, lon} = S.sun;
  if(lat === null){ S.sun.ok = false; return; }
  const now = new Date();
  let set = solarEvent(now, lat, lon, -0.833);
  let dusk = solarEvent(now, lat, lon, -6);
  if(!set || !dusk){ S.sun.ok = false; return; }
  if(dusk - set < 60000) dusk = new Date(set.getTime() + 25*60000);
  S.sun.set = set; S.sun.dusk = dusk; S.sun.ok = true;
}

export function nowClock(){
  const t = Date.now() + S.previewMin*60000;
  return new Date(t);
}

export function sunProgress(){
  if(!S.sun.ok) return 0;
  const now = nowClock().getTime();
  const a = S.sun.set.getTime(), b = S.sun.dusk.getTime();
  if(now <= a) return 0;
  if(now >= b) return 1;
  return (now - a) / (b - a);
}

const smooth = p => p*p*(3 - 2*p);
export function easedProgress(){
  const p = sunProgress();
  if(S.pace === 'moment'){ return smooth(clamp((p - 0.62)/0.38, 0, 1)); }
  return smooth(p);
}

// Pure means untouched: no character chain, and no rate change either —
// Sundown (auto or manual) only ever applies in Vinyl.
export function computeRate(){
  if(S.mode === 'pure') return 1;
  if(!S.auto) return S.manualRate;
  const e = easedProgress();
  return Math.pow(2, e * Math.log2(S.target));
}
