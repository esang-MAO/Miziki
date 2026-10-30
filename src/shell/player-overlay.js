import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { REDUCED } from '../util/motion.js';
import { isDesktopShell } from '../util/viewport.js';
import { play } from '../player/transport.js';
import { SLEEVE_ANIM } from './mini-player.js';
import { runStartSequence, interruptStartSequence } from './start-sequence.js';
import { openLayer } from './nav-stack.js';
import { currentDayPosition } from '../sundown/solar.js';
import { eveningGlanceLevel, EVENING_GLANCE_FIRST_MS, EVENING_GLANCE_DEEP_MS } from '../player/evening-glance.js';

// Library selection always arrives via the sheet — something is being
// started. The sheet must settle fully before the disc transition begins.
export function openPlayerViaSheet(t, info){
  if(!t) return;
  S.playerOpen = true;
  const ov = $('#playerOverlay');
  ov.setAttribute('aria-hidden','false');
  ov.classList.add('open');
  openLayer('player', closePlayer, { container: ov });
  scheduleGlance();
  wakeEveningGlance();
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
  openLayer('player', closePlayer, { container: $('#playerOverlay') });
  runMorphOpen();
  scheduleGlance();
  wakeEveningGlance();
}

export function closePlayer(){
  if(morphInFlight()){ interruptMorph(); return; }
  S.playerOpen = false;
  interruptStartSequence();
  exitGlance();
  clearEveningGlance();
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
  ghost.style.background = realDisc.style.background || '#1C1A1F';
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

// RF8 (docs/12_REFINE.md): the player's own "···" overflow, beside the
// title — Edit info, Share, Queue and Sleep timer all moved here off the
// always-visible row under the title; Look stays where it was (not one of
// the four the doc names). Same popover shape as the library header's own
// overflow (src/shell/header.js), positioned off its own button.
export function openPlayerOverflowMenu(){
  const btn = $('#playerOverflowBtn'), r = btn.getBoundingClientRect();
  const menu = $('#playerOverflowMenu');
  menu.style.top = Math.round(r.bottom + window.scrollY + 8) + 'px';
  menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
  $('#playerOverflowScrim').classList.add('open');
  menu.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  // The scrim is a separate sibling, not nested inside the menu, so it has
  // to be in container too or it's marked inert and loses its own
  // tap-to-dismiss (same fix as src/shell/header.js's two menus).
  openLayer('player-overflow-menu', closePlayerOverflowMenu, { container: [menu, $('#playerOverflowScrim')] });
}
export function closePlayerOverflowMenu(){
  $('#playerOverflowScrim').classList.remove('open');
  $('#playerOverflowMenu').classList.remove('open');
  $('#playerOverflowBtn').setAttribute('aria-expanded', 'false');
}
export function isPlayerOverflowMenuOpen(){
  return $('#playerOverflowMenu').classList.contains('open');
}

/* ---- TY7b (docs/22_TYPE.md): the glance view, the desktop-with-a-record-
   loaded "second monitor" case. 60s with no pointer movement, key or
   wheel adds .glance to #playerOverlay (and .glance-active to <body>, so
   the sidebar/mini-bar chrome a sibling of the overlay can dim without a
   :has() selector); any of those events removes it. Not .at-rest (CEREMONY
   §2's empty-state class, untouched by this) — glance requires a current
   track and the overlay to already be open; the two are mutually exclusive
   by construction, since .at-rest only ever applies with nothing loaded. */
const GLANCE_IDLE_MS = 60000;
const GLANCE_TITLE_FLOOR_PX = 28; // --fs-hero -- never shrinks below the next step down
let glanceTimer = null;
let lastPointerMoveAt = 0;

function fillGlanceMeta(){
  const t = current();
  const artistEl = $('#glanceArtist'), albumEl = $('#glanceAlbumYear');
  if(!t || !t.tags){ artistEl.textContent = ''; albumEl.textContent = ''; return; }
  artistEl.textContent = t.tags.artist || '';
  albumEl.textContent = [t.tags.album, t.tags.year].filter(Boolean).join(' · ');
}

// SH2-style measure-then-shrink (src/share/styles.js's shareFitLines does
// the same thing for canvas text): starts at --fs-numeral, steps down
// while the title spills past two lines, same as every other auto-shrink
// title in this app rather than ever truncating or marqueeing (TY7's own
// "no looping text animation, ever" rule).
function fitGlanceTitle(){
  const title = $('#trackName');
  const numeralPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs-numeral')) || 64;
  let size = numeralPx;
  title.style.fontSize = size + 'px';
  const lineH = size; // --lh-numeral is 1
  while(title.scrollHeight > lineH * 2 + 2 && size > GLANCE_TITLE_FLOOR_PX){
    size -= 2;
    title.style.fontSize = size + 'px';
  }
}

function enterGlance(){
  if(!isDesktopShell() || !S.playerOpen || !current()) return;
  const ov = $('#playerOverlay');
  if(!ov.classList.contains('open') || ov.classList.contains('glance')) return;
  ov.classList.add('glance');
  document.body.classList.add('glance-active');
  fillGlanceMeta();
  fitGlanceTitle();
}

function exitGlance(){
  clearTimeout(glanceTimer); glanceTimer = null;
  const ov = $('#playerOverlay');
  if(!ov.classList.contains('glance')) return;
  ov.classList.remove('glance');
  document.body.classList.remove('glance-active');
  $('#trackName').style.fontSize = '';
}

function scheduleGlance(){
  clearTimeout(glanceTimer);
  if(!isDesktopShell() || !S.playerOpen || !current()) return;
  glanceTimer = setTimeout(enterGlance, GLANCE_IDLE_MS);
}

// Any of pointer movement, a key or the wheel both leaves glance (if it was
// showing) and restarts the 60s idle clock — one path handles both, since
// leaving and re-arming always happen together.
function onGlanceActivity(){
  exitGlance();
  scheduleGlance();
}

document.addEventListener('DOMContentLoaded', () => {
  const ov = $('#playerOverlay');
  if(!ov) return;
  // throttled: a raw pointermove fires far more often than this needs
  ov.addEventListener('pointermove', () => {
    const now = Date.now();
    if(now - lastPointerMoveAt < 200) return;
    lastPointerMoveAt = now;
    onGlanceActivity();
  });
}, {once:true});
document.addEventListener('keydown', onGlanceActivity);
document.addEventListener('wheel', onGlanceActivity, {passive:true});
document.addEventListener('visibilitychange', () => {
  if(document.hidden){ clearTimeout(glanceTimer); glanceTimer = null; }
});

/* ---- RW5 (docs/23_RHYTHM_AND_WEAR.md): evening glance (phones), reusing
   this same idle-timer approach instead of a new system. After sunset an
   idle, playing full player sheds its controls in two layers (.eve-glance,
   then .eve-glance-deep on #playerOverlay), styled in 29-evening-
   glance.css. Phones only: the desktop glance view above handles wide
   screens. Any touch or key brings everything back, and the touch that
   wakes it is swallowed so it can't land on a control that was invisible
   a moment before (a faded Pause button sitting right under a thumb).
   Spin-to-scrub on the disc is pointer-driven, not click-driven, so a
   drag still works straight away -- only a swallowed click is affected. */
let eveTimers = [];
let eveLastActivityAt = 0;
let eveLevel = 0;
let eveSwallowClickUntil = 0;

function setEveningGlanceLevel(level){
  if(level === eveLevel) return;
  eveLevel = level;
  const ov = $('#playerOverlay');
  if(!ov) return;
  ov.classList.toggle('eve-glance', level >= 1);
  ov.classList.toggle('eve-glance-deep', level >= 2);
}

function applyEveningGlance(){
  if(isDesktopShell() || !S.playerOpen || !current()){ setEveningGlanceLevel(0); return; }
  setEveningGlanceLevel(eveningGlanceLevel(Date.now() - eveLastActivityAt, currentDayPosition().phase, S.playing));
}

export function clearEveningGlance(){
  eveTimers.forEach(clearTimeout);
  eveTimers = [];
  setEveningGlanceLevel(0);
}

export function wakeEveningGlance(){
  clearEveningGlance();
  eveLastActivityAt = Date.now();
  if(isDesktopShell() || !S.playerOpen || !current()) return;
  // +50ms so Date.now() has definitely passed each threshold when it fires
  eveTimers = [EVENING_GLANCE_FIRST_MS, EVENING_GLANCE_DEEP_MS].map(ms => setTimeout(applyEveningGlance, ms + 50));
}

document.addEventListener('pointerdown', () => {
  if(eveLevel > 0) eveSwallowClickUntil = Date.now() + 600;
  if(S.playerOpen) wakeEveningGlance();
}, {capture:true, passive:true});
document.addEventListener('click', e => {
  if(Date.now() < eveSwallowClickUntil){
    eveSwallowClickUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  }
}, {capture:true});
document.addEventListener('keydown', () => { if(S.playerOpen) wakeEveningGlance(); });
document.addEventListener('visibilitychange', () => {
  if(document.hidden){ eveTimers.forEach(clearTimeout); eveTimers = []; }
  else if(S.playerOpen) wakeEveningGlance();
});
