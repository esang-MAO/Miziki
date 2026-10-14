/* ================= sealed-record sheet =================
   The album-detail-ish sheet a sealed record opens into, since it can't
   open the real gatefold yet (an unplayed album has no "now playing" state
   to show there). Shares buildGatefoldTracklist()/gatefoldTrackIndices()
   with the gatefold itself (same rendering — order, rows, side splits —
   just a different row-tap handler, SEALED spec §5), which is why this
   lives alongside it rather than in src/library/sealed.js: that module
   stays about the sealed-records *data* (S.sealed, isAlbumSealed, the
   persist calls), not this sheet's own UI.

   Moved out of main.js (step 7e) — see src/gatefold/view.js's own header
   comment for the misleading-header history this and the gatefold shared. */
import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { REDUCED } from '../util/motion.js';
import { thumbURL } from '../library/thumbs.js';
import { getCrateArtURL } from '../crate/tiers.js';
import { buildSealOverlay } from '../library/sealed.js';
import { setQueue } from '../player/queue.js';
import { play } from '../player/transport.js';
import { runStartSequence } from '../shell/start-sequence.js';
import { openPlayerViaSheet } from '../shell/player-overlay.js';
import { GF, buildGatefoldTracklist, gatefoldTrackIndices } from './view.js';
import { openLayer, forceCloseLayer } from '../shell/nav-stack.js';

let SEALSHEET = null;   // {item}, null when closed

export function isSealedSheetOpen(){ return !!SEALSHEET; }

// after a seal breaks, fade the wrap off the small cover if its sheet is
// the one open right now — the sheet itself stays as it is (SEALED spec §5)
export function updateSealedSheetAfterBreak(albumId){
  if(!SEALSHEET || SEALSHEET.item.albumId !== albumId) return;
  const host = $('#sealSheetCoverWrap');
  const bits = host.querySelectorAll('.seal-wrap, .seal-sticker');
  bits.forEach(elm => {
    elm.style.transition = 'opacity .3s';
    elm.style.opacity = '0';
    setTimeout(() => elm.remove(), 300);
  });
}

// a sealed album's first play runs the normal ceremony (so the peel is
// actually seen) but on the platter/mini-player only — never the full
// player sheet (SEALED spec §5: "the sleeve pull runs behind the sheet as
// usual... the player is not forced open"). Used by the crate's own Play
// affordances for a sealed record (list/crate rows) — unchanged by Part 2.
export function sealedQuietPlay(trackIdx, i){
  setQueue(trackIdx, trackIdx.indexOf(i), false);
  runStartSequence(current(), S.pendingShellInfo, play);
}

// the seal sheet's own row tap: the closest equivalent to "the gatefold
// song-tap handler" for an album that can't open the gatefold yet (Part 2
// §1, "Sealed albums"). A sealed album was by definition never played, so
// this is always the "different album" case — peel first (the existing S5
// peel, reused as-is via runStartSequence), then the hand-off's spirit is
// satisfied by forcing the player open (rather than staying quiet) when the
// setting is on. There is no separate pocket to fly from here, so unlike
// gatefoldPlayTrack this reuses the ceremony wholesale instead of the flight.
function sealedHandoffPlay(trackIdx, i){
  setQueue(trackIdx, trackIdx.indexOf(i), false);
  forceCloseLayer('sealed-sheet');
  if(!S.playInFullPlayer){
    runStartSequence(current(), S.pendingShellInfo, play);
    return;
  }
  if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
  else openPlayerViaSheet(current(), S.pendingShellInfo);
}

export function openSealedSheet(item){
  if(SEALSHEET || GF) return;
  const trackIdx = gatefoldTrackIndices(item);
  if(!trackIdx.length) return;
  SEALSHEET = {item, returnFocus: document.activeElement};
  const sheet = $('#sealSheet');
  sheet.setAttribute('aria-label', item.album);
  $('#sealSheetArtist').textContent = item.artist.toUpperCase();
  $('#sealSheetTitle').textContent = item.album;
  const coverWrap = $('#sealSheetCoverWrap');
  coverWrap.querySelectorAll('.seal-wrap, .seal-sticker').forEach(n => n.remove());
  coverWrap.appendChild(buildSealOverlay(96));
  const art = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art) || '';
  if(art) $('#sealSheetCoverArt').src = art;
  getCrateArtURL(item.albumId, 'S').then(url => { if(url && SEALSHEET && SEALSHEET.item === item) $('#sealSheetCoverArt').src = url; });
  $('#sealSheetBody').innerHTML = '';
  $('#sealSheetBody').appendChild(buildGatefoldTracklist(item, trackIdx, sealedHandoffPlay));

  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden','false');
  requestAnimationFrame(() => { sheet.classList.add('show'); $('#sealSheetBody').focus(); });
  openLayer('sealed-sheet', closeSealedSheet, { instantClose: closeSealedSheetInstant, container: sheet });
}

export async function closeSealedSheet(){
  if(!SEALSHEET) return;
  const s = SEALSHEET; SEALSHEET = null;
  const sheet = $('#sealSheet');
  sheet.classList.remove('show');
  await sleep(REDUCED ? 150 : 250);
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden','true');
  if(s.returnFocus && document.contains(s.returnFocus) && typeof s.returnFocus.focus === 'function') s.returnFocus.focus();
  else { const stage = $('.crate-stage'); if(stage) stage.focus(); }
}

// non-animated close, for when a track tap is already handing off to the
// player sheet — mirrors closeGatefoldInstant()'s role for the gatefold
function closeSealedSheetInstant(){
  if(!SEALSHEET) return;
  SEALSHEET = null;
  const sheet = $('#sealSheet');
  sheet.classList.remove('open','show');
  sheet.setAttribute('aria-hidden','true');
}
