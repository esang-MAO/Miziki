// docs/32_SHELF_AND_TURNTABLES.md, ST4: Edit crate -> Turntable sheet.
// Same generic edit-overlay sheet pattern as shelf-finish-sheet.js (ST3),
// simpler: unlike a shelf finish, a turntable you don't have yet isn't
// offered at all (point 6, "a grid of the turntables you have"), so there
// is no tap-to-preview-without-saving step here — every tile shown is one
// an immediate tap actually saves.
import { $, el } from '../util/dom.js';
import { S } from '../state.js';
import { openLayer } from '../shell/nav-stack.js';
import { queueSave } from '../storage/meta.js';
import { hasDeluxe } from '../deluxe.js';
import { TURNTABLE_LINEUP, turntableInfo, turntablesHad, displayTurntable, renderTurntable } from './turntable.js';
import { renderShelfUnit } from './shelf-unit.js';
import { shelfUnitRenderProps } from './storefront.js';

function turntableTile(model, current){
  const btn = el('button', 'turntable-pick-tile');
  btn.setAttribute('role', 'radio');
  const selected = model.id === current;
  btn.setAttribute('aria-checked', String(selected));
  if(selected) btn.classList.add('selected');
  const swatch = el('span', 'turntable-pick-swatch');
  swatch.appendChild(renderTurntable(model.id, true, null, false));
  btn.appendChild(swatch);
  btn.appendChild(el('span', 'turntable-pick-label', model.label));
  btn.addEventListener('click', () => pickTurntable(model.id));
  return btn;
}

function pickTurntable(id){
  S.turntable = id;
  queueSave();
  renderTurntableSheet();
}

function renderTurntableSheet(){
  const body = $('#turntableBody');
  body.innerHTML = '';

  const shown = displayTurntable(S.turntable, S.turntablesFound, hasDeluxe());
  const previewWrap = el('div', 'shelf-finish-preview');
  previewWrap.appendChild(renderShelfUnit(Object.assign({model: shown, onTapAlbum: () => {}}, shelfUnitRenderProps())));
  body.appendChild(previewWrap);

  const had = turntablesHad(S.turntablesFound, hasDeluxe());
  const group = el('div', 'turntable-pick-grid');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Turntable');
  TURNTABLE_LINEUP.filter(m => had.has(m.id)).forEach(m => group.appendChild(turntableTile(m, shown)));
  body.appendChild(group);

  const cur = turntableInfo(shown);
  const currentInfo = el('div', 'shelf-finish-current');
  currentInfo.appendChild(el('span', 'shelf-finish-current-name', cur.label));
  currentInfo.appendChild(el('span', 'shelf-finish-current-note', cur.note));
  body.appendChild(currentInfo);
}

export function openTurntableSheet(){
  renderTurntableSheet();
  const overlay = $('#turntableOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  openLayer('turntable', closeTurntableSheet, {container: overlay});
}

export function closeTurntableSheet(){
  $('#turntableOverlay').classList.remove('open');
  $('#turntableOverlay').setAttribute('aria-hidden', 'true');
}
