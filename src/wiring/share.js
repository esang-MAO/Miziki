/* ================= wiring: the share sheet =================
   SH1 (docs/18_SHARE.md) collapsed the two separate sheets (My Crate,
   Now Playing) into one -- this file wires only its static controls
   (close, style chips, format seg, save/share/copy, the More-options
   disclosure). The per-card Include toggles are rebuilt on every open and
   wired inline there instead (src/share/sheet.js's buildIncludeToggles),
   since the set of buttons itself changes with the card.

   TR2 (docs/19_PLAYER.md): src/share/* (five canvas card composers) is
   real weight launch never needs, so every listener here dynamically
   imports it instead of a top-level static import -- a share sheet can
   only ever be open (these buttons visible/clickable) after one of the
   open entry points (openPlayerShareSheet here, or openShareSheet from
   profile/records.js, profile/screens.js, gatefold/view.js) already ran
   its own import('../share/sheet.js'), so by the time a user reaches any
   listener below the module is already fetched and import() just returns
   the cached module -- no added delay, no behavior change. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { queueSave } from '../storage/meta.js';
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
  document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(b => b.addEventListener('click', async ()=>{
    S.shareStyle = b.dataset.style;
    document.querySelectorAll('#shareStyleRow .share-style-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave();
    const { queueShareRender } = await import('../share/sheet.js');
    queueShareRender();
  }));
  document.querySelectorAll('#shareFormatSeg [data-format]').forEach(b => b.addEventListener('click', async ()=>{
    const { shareCurrentCard, queueShareRender } = await import('../share/sheet.js');
    S.shareFormatByCard[shareCurrentCard()] = b.dataset.format;
    document.querySelectorAll('#shareFormatSeg [data-format]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    queueSave(); queueShareRender();
  }));
  $('#shareShareBtn').addEventListener('click', async () => {
    const { shareDoShare, shareFilename } = await import('../share/sheet.js');
    shareDoShare($('#shareCanvas'), shareFilename());
  });
  $('#shareSave').addEventListener('click', async () => {
    const { shareDoSave, shareFilename } = await import('../share/sheet.js');
    shareDoSave($('#shareCanvas'), shareFilename());
  });
  $('#shareCopy').addEventListener('click', async () => {
    const { shareDoCopy } = await import('../share/sheet.js');
    shareDoCopy($('#shareCanvas'));
  });

  // SH1 item 4: the player's own visible Share icon button, replacing the
  // old #playerShareBtn overflow row -- opens the sheet on the Now
  // Playing card. This is one of the module's own "first use" entry
  // points -- see this file's own header comment.
  $('#playerShareIconBtn').addEventListener('click', async () => {
    const { openPlayerShareSheet } = await import('../share/sheet.js');
    openPlayerShareSheet();
  });
}
