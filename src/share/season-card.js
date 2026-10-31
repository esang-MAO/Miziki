import { S } from '../state.js';
import { PHASES } from '../sundown/rhythm.js';
import { PHASE_COLOR } from '../profile/rhythm-card.js';
import {
  SHARE_FORMATS, shareFitText, drawShareWordmark, wordmarkWidth, resolveShareStyle,
  roundRectPath, loadImageEl, drawCover, drawDiagonalWordmark,
} from './styles.js';

/* ---- Season card (composeSeasonShareImage) — the listening-rhythm
   verdict, shared from Profile home once the rhythm card is unlocked
   (SH1 item 4 — the entry point is hidden below RHYTHM_MIN_PLAYS plays
   in the window; this composer is never called locked, so there's no
   locked-state branch to draw here at all). `opts`: {style, format,
   data}. `data` is gathered by the profile's Listening screen (src/
   profile/screens.js): {verdict, shares, total} from
   computeRhythmShares(windowedPhaseCounts(...))/rhythmVerdictLabel
   (sundown/rhythm.js), plus topAlbums (QC2, docs/24_QUIET_COUNTS.md —
   the top 3 albums by plays in the same window, history/achievements.js's
   topAlbumsInWindow()) and ownerName. The composer reads nothing else. ---- */

// SH6 item 3: "sorted by share descending" — a flat sort over the fixed
// PHASES order keeps ties deterministic (the earlier-in-PHASES phase
// wins a tie) rather than however Object.keys/Array.sort would happen
// to otherwise order two equal shares. Exported for its own test.
export function legendOrder(shares){
  const s = shares || {};
  return PHASES.filter(p => (s[p] || 0) > 0)
    .sort((a, b) => (s[b] || 0) - (s[a] || 0));
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
  // TY6: metadata is Archivo .num, not mono.
  ctx.font = '500 ' + Math.round(r * 0.14) + 'px Archivo, sans-serif';
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
    // TY6: metadata is Archivo .num, not mono.
    ctx.font = '600 ' + fontPx + 'px Archivo, sans-serif';
    ctx.fillStyle = kit.sub; ctx.textAlign = 'right';
    ctx.fillText(pct, x + w, y);
    ctx.textAlign = 'left';
    y += rowH;
  });
  return y;
}

// QC2 (docs/24_QUIET_COUNTS.md): "MOST PLAYED THIS SEASON" — the top 3
// albums (data.topAlbums, already selected and windowed by
// history/achievements.js's topAlbumsInWindow()) as cover art plus the
// album name underneath, replacing the old metals/"N records played
// through" figures. Omitted outright with nothing in the window at all,
// same "no row when there's nothing to show" shape drawMetalsRow() used.
async function drawTopAlbumsRow(ctx, kit, x, y, maxW, albums, fontPx){
  if(!albums.length) return y;
  // TY6: the kicker is Archivo caps --track-caps, not mono.
  ctx.font = '700 ' + Math.round(fontPx * 1.1) + 'px Archivo, sans-serif';
  ctx.fillStyle = kit.accent;
  if('letterSpacing' in ctx) ctx.letterSpacing = '.08em';
  ctx.fillText('MOST PLAYED THIS SEASON', x, y);
  if('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += Math.round(fontPx * 1.8);

  const cols = 3;
  const gap = Math.round(maxW * 0.04);
  const tileW = Math.round((maxW - gap * (cols - 1)) / cols);
  const nameFontPx = Math.round(fontPx * 0.95);
  const shown = albums.slice(0, cols);
  for(let i = 0; i < shown.length; i++){
    const rec = shown[i];
    const tx = x + i * (tileW + gap);
    ctx.save();
    roundRectPath(ctx, tx, y, tileW, tileW, Math.round(tileW * 0.04));
    ctx.clip();
    if(rec.art){
      try{
        const img = await loadImageEl(rec.art);
        drawCover(ctx, img, tx, y, tileW, tileW);
      }catch(_e){ await drawDiagonalWordmark(ctx, tx, y, tileW); }
    } else {
      await drawDiagonalWordmark(ctx, tx, y, tileW);
    }
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '400 ' + nameFontPx + 'px Archivo, sans-serif';
    ctx.fillStyle = kit.sub;
    ctx.fillText(shareFitText(ctx, rec.name || '', tileW), tx, y + tileW + Math.round(nameFontPx * 1.3));
  }
  return y + tileW + Math.round(nameFontPx * 1.3) + Math.round(fontPx * 0.8);
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
  // TY6 (docs/22_TYPE.md): the kicker is Archivo caps --track-caps, not mono.
  ctx.font = '600 ' + Math.round(w * 0.019) + 'px Archivo, sans-serif';
  ctx.fillStyle = kit.accent;
  if('letterSpacing' in ctx) ctx.letterSpacing = '.08em';
  ctx.fillText('THIS SEASON · LAST 90 DAYS', pad, dims.safeTop);
  if('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  // TY6: the season word (the verdict) is this card's one hand-lettered
  // element -- Caveat, not Antonio.
  const headlineSize = Math.round(w * (stacked ? 0.062 : 0.054));
  ctx.font = '700 ' + headlineSize + 'px Caveat, cursive';
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

  // QC2: top-albums row, omitted outright with nothing in the window
  y = await drawTopAlbumsRow(ctx, kit, pad, y, w - pad * 2, data.topAlbums || [], Math.round(w * 0.019));

  // SH6 item 5: footer, wordmark + [NAME]'S CRATE, bottom-right — the
  // same off-centre shape SH5 gave crate-card.js's own wordmark
  const wmFontPx = Math.round(w * 0.034);
  const wmWidth = wordmarkWidth(ctx, wmFontPx);
  const showName = (S.shareSelectionByCard.season.name !== false) && !!data.ownerName;
  const markY = Math.min(Math.max(y, dims.safeTop) + Math.round(h * 0.03), dims.safeBottom);
  await drawShareWordmark(ctx, w - pad - wmWidth / 2, markY, wmFontPx, kit.ink, kit.accent);
  if(showName){
    // TY6: metadata is Archivo .num, not mono.
    ctx.font = '600 ' + Math.round(w * 0.016) + 'px Archivo, sans-serif';
    ctx.textAlign = 'right'; ctx.fillStyle = kit.sub;
    ctx.fillText(data.ownerName.toUpperCase() + "'S CRATE", w - pad, markY + Math.round(w * 0.028));
    ctx.textAlign = 'left';
  }

  return canvas;
}
