// docs/32_SHELF_AND_TURNTABLES.md, ST2: the turntable that sits on top of
// the shelf unit. Only the Standard model exists until ST4 adds the other
// eleven (found by listening) plus the picker — any other id falls back to
// Standard, the same "missing means the default" shape every other saved
// enum in this app follows. CSS only, drawn at a fixed 200×112 (design
// `Turntable.dc.html`), scaled by the shelf unit's own container.
import { el } from '../util/dom.js';

const TURNTABLE_LABEL = { standard: 'Standard' };

export function turntableModelLabel(model){
  return TURNTABLE_LABEL[model] || TURNTABLE_LABEL.standard;
}

// `hasRecord` draws the record on the platter (art as its background, so
// it reads as that album rather than a generic disc); `spinning` toggles
// the CSS animation (ST5 wires this to the real play/pause state — until
// then this file's one caller always passes it paused, since nothing here
// animates yet).
export function renderTurntable(model, hasRecord, art, spinning){
  const wrap = el('div', 'tt tt-' + (TURNTABLE_LABEL[model] ? model : 'standard'));
  wrap.setAttribute('aria-hidden', 'true');
  if(!spinning) wrap.classList.add('tt-paused');

  wrap.appendChild(el('span', 'tt-foot tt-foot--l'));
  wrap.appendChild(el('span', 'tt-foot tt-foot--r'));
  wrap.appendChild(el('span', 'tt-plinth'));
  wrap.appendChild(el('span', 'tt-light'));
  wrap.appendChild(el('span', 'tt-platter'));
  const rec = el('span', 'tt-rec');
  if(hasRecord){
    if(art) rec.style.backgroundImage = 'url("' + art + '")';
    else rec.classList.add('tt-rec--blank');
  } else {
    rec.classList.add('tt-rec--empty');
  }
  wrap.appendChild(rec);
  wrap.appendChild(el('span', 'tt-arm'));
  wrap.appendChild(el('span', 'tt-arm-base'));
  wrap.appendChild(el('span', 'tt-headshell'));
  wrap.appendChild(el('span', 'tt-counterweight'));
  return wrap;
}
