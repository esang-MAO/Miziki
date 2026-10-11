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
