import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { REDUCED } from '../util/motion.js';
import { play } from '../player/transport.js';
import { SLEEVE_ANIM } from './mini-player.js';
import { runStartSequence, interruptStartSequence } from './start-sequence.js';

// Library selection always arrives via the sheet — something is being
// started. The sheet must settle fully before the disc transition begins.
export function openPlayerViaSheet(t, info){
  if(!t) return;
  S.playerOpen = true;
  const ov = $('#playerOverlay');
  ov.setAttribute('aria-hidden','false');
  ov.classList.add('open');
  // under REDUCED the sheet's slide-up transition is `none` (see .player-
  // overlay's reduced-motion rule), so transitionend never fires — go
  // straight to the ceremony instead of waiting on an event that won't come
  if(REDUCED){ runStartSequence(t, info, play); return; }
  let done = false;
  const settle = () => { if(done) return; done = true; ov.removeEventListener('transitionend', settle); runStartSequence(t, info, play); };
  ov.addEventListener('transitionend', settle, {once:true});
  setTimeout(settle, SLEEVE_ANIM.sheetMs + 150);   // safety net if transitionend never fires
}

// Tapping the mini-player is always a return to what's already playing —
// never a new selection — so it arrives via the morph and never runs a
// disc transition of its own.
export function openPlayer(){
  if(!current() || S.playerOpen) return;
  S.playerOpen = true;
  runMorphOpen();
}

export function closePlayer(){
  if(morphInFlight()){ interruptMorph(); return; }
  S.playerOpen = false;
  interruptStartSequence();
  const ov = $('#playerOverlay');
  ov.classList.remove('open');
  ov.setAttribute('aria-hidden','true');
}

/* ---- morph: the mini-player's disc grows and travels into the full disc's
   position. A plain FLIP: measure both rects (a shared fixed-position
   coordinate space), place a ghost at the small one, transition its
   transform to the delta+scale needed to become the large one, then hand
   off to the real disc. Must reverse cleanly if interrupted mid-flight,
   unlike the sleeve transitions, which snap straight to the end state. ---- */
export function morphInFlight(){ return $('#morphDisc').style.display === 'block'; }

export function runMorphOpen(){
  const t = current(); if(!t){ S.playerOpen = false; return; }
  const mini = $('#miniIndicator'), ghost = $('#morphDisc'), ov = $('#playerOverlay'),
        realDisc = $('#disc'), stage = $('#platterStage');
  const miniRect = mini.getBoundingClientRect();

  ov.classList.add('instant');
  ov.classList.add('open');
  ov.setAttribute('aria-hidden','false');
  void ov.offsetWidth;
  ov.classList.remove('instant');

  const targetRect = stage.getBoundingClientRect();
  stage.classList.add('morph-hidden');

  ghost.style.width = miniRect.width + 'px';
  ghost.style.height = miniRect.height + 'px';
  ghost.style.left = miniRect.left + 'px';
  ghost.style.top = miniRect.top + 'px';
  ghost.style.background = realDisc.style.background || '#15161B';
  ghost.style.transition = 'none';
  ghost.style.transform = 'translate(0,0) scale(1)';
  ghost.style.display = 'block';

  const scale = targetRect.width / miniRect.width;
  const dx = (targetRect.left + targetRect.width/2) - (miniRect.left + miniRect.width/2);
  const dy = (targetRect.top + targetRect.height/2) - (miniRect.top + miniRect.height/2);

  void ghost.offsetWidth;
  ghost.style.transition = 'transform ' + SLEEVE_ANIM.morphMs + 'ms ' + SLEEVE_ANIM.easing;
  ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';

  ghost.addEventListener('transitionend', function done(){
    ghost.removeEventListener('transitionend', done);
    ghost.style.display = 'none';
    ghost.style.transition = '';
    stage.classList.remove('morph-hidden');
  }, {once:true});
}

// reverses the ghost back down to the mini-player's position, then closes
// the overlay only once that shrink actually finishes
export function interruptMorph(){
  const ghost = $('#morphDisc'), stage = $('#platterStage');
  const cs = getComputedStyle(ghost);
  ghost.style.transition = 'none';
  ghost.style.transform = cs.transform === 'none' ? 'translate(0,0) scale(1)' : cs.transform;
  void ghost.offsetWidth;
  ghost.style.transition = 'transform ' + Math.round(SLEEVE_ANIM.morphMs*0.6) + 'ms ' + SLEEVE_ANIM.easing;
  ghost.style.transform = 'translate(0,0) scale(1)';
  ghost.addEventListener('transitionend', function done(){
    ghost.removeEventListener('transitionend', done);
    ghost.style.display = 'none';
    ghost.style.transition = '';
    stage.classList.remove('morph-hidden');
    S.playerOpen = false;
    const ov = $('#playerOverlay');
    ov.classList.remove('open');
    ov.setAttribute('aria-hidden','true');
  }, {once:true});
}
