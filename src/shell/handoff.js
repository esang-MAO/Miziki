import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { ensureBuffer } from '../player/buffers.js';
import { SLEEVE_ANIM } from './mini-player.js';
import { clearSpinDown } from './put-away.js';
import { isGatefoldOpen } from '../gatefold/view.js';
import { play } from '../player/transport.js';
import { forceCloseLayer, openLayer } from './nav-stack.js';
import { closePlayer } from './player-overlay.js';

/* ================= Part 2 §1: gatefold-to-player hand-off =================
   Replaces the sleeve pull specifically for a track picked inside an open
   gatefold whose album differs from whatever is currently playing: the one
   record travels from the gatefold's pocket to the platter instead of
   arriving/holding/emerging in the player's own sleeve. Shares S.sleeveSeq
   with the pull/put-away so only one of the three ever runs at a time, and
   a rapid second tap cancels this cleanly like any of the others. */
const HANDOFF_ANIM = {
  recedeMs: 400,        // 250-650ms: gatefold fades/scales/blurs back
  sheetFadeMs: 450,      // 350-800ms: player sheet fades up behind the flight
  flightMs: 750,         // 250-1000ms: pocket -> platter, growing 156->278px
  overshootMs: 140, settleMs: 110,   // 1000-1250ms: overshoot to 1.035, settle to 1
  overshootScale: 1.035,
  arcLift: 34,          // px the flight's midpoint lifts above a straight line
  tiltDeg: 5
};
function handoffEaseInOut(p){ return p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2; }

export function gfHandoffInFlight(){ return $('#gfHandoffGhost').style.display === 'block'; }

// `startRect` is measured from the gatefold's own sleeve-disc-wrap before
// anything else moves. t/info/startAudio match runStartSequence's own
// signature (info is unused here — the hand-off never reads "swap" vs
// "pull", it always flies — but kept for call-site symmetry).
export async function runGatefoldHandoff(startRect, t, info, startAudio){
  const token = ++S.sleeveSeq;
  const cancelled = () => token !== S.sleeveSeq;
  S.platterEmpty = false;
  clearSpinDown();

  const ghost = $('#gfHandoffGhost'), ghostArt = $('#gfHandoffArt'), ghostLabel = $('#gfHandoffLabel');
  const ov = $('#playerOverlay'), stage = $('#platterStage'), discBox = $('#platterBox'), gf = $('#gatefold');

  const bufferReady = ensureBuffer(S.index);

  // ghost starts exactly where the gatefold's own disc currently sits, using
  // whatever L-tier art the gatefold already loaded for this same album —
  // read the attribute, not the .src property, which resolves to the page's
  // own URL (never empty) when no src was ever set
  const gfArt = $('#gfDiscArt').getAttribute('src') || t.art || '';
  ghost.style.transition = 'none';
  ghost.style.width = startRect.width + 'px';
  ghost.style.height = startRect.height + 'px';
  ghost.style.left = startRect.left + 'px';
  ghost.style.top = startRect.top + 'px';
  ghost.style.transform = 'rotate(0deg) scale(1)';
  if(gfArt) ghostArt.src = gfArt; else ghostArt.removeAttribute('src');
  ghostLabel.classList.toggle('has-art', !!gfArt);
  void ghost.offsetWidth;
  ghost.style.display = 'block';

  discBox.classList.add('disc-hidden');
  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging','returning','changing');
  $('#sleeve').style.display = 'none';

  // Close the gatefold's own nav-stack entry now, before the player's layer
  // is opened — not after the flight/overshoot/settle completes.
  // closeLayer/forceCloseLayer both close a background layer *and*
  // everything stacked above it, which is right for an overlay opened on
  // top of the gatefold, but wrong here: the player replaces the gatefold
  // rather than nesting inside it, so closing the gatefold's entry late
  // would splice away the player's own, by-then-already-open nav-stack
  // entry too (it ends up stacked above 'gatefold' in the layers array),
  // running the player's instantClose (closePlayer) right as the hand-off
  // finished and silently closing the player it had just animated open.
  // {skipHistory:true} avoids a second race — see nav-stack.js's own
  // comment on finishClose(). The gatefold's exit fade just below still
  // needs #gatefold to keep rendering for its own ~400ms, so pin
  // display:block inline for exactly that span — closeGatefoldInstant()
  // only drops the .open class, which is what governs display via CSS
  // (.gatefold{display:none}).
  if(isGatefoldOpen()){
    gf.style.display = 'block';
    forceCloseLayer('gatefold', { skipHistory: true });
  }

  // player sheet fades up behind the flight rather than sliding up from the
  // bottom — same transform-skip trick runMorphOpen() uses. Prepped hidden
  // now (invisible either way), the fade-to-1 itself is timed below to
  // start at the 350ms mark (spec §1 step 3), not immediately.
  const wasPlayerOpen = S.playerOpen;
  if(!wasPlayerOpen){
    S.playerOpen = true;
    ov.classList.add('instant');
    ov.style.opacity = '0';
    ov.classList.add('open');
    ov.setAttribute('aria-hidden','false');
    void ov.offsetWidth;
    ov.classList.remove('instant');
    openLayer('player', closePlayer, { container: ov });
  }

  // 0-250ms: row highlight (already live via updateGatefoldNowPlaying(),
  // triggered inside the setQueue() the caller already ran) plus the record
  // rising in place — nothing else starts moving until this beat finishes
  await sleep(250);
  if(cancelled()) return;

  // the gatefold recedes behind the sheet — fade/scale/blur; the background
  // goes soft on purpose (kept per Part 2 §3), the flying record stays sharp
  gf.style.transition = 'opacity ' + HANDOFF_ANIM.recedeMs + 'ms linear,'
    + 'transform ' + HANDOFF_ANIM.recedeMs + 'ms ease-out,filter ' + HANDOFF_ANIM.recedeMs + 'ms ease-out';
  void gf.offsetWidth;
  gf.style.opacity = '0';
  gf.style.transform = 'scale(.93)';
  gf.style.filter = 'blur(2.5px)';

  // the sheet's own fade starts 100ms into this beat (350ms absolute) —
  // skipped if the player was already open, since there's nothing to fade up
  if(!wasPlayerOpen){
    setTimeout(() => {
      if(cancelled()) return;
      ov.style.transition = 'opacity ' + HANDOFF_ANIM.sheetFadeMs + 'ms ease-out';
      requestAnimationFrame(() => { if(!cancelled()) ov.style.opacity = '1'; });
    }, 100);
  }

  // FLIGHT: pocket -> platter, a gentle arc with a slight tilt, growing to
  // the platter's own size, ease-in-out (spec §1 steps 1-4)
  const endRect = discBox.getBoundingClientRect();
  const flightStart = performance.now();
  await new Promise(resolve => {
    function step(now){
      if(cancelled()){ resolve(); return; }
      const p = Math.min(1, (now - flightStart) / HANDOFF_ANIM.flightMs);
      const e = handoffEaseInOut(p);
      const w = startRect.width + (endRect.width - startRect.width) * e;
      const h = startRect.height + (endRect.height - startRect.height) * e;
      const cx0 = startRect.left + startRect.width/2, cy0 = startRect.top + startRect.height/2;
      const cx1 = endRect.left + endRect.width/2, cy1 = endRect.top + endRect.height/2;
      const cx = cx0 + (cx1 - cx0) * e;
      const arc = Math.sin(Math.PI * e) * HANDOFF_ANIM.arcLift;
      const cy = cy0 + (cy1 - cy0) * e - arc;
      const tilt = Math.sin(Math.PI * e) * HANDOFF_ANIM.tiltDeg * (cx1 >= cx0 ? 1 : -1);
      ghost.style.width = w.toFixed(1) + 'px'; ghost.style.height = h.toFixed(1) + 'px';
      ghost.style.left = (cx - w/2).toFixed(1) + 'px'; ghost.style.top = (cy - h/2).toFixed(1) + 'px';
      ghost.style.transform = 'rotate(' + tilt.toFixed(2) + 'deg)';
      if(p >= 1){ resolve(); return; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
  if(cancelled()) return;

  await Promise.race([bufferReady, sleep(SLEEVE_ANIM.holdCapMs)]);
  if(cancelled()) return;

  // OVERSHOOT + SETTLE: scale 1.035 then back to 1 (spec §1 step 5)
  ghost.style.transition = 'transform ' + HANDOFF_ANIM.overshootMs + 'ms ease-out';
  ghost.style.transform = 'rotate(0deg) scale(' + HANDOFF_ANIM.overshootScale + ')';
  await sleep(HANDOFF_ANIM.overshootMs);
  if(cancelled()) return;
  ghost.style.transition = 'transform ' + HANDOFF_ANIM.settleMs + 'ms ease-in-out';
  ghost.style.transform = 'rotate(0deg) scale(1)';
  await sleep(HANDOFF_ANIM.settleMs);
  if(cancelled()) return;

  ghost.style.display = 'none';
  ghost.style.transition = ''; ghost.style.transform = '';
  discBox.classList.remove('disc-hidden');
  ov.style.transition = ''; ov.style.opacity = '';
  gf.style.transition = ''; gf.style.opacity = ''; gf.style.transform = ''; gf.style.filter = '';
  gf.style.display = '';   // hand back to CSS (.gatefold without .open => display:none)
  startAudio();
}

// Cuts the hand-off wherever it is and snaps to the landed state instantly —
// same hard rule as interruptStartSequence(): no eased skip, ever. Reached
// from the player overlay's existing capture-phase pointerdown listener, so
// a tap anywhere during the flight (the sheet already covers the screen)
// lands it immediately (spec §1, "Tapping anywhere during it").
export function interruptGatefoldHandoff(){
  if(!gfHandoffInFlight()) return;
  S.sleeveSeq++;
  const ghost = $('#gfHandoffGhost');
  ghost.style.transition = ''; ghost.style.transform = ''; ghost.style.display = 'none';
  $('#platterBox').classList.remove('disc-hidden');
  const ov = $('#playerOverlay');
  ov.classList.remove('instant'); ov.style.transition = ''; ov.style.opacity = '';
  const gf = $('#gatefold');
  gf.style.transition = ''; gf.style.opacity = ''; gf.style.transform = ''; gf.style.filter = '';
  gf.style.display = '';
  // gatefold's own nav-stack entry is already closed by this point (see the
  // reorder in runGatefoldHandoff above) — kept as a defensive no-op in case
  // this is ever reached some other way.
  if(isGatefoldOpen()) forceCloseLayer('gatefold', { skipHistory: true });
  if(!S.playing) play();
}
