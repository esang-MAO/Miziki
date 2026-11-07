// docs/32_SHELF_AND_TURNTABLES.md, ST2: the rendered shelf unit — a solid-
// wood 2×3 cube unit with the turntable and a sleeve stand on top,
// replacing plan 30 (GS8)'s flat CSS cube grid. All layout below is a
// straight percentage conversion of the design's fixed 342×640 mock
// (docs/design/shelf-turntables/ShelfUnit.dc.html), so the unit scales
// with its container instead of staying pinned to one phone width — the
// aspect-ratio on .shelf-unit keeps the proportions the design was drawn
// at (342:640) at any width, including a wider desktop column.
//
// Only Walnut exists until ST3 adds the other four finishes via CSS
// custom properties on .shelf-unit (src/styles/18-storefront.css's
// --wood-* tokens) and only the Standard turntable exists until ST4
// (src/profile/turntable.js). The unit always shows exactly six cubes —
// unlike storeShelvesSection()'s own unbounded grid (friend-store.js's
// "browse all" list), this is the fixed showpiece the design draws, so a
// short crate pads out with "room to grow" cubes rather than shrinking.
import { el } from '../util/dom.js';
import { renderTurntable } from './turntable.js';

export const SHELF_UNIT_CUBES = 6;
export const SHELF_UNIT_COLS = 2;
const CUBE_CAPACITY = 10, FACE_WIDTH = 3;

// Splits a flat {id,name,artist,art} list (already pin-rank-aware: a
// face-out item counts for FACE_WIDTH of a cube's capacity, same rule
// storeShelvesSection() in profile/storefront.js uses) into cube buckets
// -- every one of them, not capped, so a caller can tell whether the
// crate is bigger than the unit's own fixed SHELF_UNIT_CUBES and needs a
// "Browse all" link; renderShelfUnit() below does its own capping.
export function shelfUnitCubes(items, faceOutIds){
  const faceOut = new Set(faceOutIds || []);
  const cubes = [];
  let cube = [], used = 0;
  const push = () => { cubes.push(cube); cube = []; used = 0; };
  items.forEach(item => {
    const isFace = faceOut.has(item.id);
    const width = isFace ? FACE_WIDTH : 1;
    if(used && used + width > CUBE_CAPACITY) push();
    cube.push({item, isFace});
    used += width;
  });
  if(cube.length) push();
  return cubes;
}

function cubeSpine(item, onTapAlbum){
  const sp = el('button', 'sp');
  if(item.art) sp.style.backgroundImage = 'url("' + item.art + '")';
  else sp.classList.add('sp--blank');
  sp.setAttribute('aria-label', item.name + (item.artist ? ', ' + item.artist : ''));
  sp.addEventListener('click', () => onTapAlbum(item.id));
  return sp;
}

function cubeFace(item, onTapAlbum){
  const face = el('button', 'shelf-face');
  if(item.art){ const im = document.createElement('img'); im.src = item.art; im.alt = ''; face.appendChild(im); }
  face.setAttribute('aria-label', item.name + (item.artist ? ', ' + item.artist : ''));
  face.addEventListener('click', () => onTapAlbum(item.id));
  return face;
}

function shelfCell(cubeEntries, onTapAlbum){
  const cell = el('div', 'shelf-cell');
  const recs = el('div', 'shelf-cell-recs');
  cubeEntries.forEach(({item, isFace}) => recs.appendChild(isFace ? cubeFace(item, onTapAlbum) : cubeSpine(item, onTapAlbum)));
  cell.appendChild(recs);
  cell.appendChild(el('div', 'shelf-cell-strip'));
  cell.appendChild(el('div', 'shelf-cell-depth'));
  return cell;
}

function emptyCell(note){
  const cell = el('div', 'shelf-cell shelf-cell-empty');
  cell.appendChild(el('div', 'shelf-cell-strip'));
  if(note) cell.appendChild(el('span', 'shelf-cell-note', 'room to grow'));
  cell.appendChild(el('div', 'shelf-cell-depth'));
  return cell;
}

// `turntableInfo`: {hasRecord, art, spinning} for the record on the
// platter; `sleeveArt`/`sleeveName` for the stand beside it (null when
// nothing's ever been loaded — ST2 point 3's "nothing on: the turntable
// stands empty, no stand"). `finish` (ST3, docs/32_SHELF_AND_TURNTABLES.
// md): one of SHELF_FINISHES' ids (src/profile/shelf-finish.js), default
// 'walnut' -- sets the one `data-finish` attribute 18-storefront.css keys
// its --wood-* custom properties off.
export function renderShelfUnit({items, faceOutIds, onTapAlbum, model, turntableInfo, sleeveArt, sleeveName, finish}){
  const unit = el('div', 'shelf-unit');
  unit.setAttribute('data-finish', finish || 'walnut');

  unit.appendChild(el('div', 'shelf-unit-floor-shadow'));

  const top = el('div', 'shelf-unit-top');
  top.appendChild(el('div', 'shelf-unit-tt-shadow'));
  const ttHolder = el('div', 'shelf-unit-tt-holder');
  ttHolder.appendChild(renderTurntable(model || 'standard', !!turntableInfo.hasRecord, turntableInfo.art, !!turntableInfo.spinning));
  top.appendChild(ttHolder);
  if(sleeveArt || sleeveName){
    top.appendChild(el('div', 'shelf-unit-sleeve-shadow'));
    const sleeve = el('div', 'shelf-unit-sleeve');
    if(sleeveArt){ const im = document.createElement('img'); im.src = sleeveArt; im.alt = ''; sleeve.appendChild(im); }
    sleeve.setAttribute('aria-label', sleeveName ? sleeveName + ', the cover of what’s on the turntable' : '');
    top.appendChild(sleeve);
  }
  unit.appendChild(top);

  unit.appendChild(el('div', 'shelf-unit-topcap'));
  unit.appendChild(el('div', 'shelf-unit-fullrail shelf-unit-fullrail--top'));

  const cubes = shelfUnitCubes(items, faceOutIds);
  const shown = cubes.slice(0, SHELF_UNIT_CUBES);
  const slots = [];
  for(let i = 0; i < SHELF_UNIT_CUBES; i++) slots.push(shown[i] || null);
  const emptyFromIdx = shown.length;

  const frame = el('div', 'shelf-unit-frame');
  const rowCount = SHELF_UNIT_CUBES / SHELF_UNIT_COLS;
  for(let r = 0; r < rowCount; r++){
    const row = el('div', 'shelf-unit-row');
    row.setAttribute('data-row', String(r));
    for(let c = 0; c < SHELF_UNIT_COLS; c++){
      const i = r * SHELF_UNIT_COLS + c;
      row.appendChild(slots[i] ? shelfCell(slots[i], onTapAlbum) : emptyCell(i === emptyFromIdx));
    }
    frame.appendChild(row);
    if(r < rowCount - 1){
      const rail = el('div', 'shelf-unit-rail');
      rail.setAttribute('data-rail', String(r));
      rail.appendChild(el('div', 'shelf-unit-rail-half'));
      rail.appendChild(el('div', 'shelf-unit-rail-half'));
      frame.appendChild(rail);
    }
  }
  frame.appendChild(el('div', 'shelf-unit-post shelf-unit-post--l'));
  frame.appendChild(el('div', 'shelf-unit-post shelf-unit-post--m'));
  frame.appendChild(el('div', 'shelf-unit-post shelf-unit-post--r'));
  unit.appendChild(frame);

  unit.appendChild(el('div', 'shelf-unit-bottomrail'));
  unit.appendChild(el('div', 'shelf-unit-plinth'));
  return unit;
}
