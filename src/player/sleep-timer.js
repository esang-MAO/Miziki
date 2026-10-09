import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { applyVolume } from '../sundown/location.js';
import { pause } from './transport.js';
import { drawTime } from './clock.js';
import { setPathNote } from '../ui/path-note.js';

/* ================= sleep timer (SLEEP spec §5) =================
   Session-only (S.sleep is never persisted). Time mode is deadline-based —
   always Date.now() vs a fixed target, never a counted-down interval — so
   it survives a throttled/hidden page: checked by its own setTimeout chain
   AND, as a fallback, from tick() (which already runs every frame when
   visible and every second when hidden). End-of-track/album modes hook
   into advance()'s automatic-advance path instead and never fade. */
const SLEEP_FADE_MS = 20000;

function clearSleepTimer(){ if(S.sleep.timer) clearTimeout(S.sleep.timer); S.sleep.timer = null; }

export function updateSleepUI(){
  const btn = $('#sleepTimerBtn');
  if(!btn) return;
  if(S.sleep.mode === 'time' && S.sleep.at){
    const mins = Math.max(1, Math.ceil((S.sleep.at - Date.now())/60000));
    btn.textContent = '🌙 Sleep: ' + mins + ' min';
  } else if(S.sleep.mode === 'track') btn.textContent = '🌙 Sleep: End of track';
  else if(S.sleep.mode === 'album') btn.textContent = '🌙 Sleep: End of album';
  else btn.textContent = '🌙 Sleep Timer';
}

function sleepCancelGainAutomation(){
  if(!S.ctx || !S.nodes || !S.nodes.master) return;
  try{ S.nodes.master.gain.cancelScheduledValues(S.ctx.currentTime); }catch(e){}
}

export function stopSleepState(){
  clearSleepTimer();
  sleepCancelGainAutomation();
  S.sleep.mode = null; S.sleep.at = null; S.sleep.fading = false;
  applyVolume();
  updateSleepUI();
}

// no fade, no put-away — just stop where advance() would otherwise have moved on
export function sleepStopPlayback(){
  pause(); S.pos = 0; drawTime();
  setPathNote('Sleep timer ended.');
  stopSleepState();
}

function sleepStartFade(remainMs){
  S.sleep.fading = true;
  if(!S.ctx || !S.nodes || !S.nodes.master) return;
  const g = S.nodes.master.gain, now = S.ctx.currentTime;
  try{
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + Math.max(0.1, remainMs/1000));
  }catch(e){}
}

function sleepTimeExpired(){
  clearSleepTimer();
  // already paused manually: nothing to fade or stop, just clear the state
  if(S.playing){ pause(); S.pos = 0; drawTime(); }
  sleepCancelGainAutomation();
  S.sleep.fading = false;
  applyVolume();
  setPathNote('Sleep timer ended.');
  S.sleep.mode = null; S.sleep.at = null;
  updateSleepUI();
}

export function sleepCheckDeadline(){
  if(S.sleep.mode !== 'time' || !S.sleep.at) return;
  const remain = S.sleep.at - Date.now();
  if(remain <= 0){ sleepTimeExpired(); return; }
  if(remain <= SLEEP_FADE_MS && S.playing && !S.sleep.fading) sleepStartFade(remain);
  updateSleepUI();
}

function scheduleSleepCheck(){
  clearSleepTimer();
  if(S.sleep.mode !== 'time' || !S.sleep.at) return;
  const remain = Math.max(0, S.sleep.at - Date.now());
  const next = remain > SLEEP_FADE_MS ? (remain - SLEEP_FADE_MS) : remain;
  S.sleep.timer = setTimeout(() => {
    sleepCheckDeadline();
    if(S.sleep.mode === 'time') scheduleSleepCheck();
  }, Math.max(250, Math.min(next, 5000)));
}

function startSleepTimer(mode, minutes){
  clearSleepTimer();
  sleepCancelGainAutomation();
  S.sleep.fading = false;
  applyVolume();
  S.sleep.mode = mode;
  S.sleep.at = mode === 'time' ? Date.now() + minutes * 60000 : null;
  if(mode === 'time') scheduleSleepCheck();
  updateSleepUI();
  setPathNote(mode === 'time' ? ('Sleeping in ' + minutes + ' min')
    : mode === 'track' ? 'Sleeping at end of track' : 'Sleeping at end of album');
}

const SLEEP_MINUTE_OPTIONS = [15, 30, 45, 60, 90];
function renderSleepOptions(){
  const host = $('#sleepOptions'); host.innerHTML = '';
  const currentMins = S.sleep.mode === 'time' ? Math.round((S.sleep.at - Date.now())/60000) : null;
  SLEEP_MINUTE_OPTIONS.forEach(mins => {
    const b = el('button','cta' + (currentMins === mins ? '' : ' ghost'), mins + ' min');
    b.addEventListener('click', ()=>{ startSleepTimer('time', mins); closeSleepSheet(); });
    host.appendChild(b);
  });
  const trackBtn = el('button','cta' + (S.sleep.mode === 'track' ? '' : ' ghost'), 'End of track');
  trackBtn.addEventListener('click', ()=>{ startSleepTimer('track'); closeSleepSheet(); });
  host.appendChild(trackBtn);
  const albumBtn = el('button','cta' + (S.sleep.mode === 'album' ? '' : ' ghost'), 'End of album');
  albumBtn.addEventListener('click', ()=>{ startSleepTimer('album'); closeSleepSheet(); });
  host.appendChild(albumBtn);
  const offBtn = el('button','cta ghost', 'Off');
  offBtn.addEventListener('click', ()=>{ stopSleepState(); setPathNote('Sleep timer off.'); closeSleepSheet(); });
  host.appendChild(offBtn);
}
export function openSleepSheet(){
  renderSleepOptions();
  $('#sleepOverlay').classList.add('open');
  $('#sleepOverlay').setAttribute('aria-hidden','false');
}
export function closeSleepSheet(){
  $('#sleepOverlay').classList.remove('open');
  $('#sleepOverlay').setAttribute('aria-hidden','true');
}
