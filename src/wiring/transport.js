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
import { openSleepSheet, closeSleepSheet } from '../player/sleep-timer.js';
import { toggleFavorite } from '../library/favorites.js';
import { touchActiveSession } from '../history/sessions.js';
import { updateShellAlbum } from '../shell/mini-player.js';
import { openPlayer, closePlayer, morphInFlight, interruptMorph } from '../shell/player-overlay.js';
import { runStartSequence, interruptStartSequence } from '../shell/start-sequence.js';
import { gfHandoffInFlight, interruptGatefoldHandoff } from '../shell/handoff.js';

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

  $('#modeVinyl').addEventListener('click', ()=>{ setMode('vinyl'); queueSave(); });
  $('#modePure').addEventListener('click', ()=>{ setMode('pure'); queueSave(); });

  $('#sleepTimerBtn').addEventListener('click', openSleepSheet);
  $('#sleepClose').addEventListener('click', closeSleepSheet);

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
  $('#playerDismiss').addEventListener('click', closePlayer);
  $('#playerOverlay').addEventListener('pointerdown', ()=>{
    interruptStartSequence();            // pull/return-to-sleeve: snap to end state
    if(morphInFlight()) interruptMorph(); // morph: reverse cleanly instead
    if(gfHandoffInFlight()) interruptGatefoldHandoff();   // hand-off flight: land instantly
  }, {capture:true});
}
