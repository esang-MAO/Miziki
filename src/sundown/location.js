import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { computeSun, persistSunTimesCache, SUN_TIMES_STORAGE_KEY } from './solar.js';
import { standInEvents } from './day.js';
import { drawSun } from '../player/clock.js';
import { queueSave } from '../storage/meta.js';

/* ================= location & motion ================= */
// RF7 (docs/12_REFINE.md): the localStorage flag that remembers a real
// grant, so a returning user's next boot can re-ask silently (the browser
// already decided, so no OS dialog appears) instead of needing the
// "Use my location" button again. Try/catch-wrapped like every other
// localStorage mirror in this app (theme-boot.js's own, the sun-times
// cache) — never part of prefs/backup, purely a per-device nicety.
const LOCATION_GRANTED_KEY = 'miziki-location-granted';

export function askLocation(){
  if(!navigator.geolocation){ $('#locNote').textContent = 'This browser has no location access, so Miziki is using a stand-in sunset of 8:10 pm.'; fallbackSun(); return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      try{ localStorage.setItem(LOCATION_GRANTED_KEY, '1'); }catch(_e){}
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

// RF7 (docs/12_REFINE.md): the one boot-time entry point — never prompts
// for location itself (that's the OS permission dialog fighting a brand-
// new user before they've even seen the library). A device that granted
// location before re-asks silently via the real askLocation() (no dialog,
// since the browser already decided); everyone else just sees the same
// "Use my location" prompt the denied path already showed, with its
// button wired to askLocation() — the only place that actually asks.
export function initLocationPrompt(){
  let granted = false;
  try{ granted = localStorage.getItem(LOCATION_GRANTED_KEY) === '1'; }catch(_e){}
  if(granted){ askLocation(); return; }
  const note = $('#locNote');
  if(note) note.innerHTML = 'Location is off, so tonight is a stand-in: sunset 8:10 pm, dusk 8:36 pm. <button class="cta ghost" id="retryLoc" style="margin-top:10px">Use my location</button>';
  const r = $('#retryLoc'); if(r) r.addEventListener('click', askLocation);
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
//
// Since the launch-intro rework: today's real sunrise/sunset, when the
// sun-times cache already has them from an earlier fix today, replace the
// fixed stand-ins (day.js's standInEvents()), so the first frames — the
// launch intro's sky among them — follow the real time of day instead of
// assuming an 8:10 pm sunset until location answers.
export function fallbackSun(){
  let cache = null;
  try{ cache = JSON.parse(localStorage.getItem(SUN_TIMES_STORAGE_KEY) || 'null'); }catch(_e){}
  const ev = standInEvents(new Date(), cache);
  S.sun.dawn = ev.dawn; S.sun.rise = ev.rise; S.sun.noon = ev.noon;
  S.sun.set = ev.set; S.sun.dusk = ev.dusk;
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

// This is just the master gain, at unity (or the sleep-timer fade, the
// one other thing that still passes a glide here).
export function applyVolume(glide){
  if(!S.nodes) return;
  S.nodes.master.gain.setTargetAtTime(1, S.ctx.currentTime, glide ? glide/3 : 0.05);
}

