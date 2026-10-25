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
   wiring below.

   RF9 (docs/12_REFINE.md): drift + the three presets are the Sound
   view's main controls now -- the whole charcards grid (the four cards'
   own per-value fine-tune included) moved behind one shared
   #soundAdvancedToggle disclosure, and the "Tone today" chart
   (updateToneCurveVisibility(), src/sundown/dial-view.js) only shows
   once drift isn't Off. */
import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { applyCharacter, applyLoudnessNorm, auditionStageAlone, auditionComparePure, releaseAudition } from '../audio/engine.js';
import { loudnessCaptionFor } from '../audio/loudness.js';
import { queueSave } from '../storage/meta.js';
import { setMode } from '../audio/mode.js';
import { toggleScratch } from '../player/scrub.js';
import { toggleSleevePull } from '../sundown/location.js';
import { applyDiscVariant } from '../record-art/looks.js';
import { toggleLaunchIntro, attachLaunchSettingRow } from '../launch/intro.js';
import { toggleBgAudio, bgUpdateUI, resolveBgOffer } from '../player/background.js';
import { setTheme } from '../ui/theme.js';
import { updateToneCurveVisibility } from '../sundown/dial-view.js';

// "Decided" (docs/13_CRATE.md, CR7): the paper-label switch in Settings ›
// Playback. Kept here rather than in record-art/looks.js itself, since
// looks.js is reached from several lightweight unit tests via its real
// circular import with history/sessions.js — pulling storage/meta.js's
// own wide real chain (audio/mode.js, player/background.js, sync/
// backup.js, …) in through looks.js would break every one of them. This
// wiring file already imports queueSave for everything else here.
function togglePaperLabel(){
  S.paperLabelOnLossy = !S.paperLabelOnLossy;
  const b = $('#paperLabelBtn');
  b.textContent = S.paperLabelOnLossy ? 'On' : 'Off';
  b.setAttribute('aria-pressed', String(S.paperLabelOnLossy));
  queueSave();
  const t = current();
  if(t) applyDiscVariant(t, true);
}

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

  // RF28 ("what am I hearing"): press-and-hold audition. One handler for
  // both shapes -- each of the four per-stage buttons (inside a
  // [data-char-tune] card's own fine-tune panel) and the one whole-chain
  // "Compare with Pure" button below the grid. Release listens on
  // `window`, not the button itself, so a finger sliding off the button
  // while still down still ends the hold (the same shape dial-gesture.js's
  // own drag release already uses) -- a stuck "bypassed forever" audition
  // would otherwise need a second tap elsewhere to notice, let alone fix.
  let auditionBtn = null;
  const endAudition = () => {
    if(!auditionBtn) return;
    auditionBtn.setAttribute('aria-pressed', 'false');
    auditionBtn = null;
    releaseAudition();
  };
  document.querySelectorAll('[data-audition-stage], [data-audition-pure]').forEach(b => {
    b.addEventListener('contextmenu', e => e.preventDefault());
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      auditionBtn = b;
      b.setAttribute('aria-pressed', 'true');
      if(b.hasAttribute('data-audition-pure')) auditionComparePure();
      else auditionStageAlone(b.dataset.auditionStage);
    });
  });
  window.addEventListener('pointerup', endAudition);
  window.addEventListener('pointercancel', endAudition);

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
    updateToneCurveVisibility();
  }));
  // RF9: the chart's own initial visibility, same shape as bgUpdateUI()'s
  // one-time call further down -- a restored S.charDrift (storage/meta.js)
  // is already in place by the time wireCharacter() runs.
  updateToneCurveVisibility();

  // RF9: one disclosure in front of the whole charcards grid, same
  // open/close shape as each card's own [data-char-tune] below, just one
  // level up and with nothing to seed on open (each card seeds its own
  // fine-tune value when *it's* opened).
  const advancedToggle = $('#soundAdvancedToggle'), advancedBody = $('#soundAdvancedBody');
  if(advancedToggle && advancedBody){
    advancedToggle.addEventListener('click', () => {
      const opening = advancedBody.hidden;
      advancedBody.hidden = !opening;
      advancedToggle.setAttribute('aria-expanded', String(opening));
    });
  }

  // docs/15_SURFACE_NOISE.md §1: no dedicated apply function of its own —
  // these three settings are read fresh by whatever plays the next sound
  // (player/transport.js, shell/runout.js), so a click just updates S,
  // the pressed state and saves, the same inline shape data-char-drift
  // uses just above.
  document.querySelectorAll('[data-surface-noise]').forEach(b => b.addEventListener('click', () => {
    S.surfaceNoise = b.dataset.surfaceNoise;
    document.querySelectorAll('[data-surface-noise]').forEach(x =>
      x.setAttribute('aria-pressed', String(x.dataset.surfaceNoise === S.surfaceNoise)));
    queueSave();
  }));
  document.querySelectorAll('[data-runout-length]').forEach(b => b.addEventListener('click', () => {
    S.runoutLength = b.dataset.runoutLength;
    document.querySelectorAll('[data-runout-length]').forEach(x =>
      x.setAttribute('aria-pressed', String(x.dataset.runoutLength === S.runoutLength)));
    queueSave();
  }));
  $('#surfaceNoiseUnderMusicBtn').addEventListener('click', () => {
    S.surfaceNoiseUnderMusic = !S.surfaceNoiseUnderMusic;
    const b = $('#surfaceNoiseUnderMusicBtn');
    b.textContent = S.surfaceNoiseUnderMusic ? 'On' : 'Off';
    b.setAttribute('aria-pressed', String(S.surfaceNoiseUnderMusic));
    queueSave();
  });
  // docs/15_SURFACE_NOISE.md §4: read fresh by maybeSideFlip() (shell/
  // runout.js) at the next side turn -- same inline shape as the three
  // settings just above.
  document.querySelectorAll('[data-auto-flip]').forEach(b => b.addEventListener('click', () => {
    S.autoFlip = b.dataset.autoFlip === 'on';
    document.querySelectorAll('[data-auto-flip]').forEach(x =>
      x.setAttribute('aria-pressed', String((x.dataset.autoFlip === 'on') === S.autoFlip)));
    queueSave();
  }));
  // AU5 (docs/16_AUDIO.md §4): same inline [data-*] seg + caption shape
  // as [data-depth] (sundown.js) — queueSave() persists it, and
  // applyLoudnessNorm() recomputes the gain for whatever's current right
  // away rather than waiting for the next track load.
  document.querySelectorAll('[data-loudness]').forEach(b => b.addEventListener('click', () => {
    S.loudnessMode = b.dataset.loudness;
    document.querySelectorAll('[data-loudness]').forEach(x =>
      x.setAttribute('aria-pressed', String(x.dataset.loudness === S.loudnessMode)));
    const desc = $('#loudnessDesc');
    if(desc) desc.textContent = loudnessCaptionFor(S.loudnessMode);
    queueSave();
    applyLoudnessNorm();
  }));

  $('#scratchBtn').addEventListener('click', toggleScratch);
  $('#sleevePullBtn').addEventListener('click', toggleSleevePull);
  $('#paperLabelBtn').addEventListener('click', togglePaperLabel);
  $('#launchIntroBtn').addEventListener('click', toggleLaunchIntro);
  attachLaunchSettingRow();
  $('#bgAudioBtn').addEventListener('click', toggleBgAudio);
  bgUpdateUI();

  // RF7: the once-only "keep it playing in the background?" card shown on
  // return from backgrounding (src/wiring/lifecycle.js/player/background.js).
  $('#bgOfferTurnOn').addEventListener('click', () => resolveBgOffer(true));
  $('#bgOfferNotNow').addEventListener('click', () => resolveBgOffer(false));
}
