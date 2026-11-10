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
import { stickerBadge } from '../social/sticker.js';
import { loadImageEl, shareDominantColor, spineColor } from '../ui/art-color.js';
import { albumPressingTrack, selectVariant, getVariantDef } from '../record-art/tiers.js';

export const SHELF_UNIT_CUBES = 6;
export const SHELF_UNIT_COLS = 2;
const CUBE_CAPACITY = 10;

// UN15 point 3 ("rows that grow"): the unit no longer pads a short crate
// out to a fixed 6-cube/3-row box -- it renders 1-3 rows, however many the
// crate actually needs. These four pixel constants are a straight read of
// the design's own fixed 342x640 mock (docs/design/shelf-turntables/
// ShelfUnit.dc.html): a 138px top zone (turntable deck, top plank, top
// full-rail) and a 32px bottom zone (bottom rail 14px + plinth 10px + the
// floor-shadow's own 8px of headroom below the plinth) are the same at
// every row count: 138 + 3*150 + 2*10 + 32 = 640, matching the mock
// exactly. Only the row/rail content between them grows or shrinks.
const SHELF_TOP_ZONE_PX = 138;
const SHELF_ROW_PX = 150;
const SHELF_RAIL_PX = 10;
const SHELF_BOTTOMRAIL_PX = 14;
const SHELF_PLINTH_PX = 10;
const SHELF_BOTTOM_ZONE_PX = 32; // bottomrail 14 + plinth 10 + floor-shadow headroom 8

export function shelfUnitRows(cubesNeeded){
  return Math.max(1, Math.min(3, Math.ceil((cubesNeeded || 0) / SHELF_UNIT_COLS)));
}

function shelfUnitContentPx(rows){
  return rows * SHELF_ROW_PX + (rows - 1) * SHELF_RAIL_PX;
}

function shelfUnitTotalPx(rows){
  return SHELF_TOP_ZONE_PX + shelfUnitContentPx(rows) + SHELF_BOTTOM_ZONE_PX;
}

// UN15 point 1 (bug): storefront.js's shelfItemsFromCrate() feeds this
// crateFlatAlbumOrder()'s own flat items, which walks the crate's sections
// (A-Z, New arrivals, In rotation) in a row -- any album in more than one
// section arrives once per section. Pure and exported here, rather than
// inline in storefront.js, so it's unit-testable without that file's own
// DOM/state-heavy import web pulling in.
export function dedupeCrateItems(crateItems){
  const seen = new Set();
  return crateItems.filter(it => {
    if(seen.has(it.albumId)) return false;
    seen.add(it.albumId);
    return true;
  });
}

// UN15 point 2: height by format, as a percentage of the cube's inner
// height -- a 7in single's spine reads visibly shorter than a 12in LP's,
// same as a real crate. Falls back to the old flat 88% for an item whose
// format never resolved (shouldn't happen from storefront.js's own
// shelfItemsFromCrate(), which always attaches one, but a defensive
// default beats a missing height).
const SPINE_HEIGHT_PCT = { '7"': 70, '10"': 80, '12"': 92 };
const SPINE_HEIGHT_DEFAULT = 88;

// UN15 point 2: "the record's own pressing colour... so it's the same on
// every device" -- the pressing chart's own `colors` 3-tuple is [ring,
// body, rim] (record-art/tiers.js's own F() comment); `body` is the one
// meant to read as the pressing's base colour at a glance, same role
// spineColor() gives a resolved cover tint.
function pressingSpineColor(albumId){
  const t = albumPressingTrack(albumId);
  if(!t) return null;
  try{ return getVariantDef(selectVariant(t)).colors[1]; }catch(_e){ return null; }
}

// Dominant colour per album, worked out once and cached in memory only
// (same posture as gatefold/view.js's own gfTintCache -- cheap to redo,
// and underlying art can change via an edit).
const spineColorCache = new Map();
async function resolveSpineColor(albumId, artUrl){
  if(spineColorCache.has(albumId)) return spineColorCache.get(albumId);
  let hex = null;
  try{
    const img = await loadImageEl(artUrl);
    const dom = shareDominantColor(img);
    if(dom) hex = spineColor(dom);
  }catch(_e){ hex = null; }
  spineColorCache.set(albumId, hex);
  return hex;
}

// Splits a flat {id,name,artist,art} list (already pin-rank-aware) into
// cube buckets -- every one of them, not capped, so a caller can tell
// whether the crate is bigger than the unit's own fixed SHELF_UNIT_CUBES
// and needs a "Browse all" link; renderShelfUnit() below does its own
// capping. A face-out item (pin rank 4-5) always gets a whole cube of its
// own -- "each record being put in its own square" (Ken, 2026-11-08) --
// rather than sharing a cube's row with ordinary spines.
//
// Wall & Labels follow-up (Ken, 2026-11-08): renderShelfUnit()'s own cap
// only keeps the first SHELF_UNIT_CUBES cubes, built in the crate's
// natural order -- a face-out item (pin rank 4-5) sitting later in that
// order than the cap could get truncated away entirely, so a record the
// user explicitly pinned would just never show up on the fixed, 6-cube
// home-screen unit. Floating face-out items to the front (in rank order,
// everything else following in its original order) guarantees they
// always land in a kept cube.
export function shelfUnitCubes(items, faceOutIds){
  const faceOut = new Set(faceOutIds || []);
  const ordered = faceOut.size
    ? [...(faceOutIds || []).map(id => items.find(it => it.id === id)).filter(Boolean),
       ...items.filter(it => !faceOut.has(it.id))]
    : items;
  const cubes = [];
  let cube = [], used = 0;
  const push = () => { cubes.push(cube); cube = []; used = 0; };
  ordered.forEach(item => {
    if(faceOut.has(item.id)){
      if(cube.length) push();
      cubes.push([{item, isFace: true}]);
      return;
    }
    if(used && used + 1 > CUBE_CAPACITY) push();
    cube.push({item, isFace: false});
    used += 1;
  });
  if(cube.length) push();
  return cubes;
}

function cubeSpine(item, onTapAlbum){
  const sp = el('button', 'sp');
  sp.style.height = (SPINE_HEIGHT_PCT[item.format] || SPINE_HEIGHT_DEFAULT) + '%';
  sp.setAttribute('aria-label', item.name + (item.artist ? ', ' + item.artist : ''));
  sp.addEventListener('click', () => onTapAlbum(item.id));
  if(item.art){
    // Paint the pressing colour immediately so there's never a blank
    // spine while the cover decodes -- swapped for the real dominant
    // colour once resolveSpineColor() settles, unless this spine has
    // since been replaced by a re-render (cheap re-render beats a stale
    // write: 18-storefront.css reads --spine-color, so a late write to a
    // detached button just paints nothing anyone sees).
    const fallback = pressingSpineColor(item.id);
    if(fallback) sp.style.setProperty('--spine-color', fallback);
    resolveSpineColor(item.id, item.art).then(hex => {
      if(hex) sp.style.setProperty('--spine-color', hex);
    });
  } else {
    const hex = pressingSpineColor(item.id);
    if(hex) sp.style.setProperty('--spine-color', hex);
  }
  return sp;
}

// CC3 (docs/34_CARE_AND_CONTROL.md): `stickers` -- a {releaseId: owners}
// map, only ever passed for a friend's own shelf (never this device's
// own, where every item is already owned) -- draws the badge over the
// face cover only; a spine is 10px wide, too narrow for the sticker to
// read (same reasoning as shelfSpine()'s own art-vs-color fallback).
function cubeFace(item, onTapAlbum, stickers){
  const face = el('button', 'shelf-face');
  if(item.art){ const im = document.createElement('img'); im.src = item.art; im.alt = ''; face.appendChild(im); }
  face.setAttribute('aria-label', item.name + (item.artist ? ', ' + item.artist : ''));
  face.addEventListener('click', () => onTapAlbum(item.id));
  if(stickers){
    const badge = stickerBadge(item.id, stickers[item.id]);
    if(badge) face.appendChild(badge);
  }
  return face;
}

function shelfCell(cubeEntries, onTapAlbum, stickers){
  // A face-out cube always holds exactly one entry (shelfUnitCubes() never
  // shares one with spines) -- the modifier lets it fill the whole square
  // instead of sitting at its old fixed spine-row width.
  const isFaceCube = cubeEntries.length === 1 && cubeEntries[0].isFace;
  const cell = el('div', isFaceCube ? 'shelf-cell shelf-cell--face' : 'shelf-cell');
  const recs = el('div', 'shelf-cell-recs');
  cubeEntries.forEach(({item, isFace}) => recs.appendChild(isFace ? cubeFace(item, onTapAlbum, stickers) : cubeSpine(item, onTapAlbum)));
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

// `turntableInfo`: {hasRecord, art, spinning, turnSeconds} for the record
// on the platter -- `art` is the album's own resolved pressing background
// (record-art/looks.js's discLook(t).bg, as storefront.js's
// shelfUnitTurntableInfo() resolves it -- see renderTurntable()'s own
// header comment), not a raw image URL; `turnSeconds` (ST5, docs/32_
// SHELF_AND_TURNTABLES.md point 2) is seconds per revolution, only
// meaningful while `spinning`; `sleeveArt`/`sleeveName` for the stand
// beside it (null when
// nothing's ever been loaded — ST2 point 3's "nothing on: the turntable
// stands empty, no stand"). `finish` (ST3, docs/32_SHELF_AND_TURNTABLES.
// md): one of SHELF_FINISHES' ids (src/profile/shelf-finish.js), default
// 'walnut' -- sets the one `data-finish` attribute 18-storefront.css keys
// its --wood-* custom properties off.
export function renderShelfUnit({items, faceOutIds, onTapAlbum, model, turntableInfo, sleeveArt, sleeveName, finish, stickers}){
  const unit = el('div', 'shelf-unit');
  unit.setAttribute('data-finish', finish || 'walnut');

  const cubes = shelfUnitCubes(items, faceOutIds);
  const shown = cubes.slice(0, SHELF_UNIT_CUBES);
  // UN15 point 3: only as many rows as the crate actually needs (1-3),
  // not always a fixed 3 -- every vertically-positioned child below is
  // repositioned inline against this render's own totalPx, since the
  // 342x640 mock's static CSS percentages only hold true at 3 rows.
  const rows = shelfUnitRows(shown.length);
  const totalPx = shelfUnitTotalPx(rows);
  const pct = px => (px / totalPx * 100) + '%';
  unit.style.aspectRatio = '342 / ' + totalPx;

  const floorShadow = el('div', 'shelf-unit-floor-shadow');
  floorShadow.style.height = pct(14);
  unit.appendChild(floorShadow);

  const top = el('div', 'shelf-unit-top');
  const ttShadow = el('div', 'shelf-unit-tt-shadow');
  ttShadow.style.top = pct(112);
  ttShadow.style.height = pct(8);
  top.appendChild(ttShadow);
  const ttHolder = el('div', 'shelf-unit-tt-holder');
  ttHolder.style.top = pct(6);
  ttHolder.style.height = pct(112);
  ttHolder.appendChild(renderTurntable(model || 'standard', !!turntableInfo.hasRecord, turntableInfo.art, !!turntableInfo.spinning, turntableInfo.turnSeconds));
  top.appendChild(ttHolder);
  if(sleeveArt || sleeveName){
    const sleeveShadow = el('div', 'shelf-unit-sleeve-shadow');
    sleeveShadow.style.top = pct(108);
    sleeveShadow.style.height = pct(8);
    top.appendChild(sleeveShadow);
    const sleeve = el('div', 'shelf-unit-sleeve');
    sleeve.style.top = pct(12);
    sleeve.style.height = pct(96);
    if(sleeveArt){ const im = document.createElement('img'); im.src = sleeveArt; im.alt = ''; sleeve.appendChild(im); }
    sleeve.setAttribute('aria-label', sleeveName ? sleeveName + ', the cover of what’s on the turntable' : '');
    top.appendChild(sleeve);
  }
  unit.appendChild(top);

  const topcap = el('div', 'shelf-unit-topcap');
  topcap.style.top = pct(112);
  topcap.style.height = pct(12);
  unit.appendChild(topcap);
  const fullrailTop = el('div', 'shelf-unit-fullrail shelf-unit-fullrail--top');
  fullrailTop.style.top = pct(124);
  fullrailTop.style.height = pct(14);
  unit.appendChild(fullrailTop);

  const slots = [];
  for(let i = 0; i < rows * SHELF_UNIT_COLS; i++) slots.push(shown[i] || null);
  const emptyFromIdx = shown.length;

  const frame = el('div', 'shelf-unit-frame');
  let rowTopPx = SHELF_TOP_ZONE_PX;
  for(let r = 0; r < rows; r++){
    const row = el('div', 'shelf-unit-row');
    row.style.top = pct(rowTopPx);
    row.style.height = pct(SHELF_ROW_PX);
    for(let c = 0; c < SHELF_UNIT_COLS; c++){
      const i = r * SHELF_UNIT_COLS + c;
      row.appendChild(slots[i] ? shelfCell(slots[i], onTapAlbum, stickers) : emptyCell(i === emptyFromIdx));
    }
    frame.appendChild(row);
    rowTopPx += SHELF_ROW_PX;
    if(r < rows - 1){
      const rail = el('div', 'shelf-unit-rail');
      rail.style.top = pct(rowTopPx);
      rail.style.height = pct(SHELF_RAIL_PX);
      rail.appendChild(el('div', 'shelf-unit-rail-half'));
      rail.appendChild(el('div', 'shelf-unit-rail-half'));
      frame.appendChild(rail);
      rowTopPx += SHELF_RAIL_PX;
    }
  }
  const postHeightPx = rowTopPx + SHELF_BOTTOMRAIL_PX - 124;
  ['shelf-unit-post--l', 'shelf-unit-post--m', 'shelf-unit-post--r'].forEach(mod => {
    const post = el('div', 'shelf-unit-post ' + mod);
    post.style.top = pct(124);
    post.style.height = pct(postHeightPx);
    frame.appendChild(post);
  });
  unit.appendChild(frame);

  const bottomrail = el('div', 'shelf-unit-bottomrail');
  bottomrail.style.top = pct(rowTopPx);
  bottomrail.style.height = pct(SHELF_BOTTOMRAIL_PX);
  unit.appendChild(bottomrail);
  const plinth = el('div', 'shelf-unit-plinth');
  plinth.style.top = pct(rowTopPx + SHELF_BOTTOMRAIL_PX);
  plinth.style.height = pct(SHELF_PLINTH_PX);
  unit.appendChild(plinth);
  return unit;
}
