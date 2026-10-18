import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { computeSun, persistSunTimesCache } from './solar.js';
import { drawSun } from '../player/clock.js';
import { queueSave } from '../storage/meta.js';

/* ================= location & motion ================= */
export function askLocation(){
  if(!navigator.geolocation){ $('#locNote').textContent = 'This browser has no location access, so Miziki is using a stand-in sunset of 8:10 pm.'; fallbackSun(); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      S.sun.lat = pos.coords.latitude; S.sun.lon = pos.coords.longitude;
      computeSun(); drawSun();
      $('#locNote').textContent = 'Sunset times come from your location and today\'s date, worked out on the device.';
    },
    () => { $('#locNote').innerHTML = 'Location is off, so tonight is a stand-in: sunset 8:10 pm, dusk 8:36 pm. <button class="cta ghost" id="retryLoc" style="margin-top:10px">Use my location</button>';
            fallbackSun(); drawSun();
            const r = $('#retryLoc'); if(r) r.addEventListener('click', askLocation); },
    {timeout:8000, maximumAge:600000}
  );
}

// DA1 (docs/DAY_ARC.md): fills all five day-model events, not just
// tonight's sunset/dusk — the doc's own fixed stand-in times (dawn 6:20,
// sunrise 6:50, noon 1:00 pm, sunset 8:10 pm — unchanged from before DA1
// — dusk 8:36 pm, the same 26-minute gap sunset/dusk already had) for
// whenever location is unavailable. Since DA4, also writes the same
// device-only sun-times cache computeSun() does (solar.js's own
// persistSunTimesCache()) — "written whenever events are computed," per
// that step's own doc, and these fixed stand-ins count: without this, a
// device that never grants location would carry a stale (or entirely
// absent) cache forever, leaving theme-boot.js's own freshness check
// ("is this cache from today") permanently false and always falling
// through to its own hardcoded 6:50 am/8:10 pm default — which happens
// to equal these same two numbers anyway, so this call is a belt-and-
// suspenders freshness stamp more than a behavior change for that one
// device, not a correctness fix on its own.
export function fallbackSun(){
  const d = new Date();
  const at = (h, m) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
  S.sun.dawn = at(6, 20); S.sun.rise = at(6, 50); S.sun.noon = at(13, 0);
  S.sun.set = at(20, 10); S.sun.dusk = at(20, 36);
  S.sun.altitudeAtNoon = null;
  S.sun.ok = true;
  persistSunTimesCache(S.sun.rise, S.sun.set);
}

// DA1 (docs/DAY_ARC.md): recompute the day model at local midnight so a
// session left open overnight never plays the night through on a stale
// "today's" dawn/dusk (the exact bug the doc's own "stale times" gap
// names) — a recursive setTimeout rather than setInterval, so each
// firing is scheduled from the real current time and the daily cadence
// never drifts. src/wiring/lifecycle.js's own visibilitychange handler
// covers the other half: a session that was backgrounded across midnight
// and never had this timer actually fire while hidden.
export function scheduleMidnightRecompute(){
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 5, 0); // a few seconds past local midnight, not exactly on it
  setTimeout(() => {
    computeSun(); drawSun();
    scheduleMidnightRecompute();
  }, next.getTime() - now.getTime());
}

export function toggleSleevePull(){
  S.sleevePullEnabled = !S.sleevePullEnabled;
  const b = $('#sleevePullBtn');
  b.textContent = S.sleevePullEnabled ? 'On' : 'Off';
  b.setAttribute('aria-pressed', String(S.sleevePullEnabled));
  queueSave();
}

// RF6 (docs/12_REFINE.md): Car Mode (toggleMotion, the GPS speed watch) is
// removed outright — this is just the master gain now, at unity (or the
// sleep-timer fade, the one other thing that still passes a glide here).
export function applyVolume(glide){
  if(!S.nodes) return;
  S.nodes.master.gain.setTargetAtTime(1, S.ctx.currentTime, glide ? glide/3 : 0.05);
}

