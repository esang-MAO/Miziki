import { S } from '../state.js';
import { PHASES } from '../sundown/rhythm.js';
import { PHASE_COLOR } from '../profile/rhythm-card.js';
import {
  SHARE_FORMATS, shareFitText, resolveShareStyle,
  roundRectPath, loadImageEl, drawCover, drawDiagonalWordmark, drawShareFooter,
} from './styles.js';

/* ---- Season card (composeSeasonShareImage) — the season name as the
   headline ("Autumn", "Sep – Nov · 41 records"), the 24-hour listening
   ring with its verdict sentence beside it, "MOST SPUN" (the top 3
   albums by plays in the window), brand footer. `opts`: {style, format,
   data}. `data` is gathered by the profile's Listening screen (src/
   profile/screens.js): {verdict, shares, total} from
   computeRhythmShares(windowedPhaseCounts(...))/rhythmVerdictLabel
   (sundown/rhythm.js), {name, range} from seasonLabelFor(), recordCount
   from recordsInWindowCount() (history/achievements.js), topAlbums (QC2,
   docs/24_QUIET_COUNTS.md — the top 3 albums by plays in the same
   window, history/achievements.js's topAlbumsInWindow()) and ownerName.
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

function drawRing(ctx, kit, cx, cy, r, shares, total){
  ctx.save();
  ctx.fillStyle = ringGradient(ctx, cx, cy, legendOrder(shares), shares);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
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

// "noon"/"midnight" labels at the ring's own top/bottom, same as the
// profile's own live rhythm-card.js dial.
function drawRingLabels(ctx, kit, cx, cy, r){
  ctx.save();
  ctx.font = '500 18px Archivo, sans-serif';
  ctx.fillStyle = kit.sub;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('noon', cx, cy - r - 14);
  ctx.fillText('midnight', cx, cy + r + 28);
  ctx.restore();
}

// QC2 (docs/24_QUIET_COUNTS.md): "MOST SPUN" — the top 3 albums
// (data.topAlbums, already selected and windowed by
// history/achievements.js's topAlbumsInWindow()) as cover art plus the
// album name underneath, replacing the old metals/"N records played
// through" figures. Omitted outright with nothing in the window at all,
// same "no row when there's nothing to show" shape drawMetalsRow() used.
async function drawTopAlbumsRow(ctx, kit, x, y, maxW, albums){
  if(!albums.length) return y;
  // TY6: the kicker is Archivo caps --track-caps, not mono.
  ctx.font = '700 20px Archivo, sans-serif';
  ctx.fillStyle = kit.accent;
  if('letterSpacing' in ctx) ctx.letterSpacing = '.08em';
  ctx.fillText('MOST SPUN', x, y);
  if('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  y += 36;

  const cols = 3;
  const gap = Math.round(maxW * 0.04);
  const tileW = Math.round((maxW - gap * (cols - 1)) / cols);
  const nameFontPx = 19;
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
  return y + tileW + Math.round(nameFontPx * 1.3) + 24;
}

// FS8 (docs/25_FROM_SCRATCH.md point 4): "the verdict as a sentence" --
// rhythmVerdictLabel() reads "Lately, mostly after dark" for the profile
// card's own inline use; this card wants it standing alone ("Mostly
// after dark."), so the "Lately, " prefix is dropped and a period added.
export function verdictSentence(verdict){
  if(!verdict) return '';
  const stripped = verdict.replace(/^Lately,\s*/, '');
  const capped = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  return /[.!?]$/.test(capped) ? capped : capped + '.';
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
  const season = data.season || { name: 'This season', range: '' };
  const stacked = format === 'story';

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  // FS8 point 4: season name Antonio 40, "Sep – Nov · N records" muted,
  // on the same row.
  ctx.font = '700 40px Antonio, sans-serif';
  let y = dims.safeTop + 36;
  ctx.fillStyle = kit.ink;
  if('letterSpacing' in ctx) ctx.letterSpacing = '-.01em';
  ctx.fillText(season.name, pad, y);
  if('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  const nameW = ctx.measureText(season.name).width;

  const rangeText = [season.range, data.recordCount != null ? (data.recordCount + (data.recordCount === 1 ? ' record' : ' records')) : null]
    .filter(Boolean).join(' · ');
  if(rangeText){
    ctx.font = '400 20px Archivo, sans-serif';
    ctx.fillStyle = kit.sub;
    ctx.fillText(shareFitText(ctx, rangeText, w - pad*2 - nameW - 20), pad + nameW + 20, y);
  }
  y += 64;

  const ringR = Math.round(w * (stacked ? 0.19 : 0.145));
  const cx = pad + ringR, cy = y + ringR + 20;
  drawRing(ctx, kit, cx, cy, ringR, shares, total);
  drawRingLabels(ctx, kit, cx, cy, ringR);

  // FS8 point 4: the verdict sentence sits beside the ring, bold Archivo,
  // not the old Caveat headline / mono kicker.
  const sentence = verdictSentence(data.verdict);
  const textX = cx + ringR + Math.round(w*0.045);
  const textMaxW = w - pad - textX;
  ctx.font = '700 32px Archivo, sans-serif';
  ctx.fillStyle = kit.ink;
  ctx.fillText(shareFitText(ctx, sentence, textMaxW), textX, cy - 4);

  y = Math.max(cy + ringR, cy) + Math.round(w * 0.06);

  // QC2: top-albums row, omitted outright with nothing in the window
  y = await drawTopAlbumsRow(ctx, kit, pad, y, w - pad * 2, data.topAlbums || []);

  // FS8 point 1: footer, wordmark bottom-left, "from the crate of NAME"
  // bottom-right -- same shared helper every card now draws with.
  const showName = (S.shareSelectionByCard.season.name !== false) && !!data.ownerName;
  const footerY = Math.max(y + 20, dims.safeBottom - 30);
  await drawShareFooter(ctx, kit, w, pad, Math.min(footerY, dims.safeBottom), showName ? data.ownerName : null);

  return canvas;
}
