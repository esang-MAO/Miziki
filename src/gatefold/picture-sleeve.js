/* ================= 7″ picture sleeve (docs/17_SINGLES.md) =================
   A single — one side, one track (isSingleRecord(), below) — opens into
   this flat, fading sheet instead of the gatefold's two-panel 3D swing.
   Same shape as sealed-sheet.js (which this file sits beside, not inside,
   for the same reason that one does: it needs GF/buildGatefoldTracklist/
   gatefoldTrackIndices from view.js, and is its own small UI concern, not
   library/sealed.js's sealed-records *data*). "Fade in open" (Ken) --
   sealed-sheet.js's own open/close timing (sleep(REDUCED ? 150 : 250)),
   reused verbatim rather than the gatefold's ~950ms swing, since there's
   no second panel for a flight to resolve into here either. "Keep all"
   (Ken) of the gatefold's own left-panel content -- buildGatefoldLeftPanel()
   (view.js) is exported and called wholesale, not reimplemented. */
import { S, current } from '../state.js';
import { $, el } from '../util/dom.js';
import { sleep } from '../util/async.js';
import { REDUCED } from '../util/motion.js';
import { thumbURL } from '../library/thumbs.js';
import { getCrateArtURL } from '../crate/tiers.js';
import { fmt } from '../player/clock.js';
import { buildPeekDisc } from '../record-art/peek.js';
import { albumFormatFor } from '../shell/ceremony-timing.js';
import { formatChipText } from '../record-art/format.js';
import { setQueue } from '../player/queue.js';
import { play } from '../player/transport.js';
import { runStartSequence } from '../shell/start-sequence.js';
import { openPlayerViaSheet } from '../shell/player-overlay.js';
import { GF, gatefoldTrackIndices, buildGatefoldLeftPanel } from './view.js';
import { openLayer, forceCloseLayer } from '../shell/nav-stack.js';

let SLEEVE = null;   // {item, returnFocus}, null when closed

// A single: exactly one side, exactly one track (Ken: "a single should be
// one side with ≤1 track") -- a track-count check only, independent of
// record-art/format.js's own duration-based format table (docs/17_SINGLES.md
// "What counts as a single"). splitSides() returns null for both a
// single-track record and a zero-track one, so it can't tell them apart on
// its own -- this is a new, separate check.
export function isSingleRecord(item){
  return gatefoldTrackIndices(item).length === 1;
}

export function isPictureSleeveOpen(){ return !!SLEEVE; }

// the same "is the single actually seated on the platter right now" check
// gatefold/view.js's own module-private gatefoldOnPlatter() makes --
// duplicated as a one-liner rather than exported for it, the same small-
// shared-formula call the project already makes elsewhere (sync/images.js).
function onPlatter(item){
  return S.shellAlbumId === item.albumId && !S.platterEmpty;
}

function buildPlayRow(item, i){
  const t = S.tracks[i];
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'picture-sleeve-play';
  const isNow = i === S.index && onPlatter(item);
  row.classList.toggle('picture-sleeve-now', isNow);
  row.appendChild(el('span','picture-sleeve-play-glyph', isNow ? '♫' : '▶'));
  const text = el('div','picture-sleeve-play-text');
  text.appendChild(el('span','picture-sleeve-play-title', t.tags.title));
  text.appendChild(el('span','picture-sleeve-play-dur', fmt(t.duration)));
  row.appendChild(text);
  row.addEventListener('click', () => sleeveHandoffPlay(item, i));
  return row;
}

// mirrors sealed-sheet.js's own sealedHandoffPlay -- there's no sleeve-disc
// flight target here any more than there is for a sealed single, so the
// same reuse-the-ceremony-wholesale shape applies rather than a new flight.
function sleeveHandoffPlay(item, i){
  const trackIdx = gatefoldTrackIndices(item);
  setQueue(trackIdx, trackIdx.indexOf(i), false);
  forceCloseLayer('picture-sleeve');
  if(!S.playInFullPlayer){
    runStartSequence(current(), S.pendingShellInfo, play);
    return;
  }
  if(S.playerOpen) runStartSequence(current(), S.pendingShellInfo, play);
  else openPlayerViaSheet(current(), S.pendingShellInfo);
}

export function openPictureSleeve(item){
  if(SLEEVE || GF) return;
  const trackIdx = gatefoldTrackIndices(item);
  if(trackIdx.length !== 1) return;
  SLEEVE = {item, returnFocus: document.activeElement};
  const sheet = $('#pictureSleeve');
  sheet.setAttribute('aria-label', item.album);

  const art = thumbURL['album:' + item.albumId] || (S.tracks[item.idx[0]] && S.tracks[item.idx[0]].art) || '';
  const img = $('#pictureSleeveArt');
  img.src = art || '';
  getCrateArtURL(item.albumId, 'L').then(url => { if(url && SLEEVE && SLEEVE.item === item) img.src = url; });

  const peekHost = $('#pictureSleevePeek');
  peekHost.innerHTML = '';
  peekHost.appendChild(buildPeekDisc(S.tracks[trackIdx[0]]));

  $('#pictureSleeveArtist').textContent = item.artist.toUpperCase();
  $('#pictureSleeveTitle').textContent = item.album;
  const format = albumFormatFor(trackIdx, S.tracks, (S.albumFormat && S.albumFormat[item.albumId]) || 'auto');
  const chip = $('#pictureSleeveFormat');
  chip.textContent = formatChipText(format);

  const body = $('#pictureSleeveBody');
  body.innerHTML = '';
  body.appendChild(buildPlayRow(item, trackIdx[0]));
  body.appendChild(buildGatefoldLeftPanel(item));

  const close = $('#pictureSleeveClose');
  close.onclick = () => forceCloseLayer('picture-sleeve');

  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden','false');
  requestAnimationFrame(() => { sheet.classList.add('show'); body.focus(); });
  openLayer('picture-sleeve', closePictureSleeve, { instantClose: closePictureSleeveInstant, container: sheet });
}

export async function closePictureSleeve(){
  if(!SLEEVE) return;
  const s = SLEEVE; SLEEVE = null;
  const sheet = $('#pictureSleeve');
  sheet.classList.remove('show');
  await sleep(REDUCED ? 150 : 250);
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden','true');
  if(s.returnFocus && document.contains(s.returnFocus) && typeof s.returnFocus.focus === 'function') s.returnFocus.focus();
  else { const stage = $('.crate-stage'); if(stage) stage.focus(); }
}

function closePictureSleeveInstant(){
  if(!SLEEVE) return;
  SLEEVE = null;
  const sheet = $('#pictureSleeve');
  sheet.classList.remove('open','show');
  sheet.setAttribute('aria-hidden','true');
}
