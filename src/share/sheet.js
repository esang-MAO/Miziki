import { S, current } from '../state.js';
import { $ } from '../util/dom.js';
import { resolveLook } from '../record-art/looks.js';
import { currentDayPosition } from '../sundown/solar.js';
import { composeShareImage } from './crate-card.js';
import { composePlayerShareImage } from './now-playing-card.js';

/* ---- share sheet wiring: style/format read from the DOM (the sheet's own
   chips), everything else (the pixels) comes from the pure composers above.
   Live preview re-renders are debounced ~100ms so rapid taps don't each
   trigger a full recompose. ---- */
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

let shareRenderTimer = null;
async function renderShareCanvas(){
  const style = shareSelectedStyle('shareStyleRow');
  const format = shareSelectedFormat('shareFormatSeg', 'square');
  const canvas = await composeShareImage({style, format, sections: S.shareSelection});
  const target = $('#shareCanvas');
  target.width = canvas.width; target.height = canvas.height;
  target.getContext('2d').drawImage(canvas, 0, 0);
}
export function queueShareRender(){ clearTimeout(shareRenderTimer); shareRenderTimer = setTimeout(renderShareCanvas, 100); }
export async function openShareSheet(){
  const format = S.shareFormat || 'square';
  document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.style === S.shareStyle)));
  document.querySelectorAll('#shareFormatSeg [data-format]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.format === format)));
  updateShareActionButtons($('#shareShareBtn'), $('#shareSave'), $('#shareCopy'));
  $('#shareOverlay').classList.add('open');
  $('#shareOverlay').setAttribute('aria-hidden','false');
  await renderShareCanvas();
}
export function closeShareSheet(){
  $('#shareOverlay').classList.remove('open');
  $('#shareOverlay').setAttribute('aria-hidden','true');
}

let playerShareRenderTimer = null;
async function renderPlayerShareCanvas(){
  const t = current();
  const style = shareSelectedStyle('playerShareStyleRow');
  const format = shareSelectedFormat('playerShareFormatSeg', 'story');
  // DA6 (docs/DAY_ARC.md): currentDayPosition(), not realDayPosition() --
  // the card is "a picture of what's on screen," per the doc's own
  // wording, so it shows the previewed phase while Preview the day is
  // active, the same as every other on-screen Sundown readout.
  const data = t ? { track: t, elapsed: S.pos, duration: t.duration || 0,
    look: resolveLook(t), mode: S.mode, year: t.details && t.details.year,
    phase: currentDayPosition().phase, includePhase: S.playerShareSelection.phase !== false } : null;
  const canvas = await composePlayerShareImage({style, format, data});
  const target = $('#playerShareCanvas');
  target.width = canvas.width; target.height = canvas.height;
  target.getContext('2d').drawImage(canvas, 0, 0);
}
export function queuePlayerShareRender(){ clearTimeout(playerShareRenderTimer); playerShareRenderTimer = setTimeout(renderPlayerShareCanvas, 100); }
export async function openPlayerShareSheet(){
  if(!current()) return;
  const format = S.shareFormat || 'story';
  document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.style === S.shareStyle)));
  document.querySelectorAll('#playerShareFormatSeg [data-format]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.format === format)));
  updateShareActionButtons($('#playerShareShareBtn'), $('#playerShareSave'), $('#playerShareCopy'));
  $('#playerShareOverlay').classList.add('open');
  $('#playerShareOverlay').setAttribute('aria-hidden', 'false');
  await renderPlayerShareCanvas();
}
export function closePlayerShareSheet(){
  $('#playerShareOverlay').classList.remove('open');
  $('#playerShareOverlay').setAttribute('aria-hidden', 'true');
}
