import { getVariantDef } from '../record-art/tiers.js';
import {
  SHARE_FORMATS, shareFitText, shareFitLines, roundRectPath, drawShareWordmark,
  resolveShareStyle, drawDiagonalWordmark, loadImageEl, drawCover, fillShareDisc,
} from './styles.js';

/* ---- Record card (composeRecordShareImage) — the sleeve with the record
   pulled part-way out, the pressing's own facts column, the record block
   (title/artist·year/sleeve note) and a footer row (friends sticker,
   wordmark + crate name). `opts`: {style, format, data}. `data` is
   gathered by the gatefold/record sheet: {album, artist, year, art,
   variant, metal, look, speed (33 | 45), rating, note, friendsCount,
   ownerName} — the composer reads nothing else (docs/18_SHARE.md, SH3
   item 1). Square is the default format (SH1 README's own "Per-card
   defaults" table); Story centres the same layout in its safe band with
   the sleeve group scaled up (item 6). ---- */

// SH3 item 7: the three pieces of real decision logic in this card, each
// a plain pure function so they're testable without touching a canvas.

// Five rating ticks, filled count = rating — an unrated record (0, null,
// undefined, negative) draws none at all, not five empty ones.
export function ratingTickCount(rating){
  const n = Math.round(rating || 0);
  return n > 0 ? Math.max(0, Math.min(5, n)) : 0;
}

// RF20: the friends sticker counts friends only (mutual follows) and is
// gated by the owner's own "count me in friends' stickers" switch — both
// already decided by whoever gathered `data` (the gatefold), per this
// card's own "the composer reads nothing else" rule above. Here it's a
// plain presence check: a sticker with nothing to say is no sticker.
export function friendsStickerText(friendsCount){
  const n = Math.round(friendsCount || 0);
  if(n <= 0) return null;
  return 'IN ' + n + (n === 1 ? " FRIEND'S CRATE" : " FRIENDS' CRATES");
}

// No note → the block is omitted outright (item 4), not drawn empty.
export function recordNoteText(note){
  const t = note && String(note).trim();
  return t || null;
}

function speedLabel(speed){ return speed === 45 ? '45' : '33⅓'; }

// the facts column's own two lines: the pressing name (Antonio) and the
// FINISH · BAND · SPEED sub-line (mono) — metal pressings have no
// finish/band of their own (that's a rarity-draw concept, not a
// play-count reward), so their sub-line is just the speed.
function pressingFacts(data){
  const def = data.look === 'metal' ? null : getVariantDef(data.variant);
  const name = data.look === 'metal'
    ? (data.metal ? data.metal[0].toUpperCase() + data.metal.slice(1) : 'Metal')
    : (def ? def.name : 'Pressing');
  const parts = [];
  if(def && def.finish) parts.push(def.finish.toUpperCase());
  if(def && def.band) parts.push(def.band.toUpperCase());
  parts.push(speedLabel(data.speed));
  return { name, sub: parts.join(' · ') };
}

function wordmarkWidth(ctx, fontPx){
  ctx.save();
  ctx.font = '700 ' + Math.round(fontPx) + 'px Antonio, sans-serif';
  const w = ctx.measureText('Mi').width + ctx.measureText('zi').width + ctx.measureText('ki').width;
  ctx.restore();
  return w;
}

// Runs the whole composition once as pure geometry (draw=false, no
// fillText/fill/arc-fill/image-load side effects) to find the final y a
// real pass would land on — the one thing this card needs to know before
// it draws anything, so Story can centre the same layout in its taller
// safe band (item 6) instead of always starting flush at the top. A
// sequential layout (unlike Now Playing's SH2 footer-pinning) is enough
// here: nothing is ever dropped for overlapping a fixed footer position —
// the footer just flows wherever the content above it ends (item 4's "the
// footer rises" when there's no note to push it down).
async function layoutRecord(ctx, kit, data, w, h, pad, scale, startY, draw){
  let y = startY;
  const groupGap = Math.round(56*scale);
  const coverSide = Math.round(464*scale);
  const discR = Math.round(216*scale);
  const discOffsetX = Math.round(192*scale);

  const coverLeft = pad, coverTop = y;
  const coverCx = coverLeft + coverSide/2, coverCy = coverTop + coverSide/2;
  const discCx = coverCx + discOffsetX, discCy = coverCy;

  if(draw){
    await fillShareDisc(ctx, {art: data.art || null, look: data.look, variant: data.variant, metal: data.metal}, discCx, discCy, discR, true);
    if(data.art){
      try{
        const img = await loadImageEl(data.art);
        ctx.save(); roundRectPath(ctx, coverLeft, coverTop, coverSide, coverSide, Math.round(6*scale)); ctx.clip();
        drawCover(ctx, img, coverLeft, coverTop, coverSide, coverSide);
        ctx.restore();
      }catch(_e){ drawDiagonalWordmark(ctx, coverLeft, coverTop, coverSide); }
    } else {
      drawDiagonalWordmark(ctx, coverLeft, coverTop, coverSide);
    }
  }

  const factsX = Math.max(coverLeft + coverSide, discCx + discR) + groupGap;
  const factsMaxW = Math.max(40, w - pad - factsX);
  const groupBottom = Math.max(coverTop + coverSide, discCy + discR);

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  let fy = coverTop;
  ctx.font = '600 ' + Math.round(22*scale) + 'px "IBM Plex Mono", monospace';
  fy += Math.round(22*scale);
  if(draw){ ctx.fillStyle = kit.accent; ctx.fillText('PRESSING', factsX, fy); }
  fy += Math.round(30*scale);

  const facts = pressingFacts(data);
  const pressingSize = Math.round(80*scale);
  ctx.font = '700 ' + pressingSize + 'px Antonio, sans-serif';
  const pressingName = shareFitText(ctx, facts.name, factsMaxW);
  fy += Math.round(pressingSize*0.95);
  if(draw){ ctx.fillStyle = kit.ink; ctx.fillText(pressingName, factsX, fy); }
  fy += Math.round(20*scale);

  ctx.font = '500 ' + Math.round(20*scale) + 'px "IBM Plex Mono", monospace';
  const subText = shareFitText(ctx, facts.sub, factsMaxW);
  if(draw){ ctx.fillStyle = kit.sub; ctx.fillText(subText, factsX, fy); }
  fy += Math.round(24*scale);

  const ticks = ratingTickCount(data.rating);
  if(ticks > 0){
    const tickW = Math.round(6*scale), tickH = Math.round(28*scale), tickGap = Math.round(8*scale), tickR = Math.round(2*scale);
    if(draw){
      for(let i = 0; i < 5; i++){
        const tx = factsX + i*(tickW + tickGap);
        ctx.fillStyle = i < ticks ? kit.accent : 'rgba(239,233,223,.22)';
        roundRectPath(ctx, tx, fy, tickW, tickH, tickR); ctx.fill();
      }
    }
    fy += tickH;
  }

  y = Math.max(groupBottom, fy) + Math.round(56*scale);

  const titleMax = w - pad*2;
  ctx.font = '700 ' + Math.round(52*scale) + 'px Archivo, sans-serif';
  const titleText = shareFitText(ctx, data.album || '', titleMax);
  y += Math.round(52*scale*0.95);
  if(draw){ ctx.fillStyle = kit.ink; ctx.fillText(titleText, pad, y); }
  y += Math.round(20*scale);

  ctx.font = '400 ' + Math.round(30*scale) + 'px Archivo, sans-serif';
  const artistYear = [data.artist, data.year].filter(Boolean).join(' · ');
  const artistText = shareFitText(ctx, artistYear, titleMax);
  if(draw){ ctx.fillStyle = '#B9C2C6'; ctx.fillText(artistText, pad, y); }
  y += Math.round(22*scale);

  const note = recordNoteText(data.note);
  if(note){
    y += Math.round(20*scale);
    const noteSizeBase = Math.round(30*scale);
    const { lines: noteLines, fontSize: noteSize } = shareFitLines(ctx, note, titleMax, 2, noteSizeBase, 'italic 400', 'Archivo, sans-serif');
    ctx.font = 'italic 400 ' + noteSize + 'px Archivo, sans-serif';
    noteLines.forEach(line => {
      y += Math.round(noteSize*1.4);
      if(draw){ ctx.fillStyle = '#D9D3C8'; ctx.fillText(line, pad, y); }
    });
  }

  // footer row: friends sticker left, wordmark + crate name right
  y += Math.round(60*scale);
  const wordmarkPx = Math.round(36*scale), crateNamePx = Math.round(18*scale);
  const rightEdge = w - pad;
  const wmW = wordmarkWidth(ctx, wordmarkPx);
  const wordmarkY = y + Math.round(wordmarkPx*0.78);
  const crateNameY = wordmarkY + crateNamePx + Math.round(10*scale);

  if(draw){
    drawShareWordmark(ctx, rightEdge - wmW/2, wordmarkY, wordmarkPx, kit.ink, kit.accent);
    ctx.font = '600 ' + crateNamePx + 'px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right'; ctx.fillStyle = kit.sub;
    const crateName = (data.ownerName ? data.ownerName.toUpperCase() + "'S CRATE" : 'MY CRATE');
    ctx.fillText(crateName, rightEdge, crateNameY);
  }

  const friendsText = friendsStickerText(data.friendsCount);
  if(friendsText){
    const dotR = Math.round(7*scale);
    const chipH = Math.round(40*scale), chipPadX = Math.round(16*scale);
    ctx.font = '600 ' + Math.round(20*scale) + 'px "IBM Plex Mono", monospace';
    const textW = ctx.measureText(friendsText).width;
    const chipW = dotR*2 + Math.round(10*scale) + textW + chipPadX*2;
    const chipX = pad, chipY = wordmarkY - chipH*0.72;
    if(draw){
      ctx.fillStyle = kit.chipBg;
      roundRectPath(ctx, chipX, chipY, chipW, chipH, chipH/2); ctx.fill();
      ctx.beginPath(); ctx.arc(chipX + chipPadX + dotR, chipY + chipH/2, dotR, 0, Math.PI*2);
      ctx.fillStyle = kit.accent; ctx.fill();
      ctx.textAlign = 'left'; ctx.fillStyle = kit.ink;
      ctx.fillText(friendsText, chipX + chipPadX + dotR*2 + Math.round(10*scale), chipY + chipH/2 + Math.round(7*scale));
    }
  }

  return Math.max(crateNameY, y + Math.round(40*scale));
}

export async function composeRecordShareImage(opts){
  const { style = 'night', format = 'square', data } = opts || {};
  const dim = SHARE_FORMATS[format] || SHARE_FORMATS.square;
  const w = dim.w, h = dim.h;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  try{ await document.fonts.ready; }catch(_e){}
  if(!data) return canvas;

  const kit = await resolveShareStyle(style, data.art || null);
  kit.paintBg(ctx, w, h);

  const pad = Math.round(w*0.055);
  // SH3 item 6: Square is this layout's own native size; Story scales the
  // sleeve group up and centres the whole composition in its own (much
  // taller) safe band.
  const scale = format === 'story' ? 1.15 : 1;

  const measuredBottom = await layoutRecord(ctx, kit, data, w, h, pad, scale, dim.safeTop, false);
  const totalHeight = measuredBottom - dim.safeTop;
  const startY = format === 'story'
    ? Math.max(dim.safeTop, dim.safeTop + ((dim.safeBottom - dim.safeTop) - totalHeight)/2)
    : dim.safeTop;

  await layoutRecord(ctx, kit, data, w, h, pad, scale, startY, true);

  return canvas;
}
