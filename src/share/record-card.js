import { getVariantDef } from '../record-art/tiers.js';
import {
  SHARE_FORMATS, shareFitText, shareFitLines, roundRectPath,
  resolveShareStyle, drawDiagonalWordmark, loadImageEl, drawCover, fillShareDisc, drawShareFooter,
} from './styles.js';

/* ---- Record card (composeRecordShareImage) — the sleeve with the record
   pulled part-way out, the pressing's own facts column, the record block
   (title/artist·year/sleeve note on a taped paper slip) and a friends
   sticker on the jacket itself. `opts`: {style, format, data}. `data` is
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

// FS8 (docs/25_FROM_SCRATCH.md point 3): the friends sticker's own text --
// "3 friends" / "1 friend", the plain count the round sticker draws (the
// number large on its own line, the word underneath it) -- replacing the
// old "IN N FRIENDS' CRATES" chip copy. RF20: friends only (mutual
// follows), gated by the owner's own "count me in friends' stickers"
// switch, both already decided by whoever gathered `data` (the gatefold),
// per this card's own "the composer reads nothing else" rule above.
export function friendsStickerText(friendsCount){
  const n = Math.round(friendsCount || 0);
  if(n <= 0) return null;
  return n + (n === 1 ? ' friend' : ' friends');
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

// FS8: the round butter-yellow sticker on the jacket's own lower-left
// corner, overlapping both edges slightly and tilted -- the friends count
// as a physical sticker on the record, not a UI chip. Returns nothing;
// purely decorative, so it never affects anything laid out after it.
function drawFriendsSticker(ctx, text, coverLeft, coverBottom){
  const r = 54;
  const cx = coverLeft + 6, cy = coverBottom - 8;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-6 * Math.PI / 180);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.fillStyle = '#F2D14A';
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  const [num, word] = text.split(' ');
  ctx.fillStyle = '#1C1816';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '700 28px Archivo, sans-serif';
  ctx.fillText(num, 0, -2);
  ctx.font = '500 16px Archivo, sans-serif';
  ctx.fillText(word, 0, 18);
  ctx.restore();
}

// FS8 point 3: the sleeve note sits on a taped paper slip, not directly
// on the card's own background -- a cream rounded rect plus a small grey
// tape strip overlapping its top-left corner, the same "paper object"
// language the rest of the app's Caveat-on-paper surfaces use (CLAUDE.md's
// three-voices rule). Returns the slip's own bottom y.
function drawSleeveNoteSlip(ctx, note, x, y, maxW){
  const padX = 28, padY = 22;
  const { lines, fontSize } = shareFitLines(ctx, note, maxW - padX*2, 3, 30, '500', 'Caveat, cursive');
  const lineH = Math.round(fontSize*1.15);
  const slipH = padY*2 + lines.length*lineH - Math.round(lineH*0.2);
  const slipW = maxW;

  roundRectPath(ctx, x, y, slipW, slipH, 3);
  ctx.fillStyle = '#EDE6D6'; ctx.fill();

  // the tape strip, overlapping the slip's top edge
  ctx.save();
  ctx.translate(x + slipW*0.37, y);
  ctx.rotate(-2 * Math.PI/180);
  ctx.fillStyle = 'rgba(154,148,138,.55)';
  ctx.fillRect(-46, -14, 92, 26);
  ctx.restore();

  ctx.font = '500 ' + fontSize + 'px Caveat, cursive';
  ctx.fillStyle = '#2A2420';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let ty = y + padY + Math.round(fontSize*0.85);
  lines.forEach(line => { ctx.fillText(line, x + padX, ty); ty += lineH; });

  return y + slipH;
}

// Runs the whole composition once as pure geometry (draw=false, no
// fillText/fill/arc-fill/image-load side effects) to find the final y a
// real pass would land on — the one thing this card needs to know before
// it draws anything, so Story can centre the same layout in its taller
// safe band (item 6) instead of always starting flush at the top.
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
      }catch(_e){ await drawDiagonalWordmark(ctx, coverLeft, coverTop, coverSide); }
    } else {
      await drawDiagonalWordmark(ctx, coverLeft, coverTop, coverSide);
    }
    const friendsText = friendsStickerText(data.friendsCount);
    if(friendsText) drawFriendsSticker(ctx, friendsText, coverLeft, coverTop + coverSide);
  }

  const factsX = Math.max(coverLeft + coverSide, discCx + discR) + groupGap;
  const factsMaxW = Math.max(40, w - pad - factsX);
  const groupBottom = Math.max(coverTop + coverSide, discCy + discR);

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  let fy = coverTop;
  // TY6 (docs/22_TYPE.md): the kicker is Archivo caps --track-caps, not mono.
  ctx.font = '600 22px Archivo, sans-serif';
  fy += 22;
  if(draw){
    ctx.fillStyle = kit.accent;
    if('letterSpacing' in ctx) ctx.letterSpacing = '.08em';
    ctx.fillText('PRESSING', factsX, fy);
    if('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  fy += 30;

  // FS8 point 3: the pressing name is Antonio 40, not the old 80*scale.
  const facts = pressingFacts(data);
  const pressingSize = 40;
  ctx.font = '700 ' + pressingSize + 'px Antonio, sans-serif';
  const pressingName = shareFitText(ctx, facts.name, factsMaxW);
  fy += Math.round(pressingSize*0.95);
  if(draw){ ctx.fillStyle = kit.ink; ctx.fillText(pressingName, factsX, fy); }
  fy += 20;

  ctx.font = '500 20px "IBM Plex Mono", monospace';
  const subText = shareFitText(ctx, facts.sub, factsMaxW);
  if(draw){ ctx.fillStyle = kit.sub; ctx.fillText(subText, factsX, fy); }
  fy += 24;

  // FS8 point 3: rating ticks are cream, not the accent.
  const ticks = ratingTickCount(data.rating);
  if(ticks > 0){
    const tickW = 6, tickH = 28, tickGap = 8, tickR = 2;
    if(draw){
      for(let i = 0; i < 5; i++){
        const tx = factsX + i*(tickW + tickGap);
        ctx.fillStyle = i < ticks ? '#EFE9DF' : 'rgba(239,233,223,.22)';
        roundRectPath(ctx, tx, fy, tickW, tickH, tickR); ctx.fill();
      }
    }
    fy += tickH;
  }

  y = Math.max(groupBottom, fy) + Math.round(56*scale);

  const titleMax = w - pad*2;
  // FS8 point 3: the album title is Antonio 28.
  ctx.font = '700 28px Antonio, sans-serif';
  const titleText = shareFitText(ctx, data.album || '', titleMax);
  y += Math.round(28*0.95);
  if(draw){
    ctx.fillStyle = kit.ink;
    if('letterSpacing' in ctx) ctx.letterSpacing = '-.01em';
    ctx.fillText(titleText, pad, y);
    if('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  y += 30;

  ctx.font = '400 22px Archivo, sans-serif';
  const artistYear = [data.artist, data.year].filter(Boolean).join(' · ');
  const artistText = shareFitText(ctx, artistYear, titleMax);
  if(draw){ ctx.fillStyle = kit.sub; ctx.fillText(artistText, pad, y); }
  y += 30;

  const note = recordNoteText(data.note);
  if(note){
    if(draw) y = drawSleeveNoteSlip(ctx, note, pad, y, titleMax);
    else{
      const { lines, fontSize } = shareFitLines(ctx, note, titleMax - 56, 3, 30, '500', 'Caveat, cursive');
      y += 44 + lines.length*Math.round(fontSize*1.15);
    }
  }

  y += Math.round(60*scale);
  const footerY = y;
  if(draw) await drawShareFooter(ctx, kit, w, pad, footerY, data.ownerName || null);

  return footerY;
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
