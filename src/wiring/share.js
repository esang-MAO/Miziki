/* ================= wiring: the share sheet =================
   SH1 (docs/18_SHARE.md) collapsed the two separate sheets (My Crate,
   Now Playing) into one -- this file wires only its static controls
   (close, style chips, format seg, save/share/copy, the More-options
   disclosure). The per-card Include toggles are rebuilt on every open and
   wired inline there instead (src/share/sheet.js's buildIncludeToggles),
   since the set of buttons itself changes with the card. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { queueSave } from '../storage/meta.js';
import {
  openPlayerShareSheet, shareCurrentCard, shareFilename,
  queueShareRender, shareDoSave, shareDoShare, shareDoCopy,
} from '../share/sheet.js';
import { closeLayer } from '../shell/nav-stack.js';

export function wireShare(){
  $('#shareClose').addEventListener('click', () => closeLayer('share'));
  // RF10 (docs/12_REFINE.md): Style + Include live behind a plain
  // hidden-attribute disclosure now, same open/close shape as RF9's
  // #soundAdvancedToggle (src/wiring/character.js) -- nothing to seed on
  // open, since the style/toggle buttons inside already reflect
  // S.shareStyle/S.shareSelectionByCard regardless of whether the panel
  // is visible.
  const shareMoreToggle = $('#shareMoreToggle'), shareMoreBody = $('#shareMoreBody');
  shareMoreToggle.addEventListener('click', () => {
    const opening = shareMoreBody.hidden;
    shareMoreBody.hidden = !opening;
    shareMoreToggle.setAttribute('aria-expanded', String(opening));
  });
  document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(b => b.addEventListener('click', ()=>{
    S.shareStyle = b.dataset.style;
    document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queueShareRender();
  }));
  document.querySelectorAll('#shareFormatSeg [data-format]').forEach(b => b.addEventListener('click', ()=>{
    S.shareFormatByCard[shareCurrentCard()] = b.dataset.format;
    document.querySelectorAll('#shareFormatSeg [data-format]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queueShareRender();
  }));
  $('#shareShareBtn').addEventListener('click', () => shareDoShare($('#shareCanvas'), shareFilename()));
  $('#shareSave').addEventListener('click', () => shareDoSave($('#shareCanvas'), shareFilename()));
  $('#shareCopy').addEventListener('click', () => shareDoCopy($('#shareCanvas')));

  // SH1 item 4: the player's own visible Share icon button, replacing the
  // old #playerShareBtn overflow row -- opens the sheet on the Now
  // Playing card.
  $('#playerShareIconBtn').addEventListener('click', openPlayerShareSheet);
}
