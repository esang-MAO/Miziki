import { albumKey, trackIdentityKey, selectVariant } from '../record-art/tiers.js';
import { albumMetalFor, trackMetalFor } from '../record-art/metals.js';
import {
  SHARE_FORMATS, shareFitText, shareFitLines, loadImageEl, drawCover,
  roundRectPath, resolveShareStyle, nightSkyKit, drawDiagonalWordmark,
  fillShareDisc, drawSunIcon, drawShareFooter,
} from './styles.js';
import { spinPhaseWording } from '../sundown/spin-wording.js';

// SH3 (docs/18_SHARE.md): the track-specific lookups fillShareDisc() itself
// used to do are now this card's own job — the moved function (styles.js)
// takes an already-resolved {art, look, variant, metal} instead, so the
// Record card (whose own `data` already arrives pre-resolved by the
// gatefold) doesn't need to pull in trackIdentityKey/albumKey/
// selectVariant/albumMetalFor/trackMetalFor just to call it.
function discInfoFor(t, look){
  return {
    art: t.art || null,
    look,
    variant: selectVariant(t).variant,
    metal: trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumKey(t)),
  };
}

// FS8 (docs/25_FROM_SCRATCH.md point 2): "one line 'Spun at dusk · Vinyl ·
// FLAC 16/44.1'" — sentence case, not the removed uppercase chip row.
// Each part is omitted outright when its data is missing, same "no chip
// for nothing" rule the old chip list followed.
function spinSummaryLine(t, mode, phase, includePhase){
  const parts = [];
  const wording = includePhase !== false ? spinPhaseWording(phase) : null;
  if(wording) parts.push('Spun ' + wording);
  if(mode) parts.push(mode === 'vinyl' ? 'Vinyl' : 'Pure');
  if(t.meta && t.meta.codec){
    const rateB = [t.meta.rate ? (t.meta.rate/1000).toFixed(1) : null, t.meta.bits].filter(Boolean).join('/');
    parts.push(rateB ? (t.meta.codec + ' ' + rateB) : t.meta.codec);
  }
  return parts.join(' · ');
}

/* ---- Now Playing card (composePlayerShareImage) — the record peeking from
   behind its sleeve (fillShareDisc), kicker + title (auto-shrink to 2
   lines) + artist + album·year, one spin-summary line with a sun icon,
   brand footer. `opts`: {style, format, data}, data gathered by the
   caller (sheet.js's own gatherNowPlayingData()) from current()/S.pos/
   resolveLook() — the composer itself touches nothing but its
   arguments. FS8 (docs/25_FROM_SCRATCH.md point 2): no progress bar, no
   clock, no spec-chip row, no slogan line — removed outright, not
   hidden behind a flag. ---- */
export async function composePlayerShareImage(opts){
  const style = opts.style || 'night', format = opts.format || 'story';
  const dim = SHARE_FORMATS[format] || SHARE_FORMATS.story;
  const w = dim.w, h = dim.h;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  try{ await document.fonts.ready; }catch(_e){}
  const data = opts.data;
  if(!data || !data.track) return canvas;
  const t = data.track;

  // FS8 point 2: "the sky of the phase it was spun in" — only the Night
  // style gets the phase tint; Cover (dominant art color) and Paper stay
  // exactly what the user picked.
  const kit = style === 'night' ? nightSkyKit(data.phase) : await resolveShareStyle(style, t.art || null);
  kit.paintBg(ctx, w, h);

  const pad = Math.round(w*0.06);
  let y = dim.safeTop;
  const look = data.look;

  if(look === 'rare'){
    // full disc, standing alone — a jacket would duplicate the art already
    // suspended inside it (see the normal branch's own comment below)
    const r = Math.round(w * (format === 'story' ? 0.27 : 0.23));
    const cx = w/2, cy = y + r;
    await fillShareDisc(ctx, discInfoFor(t, look), cx, cy, r, false);
    y = cy + r + Math.round(h*0.05);
  } else {
    // the disc sits behind an album-art square, offset so roughly half of
    // it peeks out to the left — same geometry the original player-share
    // composition used, just placed per the format's own layout now
    const side = Math.round(w * (format === 'story' ? 0.52 : format === 'square' ? 0.46 : 0.48));
    const squareLeft = Math.round((w - side)/2 + side*0.22);
    const squareTop = y;
    const discCx = squareLeft, discCy = squareTop + side/2, r = side/2;
    await fillShareDisc(ctx, discInfoFor(t, look), discCx, discCy, r, true);
    if(t.art){
      try{
        const img = await loadImageEl(t.art);
        ctx.save(); roundRectPath(ctx, squareLeft, squareTop, side, side, 6); ctx.clip();
        drawCover(ctx, img, squareLeft, squareTop, side, side);
        ctx.restore();
      }catch(_e){ await drawDiagonalWordmark(ctx, squareLeft, squareTop, side); }
    } else {
      await drawDiagonalWordmark(ctx, squareLeft, squareTop, side);
    }
    y = squareTop + side + Math.round(h*0.06);
  }

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

  const titleMax = w - pad*2;
  const title = t.tags ? t.tags.title : (t.name || '');
  const artist = t.tags ? t.tags.artist : '';
  const albumYearText = [t.tags ? t.tags.album : '', data.year || null].filter(Boolean).join(' · ');

  // FS8 point 2: title Antonio 56, artist Archivo 20/500, Album · Year
  // Archivo 16 muted — literal px, not a fraction of w (every format
  // shares the same 1080 canvas width).
  const { lines: titleLines, fontSize: titleSize } = shareFitLines(ctx, title, titleMax, 2, 56, '700', 'Antonio, sans-serif');
  ctx.font = '700 ' + titleSize + 'px Antonio, sans-serif';
  titleLines.forEach(line => {
    y += Math.round(titleSize*1.08);
    ctx.fillStyle = kit.ink;
    if('letterSpacing' in ctx) ctx.letterSpacing = '-.01em';
    ctx.fillText(line, w/2, y);
    if('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  });
  y += 20;

  ctx.font = '500 20px Archivo, sans-serif';
  const artistText = shareFitText(ctx, artist, titleMax);
  ctx.fillStyle = kit.sub; ctx.fillText(artistText, w/2, y);
  y += 32;

  if(albumYearText){
    ctx.font = '400 16px Archivo, sans-serif';
    const albumText = shareFitText(ctx, albumYearText, titleMax);
    ctx.fillStyle = kit.sub; ctx.fillText(albumText, w/2, y);
    y += 44;
  } else {
    y += 20;
  }

  const summary = spinSummaryLine(t, data.mode, data.phase, data.includePhase);
  if(summary){
    const iconR = 11;
    ctx.font = '500 20px Archivo, sans-serif';
    const textW = ctx.measureText(summary).width;
    const gap = 12;
    const totalW = iconR*2 + gap + textW;
    const startX = w/2 - totalW/2;
    drawSunIcon(ctx, startX + iconR, y - 7, iconR, kit.accent);
    ctx.textAlign = 'left'; ctx.fillStyle = kit.ink;
    ctx.fillText(summary, startX + iconR*2 + gap, y);
    ctx.textAlign = 'center';
  }

  const footerY = dim.safeBottom - Math.round(h*0.05);
  await drawShareFooter(ctx, kit, w, pad, footerY, data.ownerName || null);

  return canvas;
}
