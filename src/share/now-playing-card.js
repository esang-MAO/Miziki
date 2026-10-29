import { albumKey, trackIdentityKey, selectVariant } from '../record-art/tiers.js';
import { albumMetalFor, trackMetalFor } from '../record-art/metals.js';
import { fmt } from '../util/text.js';
import {
  SHARE_FORMATS, shareFitText, shareFitLines, loadImageEl, drawCover,
  roundRectPath, drawShareWordmark, resolveShareStyle, shareChip, drawDiagonalWordmark,
  fillShareDisc, layoutChips, CHIP_FONT, CHIP_HEIGHT, CHIP_ROW_GAP,
} from './styles.js';
import { spinChipText } from '../sundown/spin-wording.js';

// SH2 (docs/18_SHARE.md): fixed spacing constants, doubled from the
// design README's own half-scale Now Playing board values — replacing
// the h*/titleSize* fractions the card used to space itself with, none
// of which tracked what was actually drawn.
const TITLE_CLEARANCE_GAP = 20; // README "gap 10" under the title band
const PROGRESS_GAP = { story: 80, square: 64, portrait: 72 }; // README "40 (story) / 32 (square)"; portrait has no board of its own
const CLOCK_GAP = 20; // README "10 below the bar"
const CHIPS_GAP = 60; // README "30 below the clock"
const FOOTER_CLEARANCE = 0.05; // the footer's own fixed distance above safeBottom, as a fraction of h — unchanged from before SH2, just now a fixed position rather than one content could push further down

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
      }catch(_e){ drawDiagonalWordmark(ctx, squareLeft, squareTop, side); }
    } else {
      drawDiagonalWordmark(ctx, squareLeft, squareTop, side);
    }
    y = squareTop + side + Math.round(h*0.06);
  }

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

  const titleMax = w - pad*2;
  const title = t.tags ? t.tags.title : (t.name || '');
  const artist = t.tags ? t.tags.artist : '';
  const albumYearText = [t.tags ? t.tags.album : '', data.year || null].filter(Boolean).join(' · ').toUpperCase();

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

  const footerTopY = bottomY - Math.round(h*FOOTER_CLEARANCE);

  // SH2 item 1/2/3: the title band and progress line are laid out once,
  // measurement-only (draw=false, no canvas side effects — fillText/fill/
  // stroke all stay inside `if(draw)`), to find where the content would
  // actually end up before a single pixel is painted. Item 4's own
  // "content never grows into the footer" rule needs to know that final
  // position *before* deciding whether to draw the chips/album·year line
  // at all, which a single draw-as-you-go pass (the pre-SH2 shape) can't
  // provide — there's nothing to "undo" once something is already drawn.
  const startY = y;
  function layoutBody(includeAlbumYear, includeChips, draw){
    let yy = startY;
    ctx.font = '700 ' + Math.round(w*0.024) + 'px "IBM Plex Mono", monospace';
    if(draw){ ctx.fillStyle = kit.accent; ctx.fillText('NOW PLAYING', w/2, yy); }
    yy += Math.round(w*0.05);

    const { lines: titleLines, fontSize: titleSize } = shareFitLines(ctx, title, titleMax, 2, Math.round(w*0.066), '700', 'Archivo, sans-serif');
    ctx.font = '700 ' + titleSize + 'px Archivo, sans-serif';
    titleLines.forEach(line => {
      yy += Math.round(titleSize*1.08);
      if(draw){ ctx.fillStyle = kit.ink; ctx.fillText(line, w/2, yy); }
    });
    // SH2 item 1: measured title height plus one fixed gap, never h*0.055
    // (or any other fraction of canvas height disconnected from the title
    // actually drawn above it).
    const lastTitleLine = titleLines[titleLines.length-1] || '';
    const titleMetrics = ctx.measureText(lastTitleLine);
    const titleDescent = titleMetrics.actualBoundingBoxDescent || Math.round(titleSize*0.22);
    yy += titleDescent + TITLE_CLEARANCE_GAP;

    ctx.font = '400 ' + Math.round(w*0.032) + 'px Archivo, sans-serif';
    const artistText = shareFitText(ctx, artist, titleMax);
    if(draw){ ctx.fillStyle = kit.sub; ctx.fillText(artistText, w/2, yy); }
    yy += Math.round(w*0.045);

    if(includeAlbumYear && albumYearText){
      ctx.font = '600 ' + Math.round(w*0.021) + 'px "IBM Plex Mono", monospace';
      const albumText = shareFitText(ctx, albumYearText, titleMax);
      if(draw){ ctx.fillStyle = kit.sub; ctx.fillText(albumText, w/2, yy); }
    }
    // SH2 item 2: the progress line always sits a fixed distance below
    // the band, whether or not album·year is the line that ends it.
    yy += PROGRESS_GAP[format] || PROGRESS_GAP.story;

    if(typeof data.elapsed === 'number' && data.duration > 0){
      const barW = w - pad*2, barY = yy, barH = 6;
      const frac = Math.max(0, Math.min(1, data.elapsed / data.duration));
      if(draw){
        ctx.fillStyle = kit.chipBg; roundRectPath(ctx, pad, barY, barW, barH, barH/2); ctx.fill();
        ctx.fillStyle = kit.accent; roundRectPath(ctx, pad, barY, Math.max(barH, barW*frac), barH, barH/2); ctx.fill();
        ctx.beginPath(); ctx.arc(pad + barW*frac, barY + barH/2, barH*1.5, 0, Math.PI*2); ctx.fillStyle = kit.accent; ctx.fill();
      }
      // SH2 item 2: the clock sits under the line, not inside the chip row.
      yy += CLOCK_GAP;
      ctx.font = '500 ' + Math.round(w*0.021) + 'px "IBM Plex Mono", monospace';
      if(draw){
        ctx.fillStyle = kit.sub;
        ctx.textAlign = 'left'; ctx.fillText(fmt(data.elapsed), pad, yy);
        ctx.textAlign = 'right'; ctx.fillText(fmt(data.duration), w - pad, yy);
        ctx.textAlign = 'center';
      }
      yy += CHIPS_GAP;
    }

    if(includeChips && chips.length){
      ctx.font = CHIP_FONT;
      const layout = layoutChips(ctx, chips, w - pad*2);
      if(draw){
        layout.rows.forEach((row, ri) => {
          const rowY = yy + ri*(CHIP_HEIGHT + CHIP_ROW_GAP);
          row.forEach(c => shareChip(ctx, kit, c.text, w/2 + c.x, rowY, c.filled));
        });
      }
      yy += layout.height;
    }

    return yy;
  }

  // SH2 item 4: the footer never moves to make room — content does. Chips
  // are dropped first, then ALBUM · YEAR, each only if the content would
  // otherwise overlap the footer's own fixed position.
  let includeAlbumYear = true, includeChips = true;
  if(layoutBody(true, true, false) > footerTopY){
    includeChips = false;
    if(layoutBody(true, false, false) > footerTopY) includeAlbumYear = false;
  }
  layoutBody(includeAlbumYear, includeChips, true);

  ctx.textAlign = 'center';
  await drawShareWordmark(ctx, w/2, footerTopY, Math.round(w*0.03), kit.ink, kit.accent);
  ctx.font = '600 ' + Math.round(w*0.0165) + 'px "IBM Plex Mono", monospace'; ctx.fillStyle = kit.sub;
  const lossless = !(t.meta && t.meta.lossless === false);
  ctx.fillText('LOCAL · ' + (lossless ? 'LOSSLESS' : 'LOSSY') + ' · NO STREAMING', w/2, footerTopY + Math.round(h*0.026));

  return canvas;
}
