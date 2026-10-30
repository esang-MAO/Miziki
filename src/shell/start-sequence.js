import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { REDUCED } from '../util/motion.js';
import { albumKey } from '../record-art/tiers.js';
import { ensureBuffer } from '../player/buffers.js';
import { isAlbumSealed, breakSeal } from '../library/sealed.js';
import { releaseSeed, playCrinkleBurst } from '../audio/surface-noise.js';
import { hapticTick } from '../ui/haptic.js';
import { SLEEVE_ANIM, renderMiniPlayer } from './mini-player.js';
import { play } from '../player/transport.js';
import { clearSpinDown, startSpinDown } from './put-away.js';
import { cancelRunout, interruptRunout } from './runout.js';
import { CHANGE_TIMELINE } from './ceremony-timing.js';
import { wordmarkEl } from '../ui/wordmark.js';
import { wearStage } from '../record-art/wear.js';

const WEAR_STAGES = ['light', 'worn', 'loved'];
// RW7 (docs/23_RHYTHM_AND_WEAR.md): purely cosmetic, a plain class toggle
// with no await of its own — safe to call anywhere in this ceremony
// without touching its gesture-critical timing (CLAUDE.md rule 9). Sealed
// records never show wear; their own path above never calls this.
export function applySleeveWear(el, albumId){
  WEAR_STAGES.forEach(s => el.classList.remove('wear-' + s));
  if(S.showWear === false) return;
  const stage = wearStage(S.sessionCounts[albumId], S.albumFirstPlayed[albumId], Date.now());
  if(stage !== 'new') el.classList.add('wear-' + stage);
}

// TY4 (docs/22_TYPE.md): the empty-sleeve state's "F" cut, tilted -12deg by
// 03-sleeve-pull.css's own .sleeve-mark rule (the SVG is always drawn
// upright) — set once per sleeve at module load, same as every other
// static boot-time fill in this file's sibling modules.
$('#sleeve .sleeve-mark').appendChild(wordmarkEl());
$('#sleeveOut .sleeve-mark').appendChild(wordmarkEl());

const STAGE_CLASSES =['sleeve-arriving','sleeve-exiting','disc-emerging','returning','changing','putaway-in','putaway-slide','putaway-out'];

// the outgoing sleeve of an overlapped change (CEREMONY §4) — its own
// element, so it can still be leaving while the new #sleeve arrives
function showOutgoingSleeve(art, hasArt){
  const out = $('#sleeveOut'), img = $('#sleeveOutArt');
  if(!out) return;
  if(hasArt){ img.src = art; out.classList.add('has-art'); }
  else { img.removeAttribute('src'); out.classList.remove('has-art'); }
  out.style.display = 'flex';
}
function hideOutgoingSleeve(){
  const out = $('#sleeveOut');
  if(out) out.style.display = 'none';
  $('#platterStage').style.removeProperty('--arrive-duration');
}

// ================= start sequence: sheet/pull/return orchestration =================
// A single async, cancellable sequence drives everything from "the sheet has
// settled" (or "the player was already open") through "the record is on the
// platter and audio has started." Every await is followed by a token check
// so interruptStartSequence() can cut in cleanly at any point instead of
// racing a stale animation to the end. Playback itself is strictly gated:
// startAudio (always play()) is only ever invoked once, at the moment the
// disc actually reaches the platter — never before, never overlapping.
export function waitAnimEnd(el, ms){
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if(done) return; done = true; el.removeEventListener('animationend', onEnd); resolve(); };
    const onEnd = (e) => { if(e.target === el) finish(); };
    el.addEventListener('animationend', onEnd);
    setTimeout(finish, ms + 150);   // safety net if animationend never fires
  });
}

export function sleeveArtFor(art, hasArt){
  const sleeve = $('#sleeve'), sleeveArt = $('#sleeveArt');
  if(hasArt){ sleeveArt.src = art; sleeve.classList.add('has-art'); }
  else { sleeveArt.removeAttribute('src'); sleeve.classList.remove('has-art'); }
}

// info comes from updateShellAlbum(). startAudio runs immediately when
// there's no ceremony to run at all (untagged/shuffled/same-album, the
// toggle is off, or reduced motion) — otherwise it runs only after the
// full return+pull (swap) or pull-only (fresh platter) sequence completes.

// ================= shrink-wrap peel (docs/15_SURFACE_NOISE.md §2) =================
// The sleeve of a Sealed record arrives wrapped — a sheen+wrinkle layer
// with a hype sticker riding on top, torn by dragging a tab at the
// opening (top) edge. Past SHRINK_COMMIT_PROGRESS the whole shrink
// detaches and falls away, sticker included, the same way every trigger
// below ends up at the same detach animation regardless of how it got
// there (a completed drag, a long-press anywhere on the sleeve, the
// no-engagement timeout, or the "Open" accessibility action elsewhere).
const SHRINK_COMMIT_PROGRESS = 0.6;
const SHRINK_AUTO_PEEL_MS = 2200;     // no engagement this long -- finish on its own, never blocks play
const SHRINK_LONG_PRESS_MS = 500;     // matches player/scrub.js's dead-wax loupe timing

function hypeStickerText(t){
  const year = t && t.tags && t.tags.year;
  return year ? ('New · ' + year) : 'New';
}

// the sealed wrap on the incoming sleeve, shown from the moment it starts
// arriving so it arrives wrapped
function attachSleeveWrap(t){
  removeSleeveWrap();
  const wrap = document.createElement('div');
  wrap.id = 'sleeveWrap';
  wrap.setAttribute('aria-hidden','true');
  const inner = el('div','shrink-wrap-inner');
  inner.appendChild(el('div','shrink-sheen'));
  inner.appendChild(el('div','shrink-wrinkle'));
  inner.appendChild(el('div','shrink-tear-line'));
  inner.appendChild(el('div','seal-sticker', hypeStickerText(t)));
  wrap.appendChild(inner);
  const tab = el('div','shrink-tear-tab');
  tab.setAttribute('aria-hidden','true');
  wrap.appendChild(tab);
  $('#sleeve').appendChild(wrap);
}
// activeShrinkPeel is the one live gesture (if any) a runShrinkWrapPeel()
// call currently has listening — removeSleeveWrap() is the single choke
// point every teardown path (a normal finish, an interrupt mid-peel) goes
// through, so it's also the one place that has to resolve/cancel it, or an
// interrupted drag would leave its own window/tab listeners, and the
// runStartSequence() await that's still waiting on it, hanging forever.
let activeShrinkPeel = null;
function removeSleeveWrap(){
  if(activeShrinkPeel){ const p = activeShrinkPeel; activeShrinkPeel = null; p.finish(); }
  const w = $('#sleeveWrap'); if(w) w.remove();
}

// true while a pointerdown on the shrink-wrap itself (the tear tab, or a
// long-press anywhere on the sleeve) is the live gesture — wiring/
// transport.js's "tap anywhere on the open player interrupts the ceremony"
// listener checks this by target (not by calling this directly: it runs in
// the capture phase, before the shrink-wrap's own pointerdown listener
// below ever sees the event) so starting the drag/long-press doesn't also
// snap the ceremony to its end state out from under the user's own finger
// — the same class of bug PR3 found for the auto-flip Flip/Lift buttons.
export function isShrinkWrapTarget(target){
  return !!(target && target.closest && target.closest('#sleeveWrap'));
}

// drives --tear-progress live from a drag on the tab (same leftward-only,
// absolute-from-start-X shape as library/sealed.js's own wireTearDrag, just
// a different threshold/edge) — a crinkle burst + haptic tick on real
// forward progress, scaled by how much progress each tick covers. Commits
// once progress reaches SHRINK_COMMIT_PROGRESS; released short of it snaps
// back to 0 and the tab is simply ready to be dragged again.
function wireShrinkDrag(wrap, tab, seed, onCommit){
  let hostWidth = 0, startX = 0, dragging = false, cancelled = false;
  let lastProgress = 0, lastCrinkleT = 0;
  tab.style.touchAction = 'none';
  function setProgress(p){
    const c = Math.max(0, Math.min(1, p));
    wrap.style.setProperty('--tear-progress', c.toFixed(3));
    return c;
  }
  function onDown(e){
    if(cancelled || (e.button != null && e.button !== 0)) return;
    dragging = true;
    startX = e.clientX;
    hostWidth = wrap.getBoundingClientRect().width || 1;
    lastCrinkleT = performance.now();
    try{ tab.setPointerCapture(e.pointerId); }catch(_err){}
  }
  function onMove(e){
    if(!dragging || cancelled) return;
    e.preventDefault();
    const left = Math.min(0, e.clientX - startX);
    const progress = setProgress(-left / hostWidth);
    const now = performance.now();
    if(progress > lastProgress + 0.01 && now - lastCrinkleT > 50){
      lastCrinkleT = now;
      playCrinkleBurst(seed, Math.min(1, (progress - lastProgress) * 6));
      hapticTick();
    }
    lastProgress = progress;
    if(progress >= SHRINK_COMMIT_PROGRESS){ dragging = false; onCommit(); }
  }
  function onUp(){
    if(!dragging) return;
    dragging = false;
    setProgress(0); lastProgress = 0;
  }
  tab.addEventListener('pointerdown', onDown);
  tab.addEventListener('pointermove', onMove);
  tab.addEventListener('pointerup', onUp);
  tab.addEventListener('pointercancel', onUp);
  return { cancel(){
    cancelled = true; dragging = false;
    tab.removeEventListener('pointerdown', onDown);
    tab.removeEventListener('pointermove', onMove);
    tab.removeEventListener('pointerup', onUp);
    tab.removeEventListener('pointercancel', onUp);
  } };
}

// "long-press the sleeve... to peel without the drag" (§2, "Rules") — any
// pointer held on the shrink (not already dragging the tab, which has its
// own gesture) for SHRINK_LONG_PRESS_MS commits immediately.
function wireShrinkLongPress(wrap, onCommit){
  let timer = null, cancelled = false;
  function onDown(){
    if(cancelled) return;
    timer = setTimeout(() => { if(!cancelled) onCommit(); }, SHRINK_LONG_PRESS_MS);
  }
  function clear(){ if(timer){ clearTimeout(timer); timer = null; } }
  wrap.addEventListener('pointerdown', onDown);
  wrap.addEventListener('pointerup', clear);
  wrap.addEventListener('pointercancel', clear);
  wrap.addEventListener('pointermove', clear);
  return { cancel(){
    cancelled = true; clear();
    wrap.removeEventListener('pointerdown', onDown);
    wrap.removeEventListener('pointerup', clear);
    wrap.removeEventListener('pointercancel', clear);
    wrap.removeEventListener('pointermove', clear);
  } };
}

// the one terminal animation every trigger (drag-commit, long-press,
// auto-timeout, the accessible "Open" action) ends at — detach and fall
// (~400ms, reusing SLEEVE_ANIM.peelOffMs), or Reduced Motion's plain fade.
async function finishShrinkPeel(cancelled){
  if(cancelled()) return;
  const wrap = $('#sleeveWrap');
  if(!wrap) return;
  if(REDUCED){
    wrap.classList.add('shrink-fading');
    await sleep(150);
    if(cancelled()) return;
    removeSleeveWrap();
    return;
  }
  void wrap.offsetWidth;
  wrap.classList.add('shrink-detached');
  await sleep(SLEEVE_ANIM.peelOffMs);
  if(cancelled()) return;
  removeSleeveWrap();
}

// Races the drag, the long-press and the no-engagement timeout against each
// other; whichever fires first tears everything else down and runs the one
// shared finish. Never blocks play (§2, "Rules") — the timeout is the hard
// backstop regardless of whether the user ever touches the sleeve at all.
function runShrinkWrapPeel(cancelled, seed){
  return new Promise(resolve => {
    const wrap = $('#sleeveWrap');
    if(!wrap || REDUCED){ finishShrinkPeel(cancelled).then(resolve); return; }
    const tab = wrap.querySelector('.shrink-tear-tab');
    if(!tab){ finishShrinkPeel(cancelled).then(resolve); return; }
    let done = false;
    let drag, longPress, timer;
    const finish = () => {
      if(done) return;
      done = true;
      drag.cancel(); longPress.cancel(); clearTimeout(timer);
      activeShrinkPeel = null;
      finishShrinkPeel(cancelled).then(resolve);
    };
    activeShrinkPeel = { finish };
    drag = wireShrinkDrag(wrap, tab, seed, finish);
    longPress = wireShrinkLongPress(wrap, finish);
    timer = setTimeout(finish, SHRINK_AUTO_PEEL_MS);
  });
}

export async function runStartSequence(t, info, startAudio){
  const stage = $('#platterStage');
  const token = ++S.sleeveSeq;
  const cancelled = () => token !== S.sleeveSeq;
  S.platterEmpty = false;   // a pull is starting, so the sleeve no longer covers an empty platter
  cancelRunout();           // a new record cancels a groove or flip still running
  clearSpinDown();

  // clear any in-flight ceremony's visuals immediately — a fresh sequence
  // (or a "nothing to show" one) always takes the stage back over from
  // whatever a just-cancelled prior invocation left behind
  stage.classList.remove(...STAGE_CLASSES);
  $('#sleeve').style.display = 'none';
  hideOutgoingSleeve();
  removeSleeveWrap();

  if(!t || !info || info.type === 'none' || !S.sleevePullEnabled || REDUCED || document.hidden){
    // no ceremony to carry it — play() itself breaks a sealed album's seal
    // silently the instant it actually starts (SEALED spec §6). Nothing of
    // the sleeve is shown here, so the shrink-wrap peel has nothing to
    // animate — just the crinkle, "or a crinkle sound only in the
    // background" (docs/15_SURFACE_NOISE.md §2, "Rules" — it never blocks
    // play, from a track list/search/lock-screen tap same as anywhere else).
    // PL3 (docs/19_PLAYER.md): an album change while the page is hidden
    // skips the sleeve ceremony's sleep()/animation waits entirely and
    // starts the next album directly, the same way side flips and skips
    // already bail on document.hidden (runout.js's endOfQueue/sideFlipTurnAt).
    if(t && isAlbumSealed(albumKey(t))) playCrinkleBurst(releaseSeed(albumKey(t)), 0.4);
    $('#platterBox').classList.remove('disc-hidden');   // nothing will emerge it, so it's just there
    startAudio();
    return;
  }

  // captured once, at the start — not re-checked mid-ceremony, so the peel
  // either runs once in full or not at all (SEALED spec §6, "once per album")
  const sealedForPeel = isAlbumSealed(albumKey(t));

  // decode ahead of time so playback can start the instant the disc lands,
  // never after — runs in parallel with the sleeve/disc motion below
  const bufferReady = ensureBuffer(S.index);
  const discBox = $('#platterBox');

  // CEREMONY §4: the change overlaps. The platter spins down while the old
  // record lifts and slides into its own sleeve, that sleeve leaves (left on
  // desktop, down on a phone), and the new sleeve starts arriving before the
  // old one has gone (CHANGE_TIMELINE, shell/ceremony-timing.js).
  const swapping = info.type === 'swap';
  if(swapping){
    showOutgoingSleeve(info.outgoingArt, info.outgoingHasArt);
    startSpinDown(CHANGE_TIMELINE.spinDown[1] - CHANGE_TIMELINE.spinDown[0]);
    void stage.offsetWidth;
    stage.classList.add('changing');
    await sleep(CHANGE_TIMELINE.arriveStart);
    if(cancelled()) return;
    clearSpinDown();
    // the old disc is inside its sleeve by now (the 'changing' keyframe ends
    // it at opacity 0) — this class keeps it hidden once that class goes
    discBox.classList.add('disc-hidden');
    stage.style.setProperty('--arrive-duration', CHANGE_TIMELINE.arriveMs + 'ms');
  }
  if(cancelled()) return;

  sleeveArtFor(t.art, !!t.art);
  applySleeveWear($('#sleeve'), albumKey(t));
  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging');
  $('#sleeve').style.display = 'flex';
  if(sealedForPeel) attachSleeveWrap(t);
  void stage.offsetWidth;              // force a reflow so this restarts cleanly if triggered back-to-back
  stage.classList.add('sleeve-arriving');
  await waitAnimEnd($('#sleeve'), swapping ? CHANGE_TIMELINE.arriveMs : SLEEVE_ANIM.arriveMs);
  if(cancelled()) return;
  stage.classList.remove('sleeve-arriving', 'changing');
  if(swapping) hideOutgoingSleeve();

  if(sealedForPeel){
    await runShrinkWrapPeel(cancelled, releaseSeed(albumKey(t)));
    if(cancelled()) return;
    breakSeal(albumKey(t));
  }

  // hold: the sleeve sits static on an empty platter until the buffer is
  // ready, capped so a slow decode never stalls the ceremony indefinitely
  await Promise.race([bufferReady, sleep(SLEEVE_ANIM.holdCapMs)]);
  if(cancelled()) return;

  // disc-hidden comes off exactly as the emerge animation takes over, so its
  // own 0%-opacity start frame is what the disc is actually cutting in from
  discBox.classList.remove('disc-hidden');
  stage.classList.add('sleeve-exiting','disc-emerging');
  await Promise.all([waitAnimEnd($('#sleeve'), SLEEVE_ANIM.emergeMs), waitAnimEnd(discBox, SLEEVE_ANIM.emergeMs)]);
  if(cancelled()) return;
  stage.classList.remove('sleeve-exiting','disc-emerging');
  $('#sleeve').style.display = 'none';

  startAudio();
}

// Cuts the ceremony at whatever point it's in and snaps to the end state
// instantly — no transition, per the hard rule that skipping is instant,
// never eased. Playback is clearly no longer waiting on ceremony once
// interrupted, so it starts right away if it hadn't already.
export function interruptStartSequence(){
  // a groove or a side flip lands where it was heading instead (CEREMONY §2/§3)
  if(interruptRunout()) return;
  S.sleeveSeq++;
  const stage = $('#platterStage');
  const wasPutAway = stage.classList.contains('putaway-in') || stage.classList.contains('putaway-slide') ||
    stage.classList.contains('putaway-out');
  // the peel sits in a gap between stage classes (after 'sleeve-arriving' is
  // removed, before the hold/emerge classes are added) — #sleeveWrap's
  // presence is what marks that window as "active" (SEALED spec §6)
  const wasActive = wasPutAway || stage.classList.contains('sleeve-arriving') || stage.classList.contains('sleeve-exiting') ||
    stage.classList.contains('disc-emerging') || stage.classList.contains('returning') ||
    stage.classList.contains('changing') || !!$('#sleeveWrap');
  stage.classList.remove(...STAGE_CLASSES);
  clearSpinDown();
  $('#sleeve').style.display = 'none';
  hideOutgoingSleeve();
  // a tap during the peel snaps straight to the end state: wrap gone, no
  // eased snap (SEALED spec §6, "Interrupt") — the seal itself only breaks
  // once playback is actually about to start, same as everywhere else
  removeSleeveWrap();
  if(wasPutAway){
    // the record was mid-way into its sleeve — finish putting it away rather
    // than resurrecting the disc; pressing play afterwards is what brings it
    // back out (via the S.platterEmpty rule in updateShellAlbum())
    $('#platterBox').classList.add('disc-hidden');
    S.platterEmpty = true;
    renderMiniPlayer();
    return;
  }
  $('#platterBox').classList.remove('disc-hidden');   // skipping lands the record instantly
  if(wasActive && !S.playing) play();   // play() itself breaks the seal the instant it actually starts
}
