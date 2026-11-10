// UN2 (docs/36_UNIFORMITY.md): the shared parts -- small DOM builders for
// the one canonical look per job (src/styles/05-parts.css has the CSS
// side, and is the one place that visual spec actually lives). Pure leaf
// helpers: no import of S/main.js, same posture as src/ui/theme.js and
// src/ui/switch.js.
import { el } from '../util/dom.js';
import { makeSwitch } from './switch.js';

// backHeader(to, title, rightEl): "‹ {to}" back link, a centred title, and
// an optional right-side element. The back button and right slot are
// exposed as row.backBtn/row.rightSlot for the caller to wire/replace.
export function backHeader(to, title, rightEl){
  const row = el('div', 'p-back-header');
  const back = el('button', 'p-back-link', `‹ ${to}`);
  back.type = 'button';
  row.appendChild(back);
  row.appendChild(el('h1', 'p-back-title', title));
  if(rightEl){
    const right = el('div', 'p-back-right');
    right.appendChild(rightEl);
    row.appendChild(right);
    row.rightSlot = right;
  }
  row.backBtn = back;
  return row;
}

// sheetHeader(title): title left, a 44px × close button right. The close
// button is exposed as row.closeBtn for the caller to wire.
export function sheetHeader(title){
  const row = el('div', 'p-sheet-header');
  row.appendChild(el('h2', 'p-sheet-title', title));
  const close = el('button', 'p-sheet-close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  row.appendChild(close);
  row.closeBtn = close;
  return row;
}

// segmented(opts, value, onChange): opts is [{value, label, ariaLabel}].
// ariaLabel is optional, for an option whose own visible text doesn't say
// what it does on its own (e.g. a proper noun) -- every other option
// needs none, since its label already says everything aria-pressed needs
// to convey. Clicking an option calls onChange(option.value); the caller
// re-renders (or calls setSegmentedValue below) to move the pressed state.
export function segmented(opts, value, onChange){
  const seg = el('div', 'p-seg');
  seg.setAttribute('role', 'group');
  opts.forEach(opt => {
    const btn = el('button', null, opt.label);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(opt.value === value));
    if(opt.ariaLabel) btn.setAttribute('aria-label', opt.ariaLabel);
    btn.dataset.value = opt.value;
    btn.addEventListener('click', () => onChange(opt.value));
    seg.appendChild(btn);
  });
  return seg;
}

// toggleRow({label, desc, info, checked, onChange}): a label (with an
// optional ⓘ info button), an optional description line below, and the
// app's one switch (src/ui/switch.js) on the right -- tapping anywhere in
// the top row toggles it, same as every other switch row.
export function toggleRow({label, desc, info, checked, onChange}){
  const row = el('div', 'p-toggle-row');
  const top = el('div', 'p-toggle-top');
  const left = el('div', 'p-toggle-left');
  left.appendChild(el('span', 'p-toggle-label', label));
  if(info){
    const infoBtn = el('button', 'p-toggle-info', 'ⓘ');
    infoBtn.type = 'button';
    infoBtn.setAttribute('aria-label', `About ${label}`);
    // Stops the click from also bubbling into top's row-wide toggle
    // listener (makeSwitch's `row` option only excludes the switch itself).
    infoBtn.addEventListener('click', e => { e.stopPropagation(); info(); });
    left.appendChild(infoBtn);
  }
  top.appendChild(left);
  const sw = makeSwitch({checked, label, onChange, row: top});
  top.appendChild(sw);
  row.appendChild(top);
  if(desc) row.appendChild(el('p', 'p-toggle-desc', desc));
  row.switchEl = sw;
  return row;
}

// navRow({label, value, onClick, danger}): a tappable row -- label left,
// an optional value + chevron right, 52px min height.
export function navRow({label, value, onClick, danger}){
  const row = el('button', danger ? 'p-nav-row p-nav-row--danger' : 'p-nav-row');
  row.type = 'button';
  row.appendChild(el('span', 'p-nav-label', label));
  const right = el('span', 'p-nav-right');
  if(value !== undefined) right.appendChild(el('span', 'p-nav-value', value));
  right.appendChild(el('span', 'p-nav-chevron', '›'));
  row.appendChild(right);
  if(onClick) row.addEventListener('click', onClick);
  return row;
}

// listMenu(groups): groups is an array of item arrays, each item
// {label, onClick}. A label starting with "!" renders in --danger (the
// "!" itself is stripped, never shown).
export function listMenu(groups){
  const menu = el('div', 'p-list-menu');
  menu.setAttribute('role', 'menu');
  groups.forEach((group, i) => {
    if(i > 0) menu.appendChild(el('div', 'p-list-menu-divider'));
    group.forEach(item => {
      const danger = item.label.startsWith('!');
      const btn = el('button', danger ? 'p-list-menu-item p-list-menu-item--danger' : 'p-list-menu-item',
        danger ? item.label.slice(1) : item.label);
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      if(item.onClick) btn.addEventListener('click', item.onClick);
      menu.appendChild(btn);
    });
  });
  return menu;
}

// emptyNote({head, sub, action}): a paper card with an amber tape strip,
// a Caveat headline, an optional body line, and one optional primary
// button ({label, onClick}) below.
export function emptyNote({head, sub, action}){
  const card = el('div', 'p-empty-note');
  card.appendChild(el('div', 'p-empty-note-tape'));
  card.appendChild(el('p', 'p-empty-note-head', head));
  if(sub) card.appendChild(el('p', 'p-empty-note-sub', sub));
  if(action){
    const btn = el('button', 'p-btn p-btn--primary', action.label);
    btn.type = 'button';
    btn.addEventListener('click', action.onClick);
    card.appendChild(btn);
  }
  return card;
}
