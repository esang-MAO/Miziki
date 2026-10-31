import { getVariantDef, SOLID_IDS, EFFECT_IDS, RARE_IDS, ZOETROPE_IDS } from '../record-art/tiers.js';
import {
  SHARE_FORMATS, shareFitText, roundRectPath, drawShareWordmark,
  resolveShareStyle, drawDiagonalWordmark, loadImageEl, drawCover, fillShareDisc, fillVariantSwatch,
} from './styles.js';

/* ---- Pressings card (composePressingsShareImage) — a grid of unlocked
   pressings, shared from Profile › Records › Pressings. QC2 (docs/
   24_QUIET_COUNTS.md): a "PRESSINGS" kicker, the owned-only chip grid
   grouped by family (same grouping and order as the profile's own chart,
   profile/storefront.js's renderPressingCard — no "N of 110", no family
   counts), a 3-column grid of the most recently discovered pressings
   (newest first), a "+ N more" line when the collection outgrows the
   grid, and a footer. `opts`: {style, format, data}. `data` is gathered
   by the Records screen: {records (S.collection values, already sorted
   newest-first — see sortPressingsNewestFirst below), ownedIds (the
   merged set of every owned variant id, across all four families),
   ownerName} — docs/18_SHARE.md, SH4 items 1 and 2. ---- */

const GRID_COLS = 3;
const GRID_ROWS = { story: 4, square: 2 };
const TILE_W = 296, TILE_ART_H = 192, TILE_TEXT_GAP = 12;
const TILE_NAME_FONT = 22, TILE_TITLE_FONT = 22;
const TILE_H = TILE_ART_H + TILE_TEXT_GAP + Math.round(TILE_NAME_FONT*0.95) + TILE_TEXT_GAP + Math.round(TILE_TITLE_FONT*0.95);
const GRID_COL_GAP = 32, GRID_ROW_GAP = 36;

// SH4 item 7: the pure decision logic — a plain sort, two row-count
// mappings and a format function, each testable without touching a
// canvas (the actual ownership arithmetic — which variant ids a device
// has earned — is history/achievements.js's job, unchanged by this card
// and not re-tested here; this card only ever formats what it's given).

// S.collection has no ordering of its own (a plain object keyed by album
// id) — newest-discovered-first is this card's own presentation choice,
// so the sort lives here rather than in the Records screen that gathers it.
export function sortPressingsNewestFirst(records){
  return [...(records || [])].sort((a, b) => (b.discoveredAt || 0) - (a.discoveredAt || 0));
}

export function tileCountFor(format){
  return GRID_COLS * (GRID_ROWS[format] || GRID_ROWS.square);
}

// null (not an empty string) when everything already fits — the line is
// omitted outright, per the doc's own "only when there are more."
export function moreCountText(records, format){
  const extra = Math.max(0, (records ? records.length : 0) - tileCountFor(format));
  return extra > 0 ? ('+ ' + extra + ' MORE · NEWEST FIRST') : null;
}

// QC1/QC2: the same family grouping/order profile/storefront.js's
// renderPressingCard() draws (SOLID_IDS/EFFECT_IDS/RARE_IDS/ZOETROPE_IDS's
// own order, record-art/tiers.js) — duplicated here rather than shared,
// since one draws DOM chips and the other canvas ones.
const PRESSING_FAMILIES = [
  {label:'COLORS', ids:SOLID_IDS}, {label:'EFFECTS', ids:EFFECT_IDS},
  {label:'RARE', ids:RARE_IDS}, {label:'ZOETROPES', ids:ZOETROPE_IDS},
];
const CHIP_SIZE = 32, CHIP_GAP = 10, CHIP_RADIUS = 6;

// one row of found chips per family that has any, a mono-caps label above
// each row — only the owned chips are ever drawn, never a missing one.
// Returns the y position just past the last row drawn.
export function drawPressingChips(ctx, kit, ownedIds, x, y, maxW){
  let cy = y;
  PRESSING_FAMILIES.forEach(({label, ids}) => {
    const owned = ids.filter(id => ownedIds.has(id));
    if(!owned.length) return;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '500 18px "IBM Plex Mono", monospace';
    ctx.fillStyle = kit.sub;
    if('letterSpacing' in ctx) ctx.letterSpacing = '.08em';
    ctx.fillText(label, x, cy + 14);
    if('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    cy += 32;
    let cx = x;
    owned.forEach(id => {
      if(cx + CHIP_SIZE > x + maxW){ cx = x; cy += CHIP_SIZE + CHIP_GAP; }
      fillVariantSwatch(ctx, getVariantDef(id), cx, cy, CHIP_SIZE, CHIP_RADIUS);
      cx += CHIP_SIZE + CHIP_GAP;
    });
    cy += CHIP_SIZE + 24;
  });
  return cy;
}

// the tile art box: cover tucked behind-left, pressing disc in front
// (the reverse z-order of the Now Playing/Record cards' own disc-behind-
// sleeve geometry — here the disc is what's being shown off) plus the
// pressing name (accent when the pressing's own band is scarce, per the
// profile pressing-chart's own "rarer" dot) and the album title below it.
async function drawTile(ctx, kit, rec, x, y){
  const coverSide = 160, coverLeft = x, coverTop = y + 16;
  if(rec.art){
    try{
      const img = await loadImageEl(rec.art);
      ctx.save(); roundRectPath(ctx, coverLeft, coverTop, coverSide, coverSide, 6); ctx.clip();
      drawCover(ctx, img, coverLeft, coverTop, coverSide, coverSide);
      ctx.restore();
    }catch(_e){ await drawDiagonalWordmark(ctx, coverLeft, coverTop, coverSide); }
  } else {
    await drawDiagonalWordmark(ctx, coverLeft, coverTop, coverSide);
  }

  const discR = 96, discCx = x + 104 + discR, discCy = y + TILE_ART_H/2;
  await fillShareDisc(ctx, {art: rec.art || null, look: 'variant', variant: rec.variant, metal: null}, discCx, discCy, discR, false);

  const def = getVariantDef(rec.variant);
  const scarce = !!(def && def.band === 'scarce');
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  let ty = y + TILE_ART_H + TILE_TEXT_GAP + Math.round(TILE_NAME_FONT*0.95);
  ctx.font = '600 ' + TILE_NAME_FONT + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = scarce ? kit.accent : kit.ink;
  ctx.fillText(shareFitText(ctx, ((def ? def.name : 'Pressing')).toUpperCase(), TILE_W), x, ty);

  ty += TILE_TEXT_GAP + Math.round(TILE_TITLE_FONT*0.95);
  ctx.font = '400 ' + TILE_TITLE_FONT + 'px Archivo, sans-serif';
  ctx.fillStyle = kit.sub;
  ctx.fillText(shareFitText(ctx, rec.name || '', TILE_W), x, ty);
}

export async function composePressingsShareImage(opts){
  const { style = 'night', format = 'story', data } = opts || {};
  const dim = SHARE_FORMATS[format] || SHARE_FORMATS.story;
  const w = dim.w, h = dim.h;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  try{ await document.fonts.ready; }catch(_e){}

  const kit = await resolveShareStyle(style);
  kit.paintBg(ctx, w, h);
  if(!data) return canvas;

  const pad = Math.round(w*0.055);
  let y = dim.safeTop;

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  // TY6 (docs/22_TYPE.md): the kicker is Archivo caps --track-caps, not mono.
  ctx.font = '600 24px Archivo, sans-serif';
  y += 24;
  ctx.fillStyle = kit.accent;
  if('letterSpacing' in ctx) ctx.letterSpacing = '.08em';
  ctx.fillText('PRESSINGS', pad, y);
  if('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += 28;

  y = drawPressingChips(ctx, kit, data.ownedIds || new Set(), pad, y, w - pad*2);
  y += 24;

  const records = data.records || [];
  const shownCount = Math.min(records.length, tileCountFor(format));
  const gridW = GRID_COLS*TILE_W + (GRID_COLS-1)*GRID_COL_GAP;
  const gridLeft = Math.round((w - gridW)/2);

  for(let i = 0; i < shownCount; i++){
    const col = i % GRID_COLS, row = Math.floor(i / GRID_COLS);
    const tx = gridLeft + col*(TILE_W + GRID_COL_GAP), ty = y + row*(TILE_H + GRID_ROW_GAP);
    await drawTile(ctx, kit, records[i], tx, ty);
  }
  const rowsUsed = Math.ceil(shownCount / GRID_COLS);
  y += rowsUsed*(TILE_H + GRID_ROW_GAP);

  const more = moreCountText(records, format);
  if(more){
    ctx.textAlign = 'center';
    // TY6: metadata is Archivo .num, not mono.
    ctx.font = '500 20px Archivo, sans-serif';
    ctx.fillStyle = kit.sub;
    ctx.fillText(more, w/2, y);
    y += 44;
  }

  ctx.textAlign = 'center';
  const markY = Math.max(y, dim.safeBottom - 40);
  await drawShareWordmark(ctx, w/2, markY, Math.round(w*0.03), kit.ink, kit.accent);
  ctx.font = '600 20px Archivo, sans-serif';
  ctx.fillStyle = kit.sub;
  const crateName = (data.ownerName ? data.ownerName.toUpperCase() + "'S CRATE" : 'MY CRATE') + ' · EARNED BY LISTENING';
  ctx.fillText(crateName, w/2, markY + 26);

  return canvas;
}
