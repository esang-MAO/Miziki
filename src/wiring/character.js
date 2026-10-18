/* ================= wiring: Character panel and Settings toggles =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the character
   presets, Scratch, sleeve pull, launch intro, and background playback.
   Every function called here was already a real export of its owning
   module. RF6 (docs/12_REFINE.md) removed Car Mode's motion toggle and
   floor/max-speed sliders outright. RF7 added the background-playback
   return offer card's own two buttons, alongside the existing toggle.

   tabs-design-unify removed the four always-visible character sliders,
   leaving only the three presets; a later follow-up (per that branch's
   own "possible follow-ups" note, and Ken's own ask) re-added per-value
   fine-tuning, but tucked behind each Sound card instead of restoring
   the old always-on block — see the `[data-char-tune]`/`[data-char-fine]`
   wiring below. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { applyCharacter } from '../audio/engine.js';
import { queueSave } from '../storage/meta.js';
import { setMode } from '../audio/mode.js';
import { toggleScratch } from '../player/scrub.js';
import { toggleSleevePull } from '../sundown/location.js';
import { toggleLaunchIntro, attachLaunchSettingRow } from '../launch/intro.js';
import { toggleBgAudio, bgUpdateUI, resolveBgOffer } from '../player/background.js';
import { setTheme } from '../ui/theme.js';

export function wireCharacter(){
  const presets = {light:{wow:.12,sat:.18,soft:.22,comp:.2}, classic:{wow:.30,sat:.35,soft:.40,comp:.35}, worn:{wow:.62,sat:.6,soft:.68,comp:.55}};
  const presetBtns = document.querySelectorAll('[data-preset]');
  presetBtns.forEach(b => b.addEventListener('click', ()=>{
    const p = presets[b.dataset.preset];
    Object.keys(p).forEach(k => { S.char[k] = p[k]; });
    applyCharacter(); queueSave();
    if(S.mode !== 'vinyl') setMode('vinyl');
    // Visual only (session-only, like the drift seg's own pressed state) —
    // a preset is a starting point, not a mode the app remembers was
    // "last picked"; nothing here is persisted or restored on reload.
    presetBtns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));

  // Per-value fine-tuning, behind the cards: tapping a .sd-charcard
  // reveals the one slider for that parameter, right underneath it.
  // Collapsed again on a second tap, or by opening a different card
  // (only one open at a time, so the grid doesn't grow unboundedly).
  // Reusing the old slider ids/wiring shape (`[data-preset]`'s own
  // input-event pattern, pre-tabs-design-unify) — just mounted inside a
  // disclosure instead of always on screen, and with no write-back loop
  // needed in storage/meta.js: the slider only ever reads S.char[k] at
  // the moment it's revealed, never at boot (nothing to desync).
  const fineInputs = {wow:'charFineWow', sat:'charFineSat', soft:'charFineSoft', comp:'charFineComp'};
  const fineOuts = {wow:'charFineWowOut', sat:'charFineSatOut', soft:'charFineSoftOut', comp:'charFineCompOut'};
  const tuneBtns = document.querySelectorAll('[data-char-tune]');
  tuneBtns.forEach(b => b.addEventListener('click', ()=>{
    const key = b.dataset.charTune;
    const panel = $('#' + b.getAttribute('aria-controls'));
    const opening = panel.hidden;
    tuneBtns.forEach(x => {
      const p = $('#' + x.getAttribute('aria-controls'));
      const show = opening && x === b;
      p.hidden = !show;
      x.setAttribute('aria-expanded', String(show));
    });
    if(opening){
      const pct = Math.round(S.char[key] * 100);
      $('#' + fineInputs[key]).value = pct;
      $('#' + fineOuts[key]).textContent = pct + '%';
    }
  }));
  Object.keys(fineInputs).forEach(key => {
    $('#' + fineInputs[key]).addEventListener('input', e=>{
      S.char[key] = e.target.value / 100;
      $('#' + fineOuts[key]).textContent = e.target.value + '%';
      applyCharacter(); queueSave();
      if(S.mode !== 'vinyl') setMode('vinyl');
      presetBtns.forEach(x => x.setAttribute('aria-pressed', 'false'));
    });
  });

  // D2: wires any static [data-theme-choice] control present at boot.
  // RF8 (docs/12_REFINE.md) removed the desktop sidebar's own copy
  // (#sidebarAppearance) — Profile › Settings' four buttons (DA3
  // relocated Appearance there; DA4 added the fourth, Nychthemeron) are
  // the one home for this control now, built fresh on every render and
  // wiring themselves directly at render time (src/profile/screens.js).
  // querySelectorAll rather than a fixed id list here regardless, so a
  // future static control sharing the attribute would need no change.
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
  $('#sleevePullBtn').addEventListener('click', toggleSleevePull);
  $('#launchIntroBtn').addEventListener('click', toggleLaunchIntro);
  attachLaunchSettingRow();
  $('#bgAudioBtn').addEventListener('click', toggleBgAudio);
  bgUpdateUI();

  // RF7: the once-only "keep it playing in the background?" card shown on
  // return from backgrounding (src/wiring/lifecycle.js/player/background.js).
  $('#bgOfferTurnOn').addEventListener('click', () => resolveBgOffer(true));
  $('#bgOfferNotNow').addEventListener('click', () => resolveBgOffer(false));
}
