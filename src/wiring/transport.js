/* ================= wiring: transport controls =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the play/next/prev/
   shuffle/repeat buttons, the scrub slider, the Pure/Vinyl mode buttons,
   the sleep timer, the favorite buttons (player + mini-player), and the
   mini-player/full-player open/close/interrupt wiring. Every function
   called here was already a real export of its owning module; this file
   adds no new export anywhere else. */
import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { bgPrime } from '../player/background.js';
import { ensureContext } from '../audio/engine.js';
import { pause, play, seek } from '../player/transport.js';
import { nextTrack, prevTrack, toggleShuffle, cycleRepeat } from '../player/controls.js';
import { setMode } from '../audio/mode.js';
import { queueSave } from '../storage/meta.js';
import { wireSpinToScrub } from '../player/scrub.js';
import { openSleepSheet } from '../player/sleep-timer.js';
import { toggleFavorite } from '../library/favorites.js';
import { touchActiveSession } from '../history/sessions.js';
import { updateShellAlbum } from '../shell/mini-player.js';
import { openPlayer, morphInFlight, interruptMorph } from '../shell/player-overlay.js';
import { runStartSequence, interruptStartSequence } from '../shell/start-sequence.js';
import { gfHandoffInFlight, interruptGatefoldHandoff } from '../shell/handoff.js';
import { renderPlayerSidePanel } from '../shell/player-side-panel.js';
import { showRoute } from '../shell/routes.js';
import { renderTracks } from '../library/view.js';
import { closeLayer } from '../shell/nav-stack.js';

export function wireTransport(){
  $('#play').addEventListener('click', async ()=>{
    if(!S.playing) bgPrime();
    if(!S.ctx) await ensureContext(null);
    if(S.playing) pause();
    // the sleeve is covering an empty platter — bring the disc back out
    // before playing, same ceremony as picking a track from the library
    else if(S.platterEmpty) runStartSequence(current(), updateShellAlbum(current()), play);
    else play();
  });
  $('#next').addEventListener('click', nextTrack);
  $('#prev').addEventListener('click', prevTrack);
  $('#shuffle').addEventListener('click', ()=>{ toggleShuffle(); queueSave(); });
  $('#repeat').addEventListener('click', ()=>{ cycleRepeat(); queueSave(); });

  $('#scrub').addEventListener('input', ()=>{ S.scrubbing = true; });
  $('#scrub').addEventListener('change', e=>{
    S.scrubbing = false;
    const t = current(); if(t) seek((t.duration || 0) * e.target.value/1000);
  });
  wireSpinToScrub();

  // CEREMONY (docs/CEREMONY.md, §1): one toggle, not a two-button group —
  // flips between the two modes through the same setMode() either button
  // used to call. A real switch (role="switch" in the markup), so Space/
  // Enter on the focused button already toggles it, same as a click.
  $('#modeToggle').addEventListener('click', ()=>{ setMode(S.mode === 'vinyl' ? 'pure' : 'vinyl'); queueSave(); });

  // D4 (docs/DESKTOP_LAYOUT.md): the desktop player bar's own prev/next/
  // seek/mode controls — new ids (miziki.html), hidden below 1024px, but
  // wired unconditionally here since a hidden button's own listener
  // simply never fires. Each calls the exact same function its full-
  // player counterpart above does; nothing new is implemented twice.
  $('#barPrev').addEventListener('click', prevTrack);
  $('#barNext').addEventListener('click', nextTrack);
  $('#barScrub').addEventListener('input', ()=>{ S.scrubbing = true; });
  $('#barScrub').addEventListener('change', e=>{
    S.scrubbing = false;
    const t = current(); if(t) seek((t.duration || 0) * e.target.value/1000);
  });
  $('#barModeToggle').addEventListener('click', ()=>{ setMode(S.mode === 'vinyl' ? 'pure' : 'vinyl'); queueSave(); });

  $('#sleepTimerBtn').addEventListener('click', openSleepSheet);
  $('#sleepClose').addEventListener('click', () => closeLayer('sleep'));

  $('#playerFavBtn').addEventListener('click', ()=>{ const t = current(); if(t) toggleFavorite(t.id); });
  $('#miniFavBtn').addEventListener('click', e => { e.stopPropagation(); const t = current(); if(t) toggleFavorite(t.id); });

  // backgrounding is the last reliable moment before the OS can kill the tab —
  // write the in-progress session synchronously, not on a timer
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') touchActiveSession();
  });

  $('#miniTap').addEventListener('click', openPlayer);
  $('#miniPlay').addEventListener('click', async ()=>{
    if(!S.playing) bgPrime();
    if(!S.ctx) await ensureContext(null);
    if(S.playing) pause();
    else if(S.platterEmpty && S.playerOpen) runStartSequence(current(), updateShellAlbum(current()), play);
    else if(S.platterEmpty){
      // the full player isn't open to show the pull, so there's nothing to
      // animate — skip straight to the pulled-out end state, same as
      // advance() already does for an ordinary track change with the
      // player closed, rather than running an unseen ~3-5s ceremony first
      S.platterEmpty = false;
      $('#platterBox').classList.remove('disc-hidden');
      play();
    }
    else play();
  });
  $('#playerDismiss').addEventListener('click', () => closeLayer('player'));
  // CEREMONY §2: the desktop rest state's two ways back to a record.
  const openLibraryAt = mode => {
    closeLayer('player');
    if(mode){
      S.view.mode = mode; S.view.group = null; S.view.artistAlbum = null; S.view.playlist = null;
    }
    showRoute('library');
    renderTracks();
  };
  $('#restOpenCrate').addEventListener('click', () => openLibraryAt(S.libraryLayout === 'crate' ? 'crate' : 'albums'));
  $('#restOpenLibrary').addEventListener('click', () => openLibraryAt(null));
  $('#playerOverlay').addEventListener('pointerdown', ()=>{
    interruptStartSequence();            // pull/return-to-sleeve: snap to end state
    if(morphInFlight()) interruptMorph(); // morph: reverse cleanly instead
    if(gfHandoffInFlight()) interruptGatefoldHandoff();   // hand-off flight: land instantly
  }, {capture:true});

  // D6 (docs/DESKTOP_LAYOUT.md): the desktop-only side panel's three tabs
  // (hidden below 1024px, same as the rest of #playerSidePanel) — each
  // click just flips which one is aria-selected and asks shell/player-
  // side-panel.js to repaint, the same render functions the phone's own
  // sheets use (player/queue.js's renderQueueSheet, library/credits.js's
  // renderCreditsSheet/renderLinerNotes), never a second implementation.
  document.querySelectorAll('#playerSideTabs [data-panel-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#playerSideTabs [data-panel-tab]')
        .forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      renderPlayerSidePanel();
    });
  });
  renderPlayerSidePanel();   // initial paint — matches wireCharacter()'s own "initial bgUpdateUI() call" precedent
}
