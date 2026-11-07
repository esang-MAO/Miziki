// docs/32_SHELF_AND_TURNTABLES.md, ST3: Edit crate -> Shelf finish sheet.
// Reuses the app's generic edit-overlay sheet pattern (src/library/
// credits.js's openCreditsSheet() is the template this follows).
import { $, el } from '../util/dom.js';
import { S } from '../state.js';
import { openLayer } from '../shell/nav-stack.js';
import { queueSave } from '../storage/meta.js';
import { hasDeluxe } from '../deluxe.js';
import { SHELF_FINISHES, shelfFinishInfo, displayShelfFinish } from './shelf-finish.js';
import { renderShelfUnit } from './shelf-unit.js';
import { shelfUnitRenderProps } from './storefront.js';

// The sheet's own transient pick, separate from S.shelfFinish: tapping a
// Deluxe finish without Deluxe (point 3) previews it here without saving,
// and closing the sheet (closeShelfFinishSheet) drops this, so reopening
// always starts from the real saved value again.
let previewId = null;

function finishSwatch(f, current){
  const btn = el('button', 'shelf-finish-sw');
  btn.setAttribute('role', 'radio');
  const selected = f.id === current;
  btn.setAttribute('aria-checked', String(selected));
  if(selected) btn.classList.add('selected');
  const chip = el('span', 'shelf-finish-chip');
  chip.style.background = 'repeating-linear-gradient(178deg,' + f.line + ' 0px,' + f.line + ' 1px,transparent 1px,transparent 5px),'
    + 'linear-gradient(160deg,' + f.hi + ' 0%,' + f.base + ' 100%)';
  btn.appendChild(chip);
  btn.appendChild(el('span', 'shelf-finish-sw-label', f.label));
  if(f.deluxe) btn.appendChild(el('span', 'shelf-finish-sw-tag', 'DELUXE'));
  btn.addEventListener('click', () => pickFinish(f.id));
  return btn;
}

// ST3 point 3: "without Deluxe, tapping Teak/Ash/Black ash previews it on
// the unit but doesn't save; leaving the sheet returns to the saved
// finish. No upsell copy beyond the tag and caption." A finish Deluxe
// does allow saves immediately, the same instant-apply shape every other
// picker in this app uses (theme segmented control, turntable picker) --
// no separate "Save"/"Done" step.
function pickFinish(id){
  const info = shelfFinishInfo(id);
  if(info.deluxe && !hasDeluxe()){
    previewId = id;
  } else {
    previewId = null;
    S.shelfFinish = id;
    queueSave();
  }
  renderShelfFinishSheet();
}

function renderShelfFinishSheet(){
  const body = $('#shelfFinishBody');
  body.innerHTML = '';

  const shown = previewId || displayShelfFinish(S.shelfFinish, hasDeluxe());
  const previewWrap = el('div', 'shelf-finish-preview');
  previewWrap.appendChild(renderShelfUnit(Object.assign({model: 'standard', finish: shown, onTapAlbum: () => {}}, shelfUnitRenderProps())));
  body.appendChild(previewWrap);

  const group = el('div', 'shelf-finish-swatches');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Shelf finish');
  SHELF_FINISHES.forEach(f => group.appendChild(finishSwatch(f, shown)));
  body.appendChild(group);

  const cur = shelfFinishInfo(shown);
  const currentInfo = el('div', 'shelf-finish-current');
  currentInfo.appendChild(el('span', 'shelf-finish-current-name', cur.label));
  currentInfo.appendChild(el('span', 'shelf-finish-current-note', cur.note));
  body.appendChild(currentInfo);

  body.appendChild(el('p', 'note shelf-finish-caption',
    'Walnut and Oak come with Miziki; Teak, Ash and Black ash come with Deluxe. Friends who visit your crate see it in your finish.'));
}

export function openShelfFinishSheet(){
  previewId = null;
  renderShelfFinishSheet();
  const overlay = $('#shelfFinishOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  openLayer('shelf-finish', closeShelfFinishSheet, {container: overlay});
}

export function closeShelfFinishSheet(){
  previewId = null;
  $('#shelfFinishOverlay').classList.remove('open');
  $('#shelfFinishOverlay').setAttribute('aria-hidden', 'true');
}
