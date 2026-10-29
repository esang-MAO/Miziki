import { S } from '../state.js';
import { PHASES } from '../sundown/rhythm.js';
import { PHASE_COLOR } from '../profile/rhythm-card.js';
import { METAL_COLORS } from '../record-art/metals.js';
import {
  SHARE_FORMATS, shareFitText, shareSwatchGradient,
  drawShareWordmark, wordmarkWidth, resolveShareStyle,
} from './styles.js';

/* ---- Season card (composeSeasonShareImage) — the listening-rhythm
   verdict, shared from Profile home once the rhythm card is unlocked
   (SH1 item 4 — the entry point is hidden below RHYTHM_MIN_PLAYS plays
   in the window; this composer is never called locked, so there's no
   locked-state branch to draw here at all). `opts`: {style, format,
   data}. `data` is gathered by the profile's Listening screen (src/
   profile/screens.js): {verdict, shares, total} from
   computeRhythmShares(windowedPhaseCounts(...))/rhythmVerdictLabel
   (sundown/rhythm.js), plus metals = per-tier counts from
   achievementsList(), playedThrough = achievements count, ownerName.
   The composer reads nothing else. ---- */

// SH6 item 3: "sorted by share descending" — a flat sort over the fixed
// PHASES order keeps ties deterministic (the earlier-in-PHASES phase
// wins a tie) rather than however Object.keys/Array.sort would happen
// to otherwise order two equal shares. Exported for its own test.
export function legendOrder(shares){
  const s = shares || {};
  return PHASES.filter(p => (s[p] || 0) > 0)
    .sort((a, b) => (s[b] || 0) - (s[a] || 0));
}

// SH6 item 4: "tiers with 0 are omitted" — rare outranks the metal
// ladder, same priority order the old crate-card.js metals section used
// (METAL_RANK in history/achievements.js). Exported for its own test.
const METAL_TIER_ORDER = ['rare', 'platinum', 'gold', 'silver', 'bronze'];
export function metalTierOrder(metals){
  const m = metals || {};
  return METAL_TIER_ORDER.filter(k => (m[k] || 0) > 0);
}

// A hard-edged conic ring (not a blend) — two colour stops per wedge, at
// its own start and end offset, the same "same colour twice" trick the
// DOM version's own conic-gradient() CSS string uses (rhythm-card.js's
// ringGradient()) — just built for a canvas CanvasGradient instead of a
// CSS string.
function ringGradient(ctx, cx, cy, order, shares){
  const g = ctx.createConicGradient(-Math.PI / 2, cx, cy);
  let acc = 0;
  PHASES.forEach(p => {
    const share = shares[p] || 0;
    if(share <= 0) return;
    const start = acc;
    acc += share;
    g.addColorStop(Math.min(1, start), PHASE_COLOR[p]);
    g.addColorStop(Math.min(1, acc), PHASE_COLOR[p]);
  });
  return g;
}

const PHASE_LABEL = {
  night: 'Night', dawn: 'Dawn', morning: 'Morning', midday: 'Midday',
  afternoon: 'Afternoon', golden: 'Golden hour', twilight: 'Twilight',
};

function drawRing(ctx, kit, cx, cy, r, shares, total){
  ctx.save();
  ctx.fillStyle = ringGradient(ctx, cx, cy, legendOrder(shares), shares);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  // faint groove rings, same as every other disc-shaped swatch in this
  // card family (styles.js's own fillShareDisc)
  ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 1;
  for(let rr = r * 0.55; rr < r * 0.97; rr += r * 0.09){
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  // the hole, cut by painting the kit's own background over the centre —
  // simpler and just as correct as a true donut path, since nothing but
  // flat background ever sits behind this card's ring
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2); ctx.clip();
  kit.paintBg(ctx, cx * 2, cy * 2);
  ctx.restore();

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = kit.ink;
  ctx.font = '700 ' + Math.round(r * 0.5) + 'px Antonio, sans-serif';
  ctx.fillText(String(total), cx, cy - r * 0.06);
  ctx.font = '500 ' + Math.round(r * 0.14) + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.sub;
  ctx.fillText(total === 1 ? 'PLAY' : 'PLAYS', cx, cy + r * 0.22);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function drawLegend(ctx, kit, x, y, w, shares, rowH, dotR, fontPx){
  legendOrder(shares).forEach(p => {
    ctx.beginPath(); ctx.arc(x + dotR, y - dotR * 0.1, dotR, 0, Math.PI * 2);
    ctx.fillStyle = PHASE_COLOR[p]; ctx.fill();
    ctx.font = '500 ' + fontPx + 'px Archivo, sans-serif';
    ctx.fillStyle = kit.ink;
    const labelX = x + dotR * 2 + Math.round(fontPx * 0.5);
    ctx.fillText(PHASE_LABEL[p], labelX, y);
    const pct = Math.round(shares[p] * 100) + '%';
    ctx.font = '600 ' + fontPx + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = kit.sub; ctx.textAlign = 'right';
    ctx.fillText(pct, x + w, y);
    ctx.textAlign = 'left';
    y += rowH;
  });
  return y;
}

// SH6 item 4: a brushed highlight->mid->shadow gradient per disc, the
// same three METAL_COLORS stops the platter's own metal pressing uses,
// just a diagonal linear sweep instead of the platter's concentric one —
// "brushed" reads as a straight-grain sweep across a disc face, not a
// radial one.
function metalDiscGradient(ctx, cx, cy, r, tier){
  const m = METAL_COLORS[tier];
  if(!m) return shareSwatchGradient(ctx, cx, cy, r, ['#C9B896', '#9c8a74', '#5c5040']);
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, m.highlight); g.addColorStop(0.5, m.mid); g.addColorStop(1, m.shadow);
  return g;
}

function drawMetalsRow(ctx, kit, x, y, metals, playedThrough, discR, fontPx){
  const order = metalTierOrder(metals);
  if(!order.length) return y;
  ctx.font = '700 ' + Math.round(fontPx * 1.1) + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.accent;
  ctx.fillText('METALS', x, y);
  y += Math.round(fontPx * 1.8);

  let cx = x + discR;
  order.forEach(tier => {
    ctx.beginPath(); ctx.arc(cx, y + discR * 0.2, discR, 0, Math.PI * 2);
    ctx.fillStyle = metalDiscGradient(ctx, cx, y + discR * 0.2, discR, tier);
    ctx.fill();
    ctx.fillStyle = '#171310'; ctx.font = '700 ' + Math.round(discR * 0.85) + 'px Archivo, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(metals[tier]), cx, y + discR * 0.2 + 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    cx += discR * 2 + Math.round(fontPx * 0.9);
  });
  y += discR * 2 + Math.round(fontPx * 1.6);

  ctx.font = '500 ' + fontPx + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.sub;
  ctx.fillText(playedThrough + ' RECORD' + (playedThrough === 1 ? '' : 'S') + ' PLAYED THROUGH', x, y);
  return y + Math.round(fontPx * 1.6);
}

export async function composeSeasonShareImage(opts){
  const { style = 'night', format = 'square', data } = opts || {};
  const dims = SHARE_FORMATS[format] || SHARE_FORMATS.square;
  const w = dims.w, h = dims.h;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  try{ await document.fonts.ready; }catch(_e){}
  const kit = await resolveShareStyle(style);
  kit.paintBg(ctx, w, h);
  if(!data) return canvas;

  const pad = Math.round(w * 0.055);
  const shares = data.shares || {};
  const total = data.total || 0;
  const stacked = format === 'story';

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  // SH6 item 2: kicker + headline (sentence case, never uppercased)
  ctx.font = '600 ' + Math.round(w * 0.019) + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.accent;
  ctx.fillText('THIS SEASON · LAST 90 DAYS', pad, dims.safeTop);

  const headlineSize = Math.round(w * (stacked ? 0.052 : 0.046));
  ctx.font = '700 ' + headlineSize + 'px Antonio, sans-serif';
  ctx.fillStyle = kit.ink;
  let y = dims.safeTop + Math.round(w * 0.055);
  const headline = shareFitText(ctx, data.verdict || 'This season', w - pad * 2);
  ctx.fillText(headline, pad, y);
  y += Math.round(w * 0.07);

  const ringR = Math.round(w * (stacked ? 0.22 : 0.16));
  const legendFontPx = Math.round(w * 0.022);
  const legendRowH = Math.round(w * 0.044);

  if(stacked){
    const cx = w / 2, cy = y + ringR;
    drawRing(ctx, kit, cx, cy, ringR, shares, total);
    y = cy + ringR + Math.round(w * 0.05);
    y = drawLegend(ctx, kit, pad, y, w - pad * 2, shares, legendRowH, Math.round(w * 0.012), legendFontPx) ;
  } else {
    const cx = pad + ringR, cy = y + ringR;
    drawRing(ctx, kit, cx, cy, ringR, shares, total);
    const legendX = pad + ringR * 2 + Math.round(w * 0.04);
    drawLegend(ctx, kit, legendX, cy - ringR + legendFontPx, w - pad - legendX, shares, legendRowH, Math.round(w * 0.012), legendFontPx);
    y = cy + ringR + Math.round(w * 0.04);
  }

  // SH6 item 4: metals row, omitted outright with no earned tiers at all
  y = drawMetalsRow(ctx, kit, pad, y, data.metals || {}, data.playedThrough || 0, Math.round(w * 0.026), Math.round(w * 0.019));

  // SH6 item 5: footer, wordmark + [NAME]'S CRATE, bottom-right — the
  // same off-centre shape SH5 gave crate-card.js's own wordmark
  const wmFontPx = Math.round(w * 0.034);
  const wmWidth = wordmarkWidth(ctx, wmFontPx);
  const showName = (S.shareSelectionByCard.season.name !== false) && !!data.ownerName;
  const markY = Math.min(Math.max(y, dims.safeTop) + Math.round(h * 0.03), dims.safeBottom);
  await drawShareWordmark(ctx, w - pad - wmWidth / 2, markY, wmFontPx, kit.ink, kit.accent);
  if(showName){
    ctx.font = '600 ' + Math.round(w * 0.016) + 'px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right'; ctx.fillStyle = kit.sub;
    ctx.fillText(data.ownerName.toUpperCase() + "'S CRATE", w - pad, markY + Math.round(w * 0.028));
    ctx.textAlign = 'left';
  }

  return canvas;
}
