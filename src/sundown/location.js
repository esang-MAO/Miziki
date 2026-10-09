import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { clamp } from '../util/math.js';
import { computeSun } from './solar.js';
import { drawSun } from '../player/clock.js';
import { queueSave } from '../main.js';

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

export function fallbackSun(){
  const d = new Date(); const set = new Date(d); set.setHours(20,10,0,0);
  S.sun.set = set; S.sun.dusk = new Date(set.getTime() + 26*60000); S.sun.ok = true;
}

export function toggleSleevePull(){
  S.sleevePullEnabled = !S.sleevePullEnabled;
  const b = $('#sleevePullBtn');
  b.textContent = S.sleevePullEnabled ? 'On' : 'Off';
  b.setAttribute('aria-pressed', String(S.sleevePullEnabled));
  queueSave();
}

export function toggleMotion(){
  const b = $('#motionBtn');
  if(S.motion.on){
    if(S.motion.watch !== null) navigator.geolocation.clearWatch(S.motion.watch);
    S.motion.on = false; S.motion.watch = null; S.motion.factor = 1; S.motion.speed = null;
    b.textContent = 'Off'; b.setAttribute('aria-pressed','false');
    $('#speedOut').textContent = '—'; applyVolume();
    $('#carModeDetails').style.display = 'none';
    return;
  }
  if(!navigator.geolocation){ $('#motionNote').textContent = 'This browser has no GPS access, so Car Mode cannot compensate for road noise here.'; return; }
  S.motion.on = true; b.textContent = 'On'; b.setAttribute('aria-pressed','true');
  $('#carModeDetails').style.display = 'block';
  S.motion.watch = navigator.geolocation.watchPosition(
    pos => {
      const s = pos.coords.speed;
      if(s === null || isNaN(s)){
        $('#speedOut').textContent = 'no reading';
        $('#motionNote').textContent = 'Your device is not reporting speed yet. This needs GPS and actual movement — it stays blank sitting still indoors.';
        return;
      }
      S.motion.speed = s;
      $('#speedOut').textContent = (s*2.23694).toFixed(0) + ' mph · ' + (s*3.6).toFixed(0) + ' km/h';
      S.motion.factor = S.motion.floor + (1 - S.motion.floor) * clamp(s / S.motion.max, 0, 1);
      applyVolume(1.1);   // glide across the ~1 s gap between readings
    },
    () => { $('#motionNote').textContent = 'Location permission was declined, so Car Mode is off.'; toggleMotion(); },
    {enableHighAccuracy:true, maximumAge:1000, timeout:20000}
  );
}

// output is unity gain, so loudness tracks the device's own volume; the only
// software shaping left on top of that is Car Mode's noise-compensation factor
export function applyVolume(glide){
  if(!S.nodes) return;
  const v = S.motion.on ? S.motion.factor : 1;
  S.nodes.master.gain.setTargetAtTime(v, S.ctx.currentTime, glide ? glide/3 : 0.05);
}

