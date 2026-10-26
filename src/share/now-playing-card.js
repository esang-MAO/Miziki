import { albumKey, trackIdentityKey, VARIANT_DEFS, selectVariant } from '../record-art/tiers.js';
import { albumMetalFor, trackMetalFor, METAL_COLORS } from '../record-art/metals.js';
import { fmt } from '../player/clock.js';
import {
  SHARE_FORMATS, shareFitText, shareFitLines, shareSwatchGradient, loadImageEl, drawCover,
  roundRectPath, drawShareWordmark, resolveShareStyle, shareChip, drawDiagonalWordmark, hexMix,
} from './styles.js';
import { spinChipText } from '../sundown/spin-wording.js';

// Fills the full disc circle with whatever look is resolved for this track
// — same precedence applyDiscVariant() uses on the real platter — so the
// share image never falls back to a generic disc. `half` is true for the
// normal composition, where only the left semicircle ends up visible once
// the art square is drawn on top: asymmetric patterns need to orient
// themselves so both their colors land in that visible half instead of
// reading as one flat color (see LIBRARY spec §2, disc rendering).
async function fillShareDisc(ctx, t, look, cx, cy, r, half){
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.closePath(); ctx.clip();
  ctx.fillStyle = '#15161B'; ctx.fillRect(cx - r, cy - r, r*2, r*2);
  if(look === 'rare'){
    try{
      const img = await loadImageEl(t.art);
      drawCover(ctx, img, cx - r, cy - r, r*2, r*2);
      const dark = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      dark.addColorStop(0, 'rgba(0,0,0,.12)'); dark.addColorStop(0.88, 'rgba(0,0,0,.55)'); dark.addColorStop(1, 'rgba(0,0,0,.78)');
      ctx.fillStyle = dark; ctx.fillRect(cx - r, cy - r, r*2, r*2);
    }catch(_e){}
  } else if(look === 'metal'){
    const metal = trackMetalFor(trackIdentityKey(t)) || albumMetalFor(albumKey(t));
    // PRESSINGS_110 PR4: `mid` is this swatch's equivalent of the old `base`.
    const base = ((METAL_COLORS[metal] || METAL_COLORS.bronze)).mid;
    const colors = [hexMix(base, '#ffffff', 0.45), base, hexMix(base, '#000000', 0.5)];
    ctx.fillStyle = shareSwatchGradient(ctx, cx, cy, r, colors);
    ctx.fillRect(cx - r, cy - r, r*2, r*2);
  } else {
    const {variant} = selectVariant(t);
    const def = VARIANT_DEFS[variant];
    const [a, b, c] = def.colors;
    if(def.pattern === 'split' && half){
      // a left/right split would read as one flat color once the right
      // half is occluded by the art panel — a top/bottom split instead
      // guarantees both colors land within the visible left arc
      ctx.fillStyle = a; ctx.fillRect(cx - r, cy - r, r*2, r);
      ctx.fillStyle = c; ctx.fillRect(cx - r, cy, r*2, r);
    } else if(def.pattern === 'split'){
      ctx.fillStyle = a; ctx.fillRect(cx, cy - r, r, r*2);
      ctx.fillStyle = c; ctx.fillRect(cx - r, cy - r, r, r*2);
    } else if(def.pattern === 'swirl'){
      const g = ctx.createConicGradient(0, cx, cy);
      [a, b, c, a, b, c, a].forEach((col, i) => g.addColorStop(i/6, col));
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r*2, r*2);
    } else if(def.pattern === 'splatter'){
      // random enough that either half works, so no orientation care needed
      ctx.fillStyle = c; ctx.fillRect(cx - r, cy - r, r*2, r*2);
      const spots = [[30,25],[70,20],[50,50],[20,65],[80,60],[40,80],[65,40],[15,40]];
      spots.forEach(([px, py], i) => {
        const sx = cx - r + (px/100)*r*2, sy = cy - r + (py/100)*r*2;
        ctx.beginPath(); ctx.arc(sx, sy, r*0.06, 0, Math.PI*2);
        ctx.fillStyle = i % 2 ? b : a; ctx.fill();
      });
    } else {
      ctx.fillStyle = shareSwatchGradient(ctx, cx, cy, r, def.colors);
      ctx.fillRect(cx - r, cy - r, r*2, r*2);
    }
  }
  // groove rings so it still reads as a record, not a flat swatch
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
  for(let rr = r*0.4; rr < r*0.97; rr += r*0.085){
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI*2); ctx.stroke();
  }
  ctx.restore();
  // label
  const lr = r * 0.32;
  ctx.beginPath(); ctx.arc(cx, cy, lr, 0, Math.PI*2);
  ctx.fillStyle = '#3A2007'; ctx.fill();
  if(look === 'rare'){
    try{
      const limg = await loadImageEl(t.art);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, lr, 0, Math.PI*2); ctx.clip();
      drawCover(ctx, limg, cx - lr, cy - lr, lr*2, lr*2);
      ctx.restore();
    }catch(_e){}
  }
}

/* ---- Now Playing card (composePlayerShareImage) — the record peeking from
   behind its sleeve (fillShareDisc), kicker + title (auto-shrink to 2
   lines) + artist + album·year, a live progress line, spec chips, brand
   footer. `opts`: {style, format, data}, data gathered by the caller
   (sheet.js's own gatherNowPlayingData()) from current()/S.pos/
   resolveLook() — the composer itself touches nothing but its
   arguments. ---- */
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

  const kit = await resolveShareStyle(style, t.art || null);
  kit.paintBg(ctx, w, h);

  const pad = Math.round(w*0.06);
  let y = dim.safeTop;
  const bottomY = dim.safeBottom;
  const look = data.look;

  if(look === 'rare'){
    // full disc, standing alone — a jacket would duplicate the art already
    // suspended inside it (see the normal branch's own comment below)
    const r = Math.round(w * (format === 'story' ? 0.27 : 0.23));
    const cx = w/2, cy = y + r;
    await fillShareDisc(ctx, t, look, cx, cy, r, false);
    y = cy + r + Math.round(h*0.05);
  } else {
    // the disc sits behind an album-art square, offset so roughly half of
    // it peeks out to the left — same geometry the original player-share
    // composition used, just placed per the format's own layout now
    const side = Math.round(w * (format === 'story' ? 0.52 : format === 'square' ? 0.46 : 0.48));
    const squareLeft = Math.round((w - side)/2 + side*0.22);
    const squareTop = y;
    const discCx = squareLeft, discCy = squareTop + side/2, r = side/2;
    await fillShareDisc(ctx, t, look, discCx, discCy, r, true);
    if(t.art){
      try{
        const img = await loadImageEl(t.art);
        ctx.save(); roundRectPath(ctx, squareLeft, squareTop, side, side, 6); ctx.clip();
        drawCover(ctx, img, squareLeft, squareTop, side, side);
        ctx.restore();
      }catch(_e){ drawDiagonalWordmark(ctx, squareLeft, squareTop, side); }
    } else {
      drawDiagonalWordmark(ctx, squareLeft, squareTop, side);
    }
    y = squareTop + side + Math.round(h*0.06);
  }

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '700 ' + Math.round(w*0.024) + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.accent;
  ctx.fillText('NOW PLAYING', w/2, y);
  y += Math.round(w*0.05);

  const titleMax = w - pad*2;
  const title = t.tags ? t.tags.title : (t.name || '');
  const { lines: titleLines, fontSize: titleSize } = shareFitLines(ctx, title, titleMax, 2, Math.round(w*0.066), '700', 'Archivo, sans-serif');
  ctx.font = '700 ' + titleSize + 'px Archivo, sans-serif'; ctx.fillStyle = kit.ink;
  titleLines.forEach(line => { y += Math.round(titleSize*1.08); ctx.fillText(line, w/2, y); });
  // clearance scaled to the title's own (auto-shrunk) size, not a fixed
  // fraction of canvas height — otherwise a large title in a short format
  // leaves too little room before the descender meets the artist line
  y += Math.round(titleSize*0.85);

  ctx.font = '400 ' + Math.round(w*0.032) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
  ctx.fillText(shareFitText(ctx, t.tags ? t.tags.artist : '', titleMax), w/2, y);
  y += Math.round(w*0.045);

  const albumYear = [t.tags ? t.tags.album : '', data.year || null].filter(Boolean).join(' · ');
  ctx.font = '600 ' + Math.round(w*0.021) + 'px "IBM Plex Mono", monospace'; ctx.fillStyle = kit.sub;
  ctx.fillText(shareFitText(ctx, albumYear.toUpperCase(), titleMax), w/2, y);
  y += Math.round(h*0.055);

  if(typeof data.elapsed === 'number' && data.duration > 0){
    const barW = w - pad*2, barY = y, barH = 6;
    const frac = Math.max(0, Math.min(1, data.elapsed / data.duration));
    ctx.fillStyle = kit.chipBg; roundRectPath(ctx, pad, barY, barW, barH, barH/2); ctx.fill();
    ctx.fillStyle = kit.accent; roundRectPath(ctx, pad, barY, Math.max(barH, barW*frac), barH, barH/2); ctx.fill();
    ctx.beginPath(); ctx.arc(pad + barW*frac, barY + barH/2, barH*1.5, 0, Math.PI*2); ctx.fillStyle = kit.accent; ctx.fill();
    y += Math.round(h*0.03);
    ctx.font = '500 ' + Math.round(w*0.021) + 'px "IBM Plex Mono", monospace'; ctx.fillStyle = kit.sub;
    ctx.textAlign = 'left'; ctx.fillText(fmt(data.elapsed), pad, y);
    ctx.textAlign = 'right'; ctx.fillText(fmt(data.duration), w - pad, y);
    ctx.textAlign = 'center';
    y += Math.round(h*0.05);
  }

  // spec chips: FLAC/sample-rate/bit-depth, plus the current mode — each
  // omitted outright when its data is missing (spec §2)
  const chips = [];
  const specParts = [t.meta && t.meta.codec, t.meta && t.meta.rate ? (t.meta.rate/1000).toFixed(1)+' kHz' : null,
    t.meta && t.meta.bits ? t.meta.bits+'-bit' : null].filter(Boolean);
  if(specParts.length) chips.push({text: specParts.join(' · '), filled:false});
  if(data.mode) chips.push({text: String(data.mode).toUpperCase(), filled:true});
  // DA6 (docs/DAY_ARC.md): "SPUN AT DUSK" -- the same chip style as the
  // spec/mode chips above, gated by the share sheet's own "Time of day"
  // Include toggle (data.includePhase, default on).
  const spinText = spinChipText(data.phase, data.includePhase);
  if(spinText) chips.push({text: spinText, filled:false});
  if(chips.length){
    ctx.font = '600 22px "IBM Plex Mono", monospace';
    const gap = Math.round(w*0.018);
    const widths = chips.map(c => ctx.measureText(c.text).width + 44);
    const totalW = widths.reduce((s,x) => s+x, 0) + gap*(chips.length-1);
    let cx = w/2 - totalW/2;
    chips.forEach(c => { const cw = shareChip(ctx, kit, c.text, cx, y, c.filled); cx += cw + gap; });
    y += 46 + Math.round(h*0.045);
  }

  ctx.textAlign = 'center';
  const markY = Math.max(y, bottomY - Math.round(h*0.05));
  drawShareWordmark(ctx, w/2, markY, Math.round(w*0.03), kit.ink, kit.accent);
  ctx.font = '600 ' + Math.round(w*0.0165) + 'px "IBM Plex Mono", monospace'; ctx.fillStyle = kit.sub;
  const lossless = !(t.meta && t.meta.lossless === false);
  ctx.fillText('LOCAL · ' + (lossless ? 'LOSSLESS' : 'LOSSY') + ' · NO STREAMING', w/2, markY + Math.round(h*0.026));

  return canvas;
}
