import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { applyVolume } from '../sundown/location.js';
import { pauseAndRest, sideLetterFor } from './transport.js';
import { setPathNote } from '../ui/path-note.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';
import { sheetHeader, listMenu } from '../ui/parts.js';

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
  // LI3 (docs/35_LEAD_IN.md): the actual side letter, captured once at
  // startSleepTimer() -- S.sleep.side is null for a one-track single (no
  // sides to letter), where this mode behaves like End of track anyway.
  else if(S.sleep.mode === 'side') btn.textContent = '🌙 Sleep: End of side' + (S.sleep.side ? ' ' + S.sleep.side : '');
  else btn.textContent = '🌙 Sleep Timer';
}

function sleepCancelGainAutomation(){
  if(!S.ctx || !S.nodes || !S.nodes.master) return;
  try{ S.nodes.master.gain.cancelScheduledValues(S.ctx.currentTime); }catch(_e){} // context closed -- expected, not logged
}

export function stopSleepState(){
  clearSleepTimer();
  sleepCancelGainAutomation();
  S.sleep.mode = null; S.sleep.at = null; S.sleep.fading = false; S.sleep.side = null;
  applyVolume();
  updateSleepUI();
}

// no fade, no put-away — just stop where advance() would otherwise have moved on
export function sleepStopPlayback(){
  pauseAndRest();
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
  }catch(_e){} // context closed mid-ramp -- expected, not logged
}

function sleepTimeExpired(){
  clearSleepTimer();
  // already paused manually: nothing to fade or stop, just clear the state
  if(S.playing) pauseAndRest();
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
  // LI3: captured once, here -- the currently-playing track's own side
  // letter, so the label stays put for the rest of this side regardless
  // of anything else that changes later. '' (no sides) stays null.
  S.sleep.side = mode === 'side' ? (sideLetterFor(current(), S.index) || null) : null;
  if(mode === 'time') scheduleSleepCheck();
  updateSleepUI();
  setPathNote(mode === 'time' ? ('Sleeping in ' + minutes + ' min')
    : mode === 'track' ? 'Sleeping at end of track'
    : mode === 'album' ? 'Sleeping at end of album'
    : 'Sleeping at end of side' + (S.sleep.side ? ' ' + S.sleep.side : ''));
}

// UN4 (docs/36_UNIFORMITY.md point 2): stays a list, since it's a
// pick-one-and-go action rather than a setting -- listMenu() (src/ui/
// parts.js), one group, current choice marked rather than built as its
// own segmented control.
const SLEEP_MINUTE_OPTIONS = [15, 30, 45, 60];
function renderSleepOptions(){
  const host = $('#sleepOptions'); host.innerHTML = '';
  const currentMins = S.sleep.mode === 'time' ? Math.round((S.sleep.at - Date.now())/60000) : null;
  const mark = on => on ? ' ✓' : '';
  const items = SLEEP_MINUTE_OPTIONS.map(mins => ({
    label: mins + ' min' + mark(currentMins === mins),
    onClick: () => { startSleepTimer('time', mins); closeLayer('sleep'); },
  }));
  items.push(
    { label: 'End of track' + mark(S.sleep.mode === 'track'), onClick: () => { startSleepTimer('track'); closeLayer('sleep'); } },
    // LI3 (docs/35_LEAD_IN.md)
    { label: 'End of side' + mark(S.sleep.mode === 'side'), onClick: () => { startSleepTimer('side'); closeLayer('sleep'); } },
    { label: 'End of album' + mark(S.sleep.mode === 'album'), onClick: () => { startSleepTimer('album'); closeLayer('sleep'); } },
    { label: 'Off' + mark(!S.sleep.mode), onClick: () => { stopSleepState(); setPathNote('Sleep timer off.'); closeLayer('sleep'); } },
  );
  host.appendChild(listMenu([items]));
}
let sleepHeadBuilt = false;
export function openSleepSheet(){
  if(!sleepHeadBuilt){
    const head = sheetHeader('Sleep timer');
    head.closeBtn.addEventListener('click', () => closeLayer('sleep'));
    $('#sleepHead').appendChild(head);
    sleepHeadBuilt = true;
  }
  renderSleepOptions();
  const overlay = $('#sleepOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  openLayer('sleep', closeSleepSheet, { container: overlay });
}
export function closeSleepSheet(){
  $('#sleepOverlay').classList.remove('open');
  $('#sleepOverlay').setAttribute('aria-hidden','true');
}
