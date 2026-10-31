import { S, current } from '../state.js';
import { $, el } from '../util/dom.js';
import { resolveLook } from '../record-art/looks.js';
import { currentDayPosition } from '../sundown/solar.js';
import { composeShareImage } from './crate-card.js';
import { composePlayerShareImage } from './now-playing-card.js';
import { composeRecordShareImage } from './record-card.js';
import { composePressingsShareImage } from './pressings-card.js';
import { composeSeasonShareImage } from './season-card.js';
import { openLayer } from '../shell/nav-stack.js';
import { queueSave } from '../storage/meta.js';

/* SH1 (docs/18_SHARE.md): one share sheet, five cards. Style/format read
   from the DOM (the sheet's own chips), everything else (the pixels)
   comes from the pure composers above. Live preview re-renders are
   debounced ~100ms so rapid taps don't each trigger a full recompose. */

// one entry per card: the head title ("Share · <name>"), the kebab-case
// token its filename uses, and which Include toggles it offers (label
// text, keyed the same way as S.shareSelectionByCard[card]) -- pressings
// has none at all (SH1 item 3), crate shows only "Name" even though its
// composer still unconditionally draws every section S.shareSelectionByCard
// .crate holds until SH5 actually removes them from crate-card.js.
const CARD_TITLES = { nowPlaying:'Now Playing', record:'Record', pressings:'Pressings', crate:'Crate', season:'Season' };
const CARD_FILENAMES = { nowPlaying:'now-playing', record:'record', pressings:'pressings', crate:'crate', season:'season' };
const INCLUDE_LABELS = {
  nowPlaying: { phase:'Time of day' },
  record: { note:'Sleeve note', friends:'Friends' },
  pressings: {},
  crate: { name:'Name' },
  season: { name:'Name' },
};

let currentCard = 'crate';
let currentData = null;

export function shareSelectedStyle(rowId){
  const b = document.querySelector('#' + rowId + ' .share-style-chip[aria-pressed="true"]');
  return b ? b.dataset.style : 'night';
}
export function shareSelectedFormat(segId, fallback){
  const b = document.querySelector('#' + segId + ' [aria-pressed="true"]');
  return b ? b.dataset.format : fallback;
}
function canShareFiles(){
  try{ return !!(navigator.canShare && navigator.share && navigator.canShare({files:[new File([''], 'x.png', {type:'image/png'})]})); }
  catch(_e){ return false; }
}
function canCopyImages(){ return !!(navigator.clipboard && window.ClipboardItem); }
export function updateShareActionButtons(shareBtn, saveBtn, copyBtn){
  const canShare = canShareFiles();
  shareBtn.style.display = canShare ? '' : 'none';
  saveBtn.classList.toggle('ghost', canShare);
  saveBtn.classList.toggle('share-primary', !canShare);
  copyBtn.style.display = canCopyImages() ? '' : 'none';
}
function shareExportToBlob(canvas, cb){ canvas.toBlob(cb, 'image/png'); }
export function shareDoSave(canvas, filename){
  shareExportToBlob(canvas, blob => {
    if(!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}
export function shareDoShare(canvas, filename){
  shareExportToBlob(canvas, blob => {
    if(!blob) return;
    const file = new File([blob], filename, {type:'image/png'});
    if(navigator.canShare && navigator.canShare({files:[file]})) navigator.share({files:[file], title:'Miziki'}).catch(()=>{});
  });
}
export function shareDoCopy(canvas){
  shareExportToBlob(canvas, blob => {
    if(!blob || !canCopyImages()) return;
    navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).catch(()=>{});
  });
}

// the filename the sheet's own Save/Share buttons use for whichever card
// is currently open: miziki-<card>-<format>.png (SH1 item 5)
export function shareFilename(){
  const format = shareSelectedFormat('shareFormatSeg', S.shareFormatByCard[currentCard]);
  return 'miziki-' + (CARD_FILENAMES[currentCard] || currentCard) + '-' + format + '.png';
}

// Now Playing's own data gather, under its card key rather than a
// dedicated player-sheet render function. Every other card's data is
// gathered by its own entry point screen and
// handed in via openShareSheet({card, data}), per each card's own SH3/
// SH4/SH6 doc entry ("data is gathered by the gatefold", etc.) -- Now
// Playing is the one exception, since the sheet already reads current()/
// S.pos live the same way renderPlayerShareCanvas always has.
function gatherNowPlayingData(){
  const t = current();
  if(!t) return null;
  // DA6 (docs/DAY_ARC.md): currentDayPosition(), not realDayPosition() --
  // the card is "a picture of what's on screen," per the doc's own
  // wording, so it shows the previewed phase while Preview the day is
  // active, the same as every other on-screen Sundown readout.
  return { track: t, look: resolveLook(t), mode: S.mode, year: t.details && t.details.year,
    phase: currentDayPosition().phase, includePhase: S.shareSelectionByCard.nowPlaying.phase !== false,
    ownerName: S.profile.name || null };
}

async function composeForCurrentCard(style, format){
  if(currentCard === 'crate') return composeShareImage({style, format, sections: S.shareSelectionByCard.crate});
  if(currentCard === 'nowPlaying') return composePlayerShareImage({style, format, data: gatherNowPlayingData()});
  if(currentCard === 'record') return composeRecordShareImage({style, format, data: currentData});
  if(currentCard === 'pressings') return composePressingsShareImage({style, format, data: currentData});
  if(currentCard === 'season') return composeSeasonShareImage({style, format, data: currentData});
  return composeShareImage({style, format, sections: S.shareSelectionByCard.crate});
}

let shareRenderTimer = null;
async function renderShareCanvas(){
  const style = shareSelectedStyle('shareStyleRow');
  const format = shareSelectedFormat('shareFormatSeg', S.shareFormatByCard[currentCard]);
  const canvas = await composeForCurrentCard(style, format);
  const target = $('#shareCanvas');
  target.width = canvas.width; target.height = canvas.height;
  target.getContext('2d').drawImage(canvas, 0, 0);
}
export function queueShareRender(){ clearTimeout(shareRenderTimer); shareRenderTimer = setTimeout(renderShareCanvas, 100); }

// rebuilds #shareToggles for whichever card is open -- each button is
// wired inline here (not via a static delegated listener in wiring/
// share.js) since the set of buttons itself changes on every open.
function buildIncludeToggles(card){
  const host = $('#shareToggles');
  host.textContent = '';
  const labels = INCLUDE_LABELS[card] || {};
  const keys = Object.keys(labels);
  $('#shareIncludeLabel').hidden = keys.length === 0;
  const selection = S.shareSelectionByCard[card] || {};
  keys.forEach(key => {
    const b = el('button', 'cta ghost', labels[key]);
    b.type = 'button';
    b.dataset.section = key;
    b.setAttribute('aria-pressed', String(selection[key] !== false));
    b.addEventListener('click', () => {
      selection[key] = !selection[key];
      b.setAttribute('aria-pressed', String(selection[key]));
      queueSave(); queueShareRender();
    });
    host.appendChild(b);
  });
}

export async function openShareSheet(opts){
  const { card, data } = opts || {};
  currentCard = CARD_TITLES[card] ? card : 'crate';
  currentData = data || null;
  $('#shareHeadTitle').textContent = 'Share · ' + CARD_TITLES[currentCard];
  const format = S.shareFormatByCard[currentCard] || 'square';
  document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.style === S.shareStyle)));
  document.querySelectorAll('#shareFormatSeg [data-format]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.format === format)));
  buildIncludeToggles(currentCard);
  updateShareActionButtons($('#shareShareBtn'), $('#shareSave'), $('#shareCopy'));
  // SH4 item 6: an empty Pressings card has nothing worth exporting --
  // disable every action button rather than let the sheet produce a
  // blank image. The Records screen's own Share button is already hidden
  // in this same case (src/profile/records.js), so this is belt-and-
  // suspenders for any other way the sheet could end up open on it.
  const nothingToShare = currentCard === 'pressings' && !(data && data.records && data.records.length);
  [$('#shareShareBtn'), $('#shareSave'), $('#shareCopy')].forEach(b => { b.disabled = nothingToShare; });
  // RF10: the sheet always opens collapsed -- a prior session's "More
  // options" tap shouldn't carry over into the next open.
  $('#shareMoreBody').hidden = true;
  $('#shareMoreToggle').setAttribute('aria-expanded', 'false');
  const overlay = $('#shareOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  openLayer('share', closeShareSheet, { container: overlay });
  await renderShareCanvas();
}
export function closeShareSheet(){
  $('#shareOverlay').classList.remove('open');
  $('#shareOverlay').setAttribute('aria-hidden','true');
}

// convenience wrapper for the player's own Share icon button -- opens the
// Now Playing card, same as before SH1's openPlayerShareSheet did.
export function openPlayerShareSheet(){
  if(!current()) return;
  return openShareSheet({ card:'nowPlaying' });
}

// the wiring layer's one way to know which card's format default to
// write back to on a format-chip tap (S.shareFormatByCard[<card>])
export function shareCurrentCard(){ return currentCard; }
