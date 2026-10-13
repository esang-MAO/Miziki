/* ================= wiring: Character panel and Settings toggles =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the character
   sliders and presets, Scratch, Car Mode's motion toggle, sleeve pull,
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
  const charMap = {wow:'wowOut', sat:'satOut', soft:'softOut', comp:'compOut'};
  Object.keys(charMap).forEach(k => {
    $('#' + k).addEventListener('input', e=>{
      S.char[k] = e.target.value/100;
      $('#' + charMap[k]).textContent = e.target.value + '%';
      applyCharacter(); queueSave();
    });
  });
  const presets = {light:{wow:.12,sat:.18,soft:.22,comp:.2}, classic:{wow:.30,sat:.35,soft:.40,comp:.35}, worn:{wow:.62,sat:.6,soft:.68,comp:.55}};
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', ()=>{
    const p = presets[b.dataset.preset];
    Object.keys(p).forEach(k => {
      S.char[k] = p[k]; $('#' + k).value = Math.round(p[k]*100);
      $('#' + charMap[k]).textContent = Math.round(p[k]*100) + '%';
    });
    applyCharacter(); queueSave();
    if(S.mode !== 'vinyl') setMode('vinyl');
  }));

  // D2: the one control today (the desktop sidebar's own segmented
  // control, D7, will carry the same data-theme-choice convention and
  // call the same setTheme()) — querySelectorAll rather than a fixed id
  // list, so a second control sharing the attribute needs no change here.
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
