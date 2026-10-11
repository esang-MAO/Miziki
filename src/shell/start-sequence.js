import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { REDUCED } from '../util/motion.js';
import { albumKey } from '../record-art/tiers.js';
import { ensureBuffer } from '../player/buffers.js';
import { isAlbumSealed, buildSealOverlay, breakSeal } from '../library/sealed.js';
import { SLEEVE_ANIM, renderMiniPlayer } from './mini-player.js';
import { play } from '../player/transport.js';
import { clearSpinDown } from './put-away.js';

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
// the seal wrap on the incoming sleeve, shown from the moment it starts
// arriving so it arrives wrapped (SEALED spec §6)
function attachSleeveWrap(){
  removeSleeveWrap();
  const wrap = document.createElement('div');
  wrap.id = 'sleeveWrap';
  wrap.setAttribute('aria-hidden','true');
  wrap.appendChild(buildSealOverlay(278));
  wrap.appendChild(el('div','seal-tear'));
  $('#sleeve').appendChild(wrap);
}
function removeSleeveWrap(){ const w = $('#sleeveWrap'); if(w) w.remove(); }

// tear (~300ms) then slide-off (~400ms); each step is checked against the
// same cancellation token as the rest of the ceremony (SEALED spec §6)
async function runSealPeel(cancelled){
  const wrap = $('#sleeveWrap');
  if(!wrap) return;
  void wrap.offsetWidth;
  wrap.classList.add('peel-tear');
  await sleep(SLEEVE_ANIM.peelTearMs);
  if(cancelled()) return;
  wrap.classList.add('peel-off');
  await sleep(SLEEVE_ANIM.peelOffMs);
  if(cancelled()) return;
  removeSleeveWrap();
}

export async function runStartSequence(t, info, startAudio){
  const stage = $('#platterStage');
  const token = ++S.sleeveSeq;
  const cancelled = () => token !== S.sleeveSeq;
  S.platterEmpty = false;   // a pull is starting, so the sleeve no longer covers an empty platter
  clearSpinDown();

  // clear any in-flight ceremony's visuals immediately — a fresh sequence
  // (or a "nothing to show" one) always takes the stage back over from
  // whatever a just-cancelled prior invocation left behind
  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging','returning','putaway-in','putaway-slide','putaway-out');
  $('#sleeve').style.display = 'none';
  removeSleeveWrap();

  if(!t || !info || info.type === 'none' || !S.sleevePullEnabled || REDUCED){
    // no ceremony to carry it — play() itself breaks a sealed album's seal
    // silently the instant it actually starts (SEALED spec §6)
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

  if(info.type === 'swap'){
    sleeveArtFor(info.outgoingArt, info.outgoingHasArt);
    $('#sleeve').style.display = 'flex';
    void stage.offsetWidth;
    stage.classList.add('returning');
    await waitAnimEnd($('#sleeve'), SLEEVE_ANIM.returnMs);
    if(cancelled()) return;
    stage.classList.remove('returning');
    // the outgoing disc just animated to opacity 0 via discReturn's forwards
    // fill — removing that class would otherwise snap it straight back to
    // fully visible, so this class takes over holding it hidden
    discBox.classList.add('disc-hidden');
  }
  if(cancelled()) return;

  sleeveArtFor(t.art, !!t.art);
  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging');
  $('#sleeve').style.display = 'flex';
  if(sealedForPeel) attachSleeveWrap();
  void stage.offsetWidth;              // force a reflow so this restarts cleanly if triggered back-to-back
  stage.classList.add('sleeve-arriving');
  await waitAnimEnd($('#sleeve'), SLEEVE_ANIM.arriveMs);
  if(cancelled()) return;
  stage.classList.remove('sleeve-arriving');

  if(sealedForPeel){
    await runSealPeel(cancelled);
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
  S.sleeveSeq++;
  const stage = $('#platterStage');
  const wasPutAway = stage.classList.contains('putaway-in') || stage.classList.contains('putaway-slide') ||
    stage.classList.contains('putaway-out');
  // the peel sits in a gap between stage classes (after 'sleeve-arriving' is
  // removed, before the hold/emerge classes are added) — #sleeveWrap's
  // presence is what marks that window as "active" (SEALED spec §6)
  const wasActive = wasPutAway || stage.classList.contains('sleeve-arriving') || stage.classList.contains('sleeve-exiting') ||
    stage.classList.contains('disc-emerging') || stage.classList.contains('returning') || !!$('#sleeveWrap');
  stage.classList.remove('sleeve-arriving','sleeve-exiting','disc-emerging','returning','putaway-in','putaway-slide','putaway-out');
  clearSpinDown();
  $('#sleeve').style.display = 'none';
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
