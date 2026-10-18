/* ================= wiring: share sheets =================
   Moved out of main.js's "wiring" IIFE (step 7f) — the My Crate share
   sheet and the Now Playing share sheet (close, section toggles,
   style/format chips, save/share/copy). Every function called here
   was already a real export of its owning module. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { queueSave } from '../storage/meta.js';
import {
  openPlayerShareSheet,
  queueShareRender, queuePlayerShareRender, shareDoSave, shareDoShare, shareDoCopy, shareSelectedFormat,
} from '../share/sheet.js';
import { closeLayer } from '../shell/nav-stack.js';

export function wireShare(){
  $('#shareClose').addEventListener('click', () => closeLayer('share'));
  // RF10 (docs/12_REFINE.md): Style + Include live behind a plain
  // hidden-attribute disclosure now, same open/close shape as RF9's
  // #soundAdvancedToggle (src/wiring/character.js) -- nothing to seed on
  // open, since the style/toggle buttons inside already reflect S.shareStyle/
  // S.shareSelection regardless of whether the panel is visible.
  const shareMoreToggle = $('#shareMoreToggle'), shareMoreBody = $('#shareMoreBody');
  shareMoreToggle.addEventListener('click', () => {
    const opening = shareMoreBody.hidden;
    shareMoreBody.hidden = !opening;
    shareMoreToggle.setAttribute('aria-expanded', String(opening));
  });
  document.querySelectorAll('#shareToggles button').forEach(b => b.addEventListener('click', ()=>{
    const key = b.dataset.section;
    S.shareSelection[key] = !S.shareSelection[key];
    b.setAttribute('aria-pressed', String(S.shareSelection[key]));
    queueShareRender();
  }));
  document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(b => b.addEventListener('click', ()=>{
    S.shareStyle = b.dataset.style;
    document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.style === S.shareStyle)));
    queueSave(); queueShareRender();
  }));
  document.querySelectorAll('#shareFormatSeg [data-format]').forEach(b => b.addEventListener('click', ()=>{
    S.shareFormat = b.dataset.format;
    document.querySelectorAll('#shareFormatSeg [data-format]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queueShareRender();
  }));
  $('#shareShareBtn').addEventListener('click', () => shareDoShare($('#shareCanvas'), 'miziki-crate-' + shareSelectedFormat('shareFormatSeg','square') + '.png'));
  $('#shareSave').addEventListener('click', () => shareDoSave($('#shareCanvas'), 'miziki-crate-' + shareSelectedFormat('shareFormatSeg','square') + '.png'));
  $('#shareCopy').addEventListener('click', () => shareDoCopy($('#shareCanvas')));

  $('#playerShareBtn').addEventListener('click', openPlayerShareSheet);
  $('#playerShareClose').addEventListener('click', () => closeLayer('player-share'));
  // RF10: the Now Playing sheet's own copy of the same disclosure.
  const playerShareMoreToggle = $('#playerShareMoreToggle'), playerShareMoreBody = $('#playerShareMoreBody');
  playerShareMoreToggle.addEventListener('click', () => {
    const opening = playerShareMoreBody.hidden;
    playerShareMoreBody.hidden = !opening;
    playerShareMoreToggle.setAttribute('aria-expanded', String(opening));
  });
  document.querySelectorAll('#playerShareToggles button').forEach(b => b.addEventListener('click', ()=>{
    const key = b.dataset.section;
    S.playerShareSelection[key] = !S.playerShareSelection[key];
    b.setAttribute('aria-pressed', String(S.playerShareSelection[key]));
    queuePlayerShareRender();
  }));
  document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(b => b.addEventListener('click', ()=>{
    S.shareStyle = b.dataset.style;
    document.querySelectorAll('#playerShareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.style === S.shareStyle)));
    queueSave(); queuePlayerShareRender();
  }));
  document.querySelectorAll('#playerShareFormatSeg [data-format]').forEach(b => b.addEventListener('click', ()=>{
    S.shareFormat = b.dataset.format;
    document.querySelectorAll('#playerShareFormatSeg [data-format]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queuePlayerShareRender();
  }));
  $('#playerShareShareBtn').addEventListener('click', () => shareDoShare($('#playerShareCanvas'), 'miziki-now-playing-' + shareSelectedFormat('playerShareFormatSeg','story') + '.png'));
  $('#playerShareSave').addEventListener('click', () => shareDoSave($('#playerShareCanvas'), 'miziki-now-playing-' + shareSelectedFormat('playerShareFormatSeg','story') + '.png'));
  $('#playerShareCopy').addEventListener('click', () => shareDoCopy($('#playerShareCanvas')));
}
