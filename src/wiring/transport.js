/* ================= wiring: transport controls =================
   The play/next/prev/shuffle/repeat buttons, the scrub slider, the
   Pure/Vinyl mode buttons, the sleep timer, the favorite buttons
   (player + mini-player), and the mini-player/full-player
   open/close/interrupt wiring. */
import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { bgPrime } from '../player/background.js';
import { ensureContext, applyDeviceVolume } from '../audio/engine.js';
import { pause, play, seek, toggleTrackSpecState } from '../player/transport.js';
import { nextTrack, prevTrack, toggleShuffle, cycleRepeat } from '../player/controls.js';
import { continueFromResting, flipFromResting, toggleFocus } from '../player/queue.js';
import { setMode } from '../audio/mode.js';
import { queueSave } from '../storage/meta.js';
import { wireSpinToScrub } from '../player/scrub.js';
import { openSleepSheet } from '../player/sleep-timer.js';
import { toggleFavorite } from '../library/favorites.js';
import { touchActiveSession } from '../history/sessions.js';
import { updateShellAlbum } from '../shell/mini-player.js';
import {
  openPlayer, morphInFlight, interruptMorph,
  openPlayerOverflowMenu, isPlayerOverflowMenuOpen,
} from '../shell/player-overlay.js';
import { runStartSequence, interruptStartSequence, isShrinkWrapTarget } from '../shell/start-sequence.js';
import { gfHandoffInFlight, interruptGatefoldHandoff } from '../shell/handoff.js';
import { renderPlayerSidePanel } from '../shell/player-side-panel.js';
import { showRoute } from '../shell/routes.js';
import { renderTracks } from '../library/view.js';
import { closeLayer, forceCloseLayer } from '../shell/nav-stack.js';
import { performPendingFlip, liftNeedleNow } from '../shell/runout.js';

export function wireTransport(){
  $('#play').addEventListener('click', async ()=>{
    if(!S.playing) bgPrime();
    if(!S.ctx) await ensureContext();
    if(S.playing) pause();
    // RW3 (docs/23_RHYTHM_AND_WEAR.md): resting at a record boundary --
    // Play continues the queue from where it stopped, same gesture as
    // every other case below.
    else if(S.resting) continueFromResting();
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

  // AU7 (docs/16_AUDIO.md §6): "Volume slider on desktop only, after the
  // limiter, saved per device." Mutates S.deviceVolume directly on
  // 'input' the same "no full re-render mid-drag" shape #balanceSlider
  // (wiring/character.js) and the EQ sheet's own sliders already use.
  $('#barVolume').addEventListener('input', e => {
    S.deviceVolume = parseFloat(e.target.value);
    if(Number.isNaN(S.deviceVolume)) S.deviceVolume = 1;
    applyDeviceVolume();
  });
  $('#barVolume').addEventListener('change', queueSave);

  $('#sleepTimerBtn').addEventListener('click', openSleepSheet);
  $('#sleepClose').addEventListener('click', () => closeLayer('sleep'));

  // AU6 (docs/16_AUDIO.md §3): the EQ sheet, same overflow-menu entry
  // point as Sleep timer just above. TR2 (docs/19_PLAYER.md): dynamically
  // imported -- launch never needs the sheet's own rendering code, only
  // a tap on this button does.
  $('#eqBtn').addEventListener('click', async () => {
    const { openEqSheet } = await import('../player/eq-sheet.js');
    openEqSheet();
  });
  $('#eqClose').addEventListener('click', () => closeLayer('eq'));

  // PL8 item 10 (docs/19_PLAYER.md): tapping the spec line reveals its
  // own Untouched/Converted/Shaped state. role="button" (miziki.html)
  // needs its own Enter/Space handling -- a real <button> would get it
  // for free, but this sits inline in running text, not styled as one.
  $('#trackSpec').addEventListener('click', toggleTrackSpecState);
  $('#trackSpec').addEventListener('keydown', e => {
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggleTrackSpecState(); }
  });

  $('#playerFavBtn').addEventListener('click', ()=>{ const t = current(); if(t) toggleFavorite(t.id); });

  // FS10 (docs/25_FROM_SCRATCH.md): Focus (per-session, never saved) --
  // the pill is the way in, Done is the only way out from inside Focus
  // (the swipe-down override lives in wiring/swipe-close.js, since it has
  // to intercept the player's own swipe-to-close gesture) -- and the
  // resting card's own Flip to Side B. All three act straight on the
  // current queue, no overflow menu involved.
  $('#focusPill').addEventListener('click', toggleFocus);
  $('#focusDoneBtn').addEventListener('click', toggleFocus);
  $('#restingFlipBtn').addEventListener('click', flipFromResting);

  // docs/15_SURFACE_NOISE.md §4: the player's own discoverable way to flip
  // a waiting record (#flipPrompt) or, for "Until I lift it" only, lift
  // the needle without flipping (#liftNeedleBtn) -- both only ever shown
  // while S.runout.kind === 'wait' (shell/runout.js's own updateWaitUI()).
  $('#flipPrompt').addEventListener('click', performPendingFlip);
  $('#liftNeedleBtn').addEventListener('click', liftNeedleNow);

  // RF21 (docs/12_REFINE.md, "a quieter broadcast"): "Don't share this
  // session" -- a menuitemcheckbox in the player's own "···" menu, not a
  // saved pref (S.privateSpin is session-only, state.js). Turning it on
  // mid-track also clears whatever "now spinning" row is already live, the
  // same MizikiSocial.stopSpinning() call Privacy's own shareNowSpinning
  // switch already makes when switched off (miziki-social.js's
  // setSetting); turning it back off takes effect from the next play()
  // call only, same as that switch -- no row is proactively re-published.
  const privateSpinBtn = $('#privateSpinBtn');
  if(privateSpinBtn){
    privateSpinBtn.addEventListener('click', ()=>{
      S.privateSpin = !S.privateSpin;
      privateSpinBtn.setAttribute('aria-checked', String(S.privateSpin));
      if(S.privateSpin) MizikiSocial.stopSpinning();
    });
  }

  // RF8 (docs/12_REFINE.md): the player's own "···" overflow, beside the
  // title. Edit info/Share/Queue/Sleep timer each keep their own existing
  // click handler (src/wiring/edit.js/share.js/overlays.js, and
  // #sleepTimerBtn just above) wherever they're wired — only the menu's
  // own open/close/position is new here. Every row inside also closes the
  // menu once clicked, since none of those other handlers know about it.
  $('#playerOverflowBtn').addEventListener('click', ()=> isPlayerOverflowMenuOpen() ? closeLayer('player-overflow-menu') : openPlayerOverflowMenu());
  $('#playerOverflowScrim').addEventListener('click', () => closeLayer('player-overflow-menu'));
  document.querySelectorAll('#playerOverflowMenu button').forEach(b =>
    b.addEventListener('click', () => forceCloseLayer('player-overflow-menu')));

  // backgrounding is the last reliable moment before the OS can kill the tab —
  // write the in-progress session synchronously, not on a timer
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden') touchActiveSession();
  });

  $('#miniTap').addEventListener('click', openPlayer);
  $('#miniPlay').addEventListener('click', async ()=>{
    if(!S.playing) bgPrime();
    if(!S.ctx) await ensureContext();
    if(S.playing) pause();
    else if(S.resting) continueFromResting();
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
  $('#playerOverlay').addEventListener('pointerdown', (e)=>{
    // docs/15_SURFACE_NOISE.md §2: a pointerdown starting the shrink-wrap's
    // own drag-to-tear/long-press gesture must not also count as "tap
    // anywhere on the open player interrupts the ceremony" — same class of
    // bug PR3 (shell/runout.js) found for the auto-flip Flip/Lift-needle
    // buttons (this capture-phase listener runs before the gesture's own
    // pointerdown listener on the tab/wrap ever sees the event, so
    // stopPropagation there can't help — only excluding by target can).
    if(isShrinkWrapTarget(e.target)) return;
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
