/* ================= wiring: Character panel and Settings toggles =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the character
   presets (the four sliders were removed — the Sound cards show the values), Scratch, Car Mode's motion toggle, sleeve pull,
   launch intro, background playback, and the Car Mode floor/max-speed
   sliders. Every function called here was already a real export of
   its owning module. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { applyCharacter } from '../audio/engine.js';
import { queueSave } from '../storage/meta.js';
import { setMode } from '../audio/mode.js';
import { toggleScratch } from '../player/scrub.js';
import { toggleMotion, toggleSleevePull } from '../sundown/location.js';
import { toggleLaunchIntro, attachLaunchSettingRow } from '../launch/intro.js';
import { toggleBgAudio, bgUpdateUI } from '../player/background.js';
import { setTheme } from '../ui/theme.js';

export function wireCharacter(){
  const presets = {light:{wow:.12,sat:.18,soft:.22,comp:.2}, classic:{wow:.30,sat:.35,soft:.40,comp:.35}, worn:{wow:.62,sat:.6,soft:.68,comp:.55}};
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', ()=>{
    const p = presets[b.dataset.preset];
    Object.keys(p).forEach(k => { S.char[k] = p[k]; });
    applyCharacter(); queueSave();
    if(S.mode !== 'vinyl') setMode('vinyl');
  }));

  // D2: wires the one *static* [data-theme-choice] control left in the
  // DOM at boot — the desktop sidebar's own segmented control (D7,
  // #sidebarAppearance). Profile › Settings' own four buttons (DA3
  // relocated Appearance there; DA4 added the fourth, Nychthemeron) are
  // built fresh on every render instead, so they wire themselves
  // directly at render time (src/profile/screens.js) rather than through
  // this boot-time pass — querySelectorAll rather than a fixed id list
  // here regardless, so a future static control sharing the attribute
  // would need no change in this file either.
  document.querySelectorAll('[data-theme-choice]').forEach(b =>
    b.addEventListener('click', () => setTheme(b.dataset.themeChoice)));

  // DA2 (docs/DAY_ARC.md): the intensity change itself, not the user's own
  // slider value, so it rides the slow ~2s ramp engine.js's own drift
  // recompute timer uses — a sudden intensity jump is exactly the kind of
  // thing "never audible as a change" is about, unlike a slider the user
  // is actively dragging and expects to respond instantly.
  document.querySelectorAll('[data-char-drift]').forEach(b => b.addEventListener('click', () => {
    S.charDrift = b.dataset.charDrift;
    document.querySelectorAll('[data-char-drift]').forEach(x =>
      x.setAttribute('aria-pressed', String(x.dataset.charDrift === S.charDrift)));
    applyCharacter(2);
    queueSave();
  }));

  $('#scratchBtn').addEventListener('click', toggleScratch);
  $('#motionBtn').addEventListener('click', toggleMotion);
  $('#sleevePullBtn').addEventListener('click', toggleSleevePull);
  $('#launchIntroBtn').addEventListener('click', toggleLaunchIntro);
  attachLaunchSettingRow();
  $('#bgAudioBtn').addEventListener('click', toggleBgAudio);
  bgUpdateUI();
  $('#floor').addEventListener('input', e=>{ S.motion.floor = e.target.value/100; $('#floorOut').textContent = e.target.value + '%'; });
  $('#maxSpeed').addEventListener('input', e=>{
    S.motion.max = +e.target.value;
    $('#maxSpeedOut').textContent = Math.round(S.motion.max*2.23694) + ' mph';
  });
}
