import { S } from '../state.js';
import { albumKey } from '../record-art/tiers.js';
import { topAlbums, topTracks } from '../history/achievements.js';
import {
  SHARE_FORMATS, shareFitText, shareSwatchGradient, loadImageEl, drawCover,
  roundRectPath, drawShareWordmark, wordmarkWidth, resolveShareStyle, drawDiagonalWordmark,
} from './styles.js';
import { fmtCount } from '../util/text.js';

// SH5 (docs/18_SHARE.md): the wordmark moved off-centre (bottom-right), so
// its own width has to be measured ahead of drawShareWordmark's call
// (which always centres on whatever x it's given) -- same font string,
// measured and discarded before the real draw.
/* ---- My Crate card (composeShareImage) — avatar/name/counts, hero = top
   record, a grid of the next covers, top songs, brand wordmark. SH5
   (docs/18_SHARE.md) dropped the metals/collection/rhythm sections this
   card used to also carry -- that's the profile's own Listening screen
   and share/season-card.js's job now, not every crate share. `opts`:
   {style, format, sections}. Pure: no DOM reads, only the same
   state-reading anchors the original drew from (topAlbums/topTracks/
   S.profile/S.tracks). ---- */
export async function composeShareImage(opts){
  const style = opts.style || 'night', format = opts.format || 'square';
  const sections = opts.sections || {};
  const dim = SHARE_FORMATS[format] || SHARE_FORMATS.square;
  const w = dim.w, h = dim.h;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  try{ await document.fonts.ready; }catch(_e){}

  const topAlbum = topAlbums(1)[0];
  const kit = await resolveShareStyle(style, topAlbum && topAlbum.display.art);
  kit.paintBg(ctx, w, h);

  const pad = Math.round(w*0.055);
  const topY = dim.safeTop, bottomY = dim.safeBottom;
  const twoCol = format !== 'story';

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  // header: avatar, name (if on), album/track counts
  const avSize = Math.round(w*0.075);
  const avX = pad, avY = topY;
  ctx.save();
  ctx.beginPath(); ctx.arc(avX+avSize/2, avY+avSize/2, avSize/2, 0, Math.PI*2); ctx.clip();
  let drewAvatar = false;
  if(S.profile.art){
    try{ const img = await loadImageEl(S.profile.art); drawCover(ctx, img, avX, avY, avSize, avSize); drewAvatar = true; }catch(_e){}
  }
  if(!drewAvatar){
    ctx.fillStyle = shareSwatchGradient(ctx, avX+avSize/2, avY+avSize/2, avSize/2, ['#3E8E7E','#245048','#122623']);
    ctx.fillRect(avX, avY, avSize, avSize);
    if(S.profile.name){
      ctx.fillStyle = kit.name === 'paper' ? '#EDE6D6' : '#EFE9DF';
      ctx.font = '600 ' + Math.round(avSize*0.42) + 'px Archivo, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(S.profile.name[0].toUpperCase(), avX+avSize/2, avY+avSize/2+1);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  }
  ctx.restore();

  const showName = sections.name !== false && !!S.profile.name;
  // SH5 item 1: "records", not "albums" -- matching the crate's own
  // header line (CR1), since this card is a picture of that same crate.
  const recordCount = new Set(S.tracks.map(t => albumKey(t))).size;
  const trackCount = S.tracks.length;
  const textX = avX + avSize + Math.round(w*0.025);
  const headName = showName ? S.profile.name.toUpperCase() + "'S CRATE" : 'MY CRATE';
  ctx.font = '700 ' + Math.round(w*0.042) + 'px Antonio, sans-serif';
  ctx.fillStyle = kit.ink;
  ctx.fillText(shareFitText(ctx, headName, w - textX - pad), textX, avY + avSize*0.42);
  ctx.font = '500 ' + Math.round(w*0.02) + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.sub;
  ctx.fillText(recordCount + ' RECORDS · ' + trackCount + ' TRACKS', textX, avY + avSize*0.42 + Math.round(w*0.03));

  let y = avY + avSize + Math.round(h*0.04);
  const heroW = twoCol ? Math.round(w*0.42) : Math.round(w*0.56);
  const heroX = twoCol ? pad : Math.round((w-heroW)/2);
  const heroH = heroW;

  if(topAlbum){
    if(topAlbum.display.art){
      try{ const img = await loadImageEl(topAlbum.display.art); ctx.save(); roundRectPath(ctx, heroX, y, heroW, heroH, 6); ctx.clip(); drawCover(ctx, img, heroX, y, heroW, heroH); ctx.restore(); }
      catch(_e){ drawDiagonalWordmark(ctx, heroX, y, heroW); }
    } else drawDiagonalWordmark(ctx, heroX, y, heroW);
  } else {
    ctx.fillStyle = kit.chipBg; roundRectPath(ctx, heroX, y, heroW, heroH, 6); ctx.fill();
  }

  if(twoCol){
    // 2x2 grid of the next top covers, to the right of the hero
    const gridX = heroX + heroW + Math.round(w*0.03);
    const gridW = w - pad - gridX;
    const cell = (gridW - Math.round(w*0.02)) / 2;
    const nextAlbums = topAlbums(5).slice(1, 5);
    for(let i = 0; i < 4; i++){
      const cx = gridX + (i%2)*(cell + Math.round(w*0.02));
      const cy = y + Math.floor(i/2)*(cell + Math.round(w*0.02));
      const a = nextAlbums[i];
      if(a && a.display.art){
        try{ const img = await loadImageEl(a.display.art); ctx.save(); roundRectPath(ctx, cx, cy, cell, cell, 5); ctx.clip(); drawCover(ctx, img, cx, cy, cell, cell); ctx.restore(); }
        catch(_e){ ctx.fillStyle = kit.chipBg; roundRectPath(ctx, cx, cy, cell, cell, 5); ctx.fill(); }
      } else {
        ctx.fillStyle = kit.chipBg; roundRectPath(ctx, cx, cy, cell, cell, 5); ctx.fill();
        if(a){
          ctx.fillStyle = kit.sub; ctx.font = '600 20px "IBM Plex Mono", monospace';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(shareFitText(ctx, a.display.name, cell-16), cx+cell/2, cy+cell/2);
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        }
      }
    }
    y += heroH + Math.round(h*0.035);
  } else {
    // single column: a plain row of the next covers beneath the hero
    y += heroH + Math.round(h*0.03);
    const nextAlbums = topAlbums(5).slice(1, 5);
    if(nextAlbums.length){
      const cell = Math.round((w - pad*2 - (nextAlbums.length-1)*Math.round(w*0.025)) / 4);
      let cx = pad;
      for(const a of nextAlbums){
        if(a.display.art){
          try{ const img = await loadImageEl(a.display.art); ctx.save(); roundRectPath(ctx, cx, y, cell, cell, 5); ctx.clip(); drawCover(ctx, img, cx, y, cell, cell); ctx.restore(); }
          catch(_e){ ctx.fillStyle = kit.chipBg; roundRectPath(ctx, cx, y, cell, cell, 5); ctx.fill(); }
        } else { ctx.fillStyle = kit.chipBg; roundRectPath(ctx, cx, y, cell, cell, 5); ctx.fill(); }
        cx += cell + Math.round(w*0.025);
      }
      y += cell + Math.round(h*0.03);
    }
  }

  ctx.font = '700 ' + Math.round(w*0.02) + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.accent;
  ctx.fillText('01 · TOP ALBUM', twoCol ? heroX : pad, y);
  y += Math.round(w*0.04);
  ctx.font = '700 ' + Math.round(w*0.04) + 'px Archivo, sans-serif';
  ctx.fillStyle = kit.ink;
  ctx.fillText(shareFitText(ctx, topAlbum ? topAlbum.display.name : 'Nothing yet', w - pad - (twoCol?heroX:pad)), twoCol ? heroX : pad, y);
  y += Math.round(w*0.034);
  ctx.font = '400 ' + Math.round(w*0.024) + 'px Archivo, sans-serif';
  ctx.fillStyle = kit.sub;
  const subLine = topAlbum ? (topAlbum.display.artist + ' · ' + fmtCount(topAlbum.count, 'session', 'sessions')) : '';
  ctx.fillText(shareFitText(ctx, subLine, w - pad - (twoCol?heroX:pad)), twoCol ? heroX : pad, y);
  y += Math.round(h*0.05);

  // SH5 item 4/5: metals, collection and the rhythm chip are gone -- TOP
  // SONGS is now the one thing below the album block, full width, so it
  // can run all the way down to the bottom padding (item 5's own reason
  // the wordmark moved off-centre).
  const leftX = pad, colW = w - pad*2;
  let leftY = y;

  if(sections.songs !== false){
    ctx.font = '700 ' + Math.round(w*0.019) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = kit.accent;
    ctx.fillText('TOP SONGS', leftX, leftY);
    leftY += Math.round(w*0.036);
    // SH5 item 3: three rows in Square (and portrait, which has no board
    // of its own), five in Story -- matching the design README's own
    // "Three rows in Square, five in Story" line for this section.
    const songRows = format === 'story' ? 5 : 3;
    const list = topTracks(songRows);
    if(list.length){
      list.forEach((t, i) => {
        // rank in the accent colour, mono -- its own font/colour, never
        // the title's, which the pre-SH5 code drew both in together
        ctx.font = '600 ' + Math.round(w*0.016) + 'px "IBM Plex Mono", monospace';
        ctx.fillStyle = kit.accent;
        const rankStr = String(i+1).padStart(2,'0');
        ctx.fillText(rankStr, leftX, leftY);
        const rankW = ctx.measureText(rankStr).width + Math.round(w*0.014);

        // the artist sub never wraps and never grows past 40% of the row
        // (README: "max 40% of the row, never wrapping") -- reserved
        // first so the title's own available width already accounts for it
        const subMaxW = colW * 0.4;
        ctx.font = '400 ' + Math.round(w*0.02) + 'px Archivo, sans-serif';
        const subText = '· ' + t.artist;

        ctx.font = '600 ' + Math.round(w*0.027) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.ink;
        const titleAvailW = Math.max(20, colW - rankW - subMaxW - Math.round(w*0.012));
        const titleText = shareFitText(ctx, t.title, titleAvailW);
        ctx.fillText(titleText, leftX + rankW, leftY);
        const titleW = ctx.measureText(titleText).width;

        ctx.font = '400 ' + Math.round(w*0.02) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
        const subX = leftX + rankW + titleW + Math.round(w*0.012);
        const subAvailW = Math.min(subMaxW, Math.max(10, leftX + colW - subX));
        ctx.fillText(shareFitText(ctx, subText, subAvailW), subX, leftY);

        leftY += Math.round(w*0.042);
      });
    } else {
      ctx.font = '400 ' + Math.round(w*0.024) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
      ctx.fillText('Nothing in the sleeve yet.', leftX, leftY);
      leftY += Math.round(w*0.04);
    }
  }

  // SH5 item 5: bottom-right, not centred -- measured ahead so the mark
  // itself (which always centres on whatever x it's given) lands flush
  // against the right-hand padding.
  const wmFontPx = Math.round(w*0.034);
  const wmWidth = wordmarkWidth(ctx, wmFontPx);
  const markY = Math.min(Math.max(leftY, Math.round(h*0.02)) + Math.round(h*0.03), bottomY);
  drawShareWordmark(ctx, w - pad - wmWidth/2, markY, wmFontPx, kit.ink, kit.accent);

  return canvas;
}
