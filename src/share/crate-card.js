import { S } from '../state.js';
import { albumKey, getVariantDef } from '../record-art/tiers.js';
import { METAL_COLORS } from '../record-art/metals.js';
import { topAlbums, topTracks, achievementsList } from '../history/achievements.js';
import {
  SHARE_FORMATS, shareFitText, shareSwatchGradient, loadImageEl, drawCover,
  roundRectPath, drawShareWordmark, resolveShareStyle, hexMix, drawDiagonalWordmark, shareChip,
} from './styles.js';
import { fmtCount } from '../profile/screens.js';
import {
  computeRhythmShares, rhythmVerdictLabel, RHYTHM_MIN_PLAYS, RHYTHM_WINDOW_DAYS, windowedPhaseCounts,
} from '../sundown/rhythm.js';

/* ---- My Crate card (composeShareImage) — avatar/name/counts, hero = top
   album, a grid of the next covers, top songs, metals + collection, brand.
   `opts`: {style, format, sections}. Pure: no DOM reads, only the same
   state-reading anchors the original drew from (topAlbums/topTracks/
   achievementsList/S.collection/S.profile/S.tracks). ---- */
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
  const albumCount = new Set(S.tracks.map(t => albumKey(t))).size;
  const trackCount = S.tracks.length;
  const textX = avX + avSize + Math.round(w*0.025);
  const headName = showName ? S.profile.name.toUpperCase() + "'S CRATE" : 'MY CRATE';
  ctx.font = '700 ' + Math.round(w*0.042) + 'px Antonio, sans-serif';
  ctx.fillStyle = kit.ink;
  ctx.fillText(shareFitText(ctx, headName, w - textX - pad), textX, avY + avSize*0.42);
  ctx.font = '500 ' + Math.round(w*0.02) + 'px "IBM Plex Mono", monospace';
  ctx.fillStyle = kit.sub;
  ctx.fillText(albumCount + ' ALBUMS · ' + trackCount + ' TRACKS', textX, avY + avSize*0.42 + Math.round(w*0.03));

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

  // two columns (portrait/square): songs left, metals+collection stacked
  // right. Single column (story): all three stack in the one column, so
  // rightY is kept in sync with leftY between sections rather than starting
  // fresh — otherwise metals/collection would overlap songs instead of
  // continuing below it (spec §2, "Story is a single column").
  const colSplitX = twoCol ? Math.round(w/2) : null;
  let leftY = y, rightY = y;
  const leftX = pad, rightX = colSplitX != null ? colSplitX + Math.round(w*0.02) : pad;
  const colW = (colSplitX != null ? colSplitX - leftX - Math.round(w*0.03) : w - pad*2);

  if(sections.songs !== false){
    ctx.font = '700 ' + Math.round(w*0.019) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = kit.accent;
    ctx.fillText('TOP SONGS', leftX, leftY);
    leftY += Math.round(w*0.036);
    const list = topTracks(5);
    const rows = twoCol ? list.slice(0, 4) : list.slice(0, 4);
    if(rows.length){
      rows.forEach((t, i) => {
        ctx.font = '600 ' + Math.round(w*0.027) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.ink;
        const rankStr = String(i+1).padStart(2,'0') + '  ';
        ctx.fillText(rankStr, leftX, leftY);
        const rankW = ctx.measureText(rankStr).width;
        const titleW = ctx.measureText(t.title).width;
        ctx.fillText(shareFitText(ctx, t.title, colW - rankW), leftX + rankW, leftY);
        ctx.font = '400 ' + Math.round(w*0.02) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
        const subX = leftX + rankW + Math.min(titleW, colW - rankW) + 8;
        ctx.fillText(shareFitText(ctx, '· ' + t.artist, Math.max(10, leftX + colW - subX)), subX, leftY);
        leftY += Math.round(w*0.042);
      });
    } else {
      ctx.font = '400 ' + Math.round(w*0.024) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
      ctx.fillText('Nothing in the sleeve yet.', leftX, leftY);
      leftY += Math.round(w*0.04);
    }
  }

  if(!twoCol) rightY = leftY;
  if(sections.metals !== false){
    ctx.font = '700 ' + Math.round(w*0.019) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = kit.accent;
    ctx.fillText('METALS', rightX, rightY);
    rightY += Math.round(w*0.036);
    const list = achievementsList();
    if(list.length){
      const counts = {};
      list.forEach(a => { counts[a.tier] = (counts[a.tier] || 0) + 1; });
      const order = ['rare','platinum','gold','silver','bronze'];
      const r = Math.round(w*0.026);
      let cx = rightX + r;
      order.filter(k => counts[k]).forEach(k => {
        ctx.beginPath(); ctx.arc(cx, rightY + r*0.2, r, 0, Math.PI*2);
        const metalBase = (METAL_COLORS[k] && METAL_COLORS[k].base) || '#9c8a74';
        ctx.fillStyle = shareSwatchGradient(ctx, cx, rightY + r*0.2, r, [metalBase, hexMix(metalBase,'#000',0.35), hexMix(metalBase,'#000',0.6)]);
        ctx.fill();
        ctx.fillStyle = '#171310'; ctx.font = '700 ' + Math.round(r*0.85) + 'px Archivo, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(counts[k]), cx, rightY + r*0.2 + 1);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        cx += r*2 + Math.round(w*0.016);
      });
      rightY += r*2 + Math.round(w*0.03);
    } else {
      ctx.font = '400 ' + Math.round(w*0.024) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
      ctx.fillText('Nothing earned yet.', rightX, rightY);
      rightY += Math.round(w*0.04);
    }
  }

  if(sections.collection !== false){
    ctx.font = '700 ' + Math.round(w*0.019) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = kit.accent;
    ctx.fillText('COLLECTION', rightX, rightY);
    rightY += Math.round(w*0.036);
    const items = Object.values(S.collection).slice(0, 6);
    if(items.length){
      const r = Math.round(w*0.024), spacing = r*2 + Math.round(w*0.012);
      items.forEach((rec, i) => {
        const cx = rightX + r + i*spacing, cy = rightY + r;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.fillStyle = shareSwatchGradient(ctx, cx, cy, r, getVariantDef(rec.variant).colors);
        ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.stroke();
      });
      rightY += r*2 + Math.round(w*0.03);
    } else {
      ctx.font = '400 ' + Math.round(w*0.024) + 'px Archivo, sans-serif'; ctx.fillStyle = kit.sub;
      ctx.fillText('Nothing collected yet.', rightX, rightY);
      rightY += Math.round(w*0.04);
    }
  }

  // DA6 (docs/DAY_ARC.md); windowed and reworded RF22 ("words that
  // invite"): the rhythm verdict, shown only once the profile card itself
  // would be unlocked (>= 20 plays counted over the same rolling
  // RHYTHM_WINDOW_DAYS window the card itself now reads, not a lifetime
  // total -- see sundown/rhythm.js's own header comment) -- not
  // separately unit-tested, per the same escape valve
  // tests/unit/share.test.js's own entry already documents for
  // composeShareImage's hero/top-items selection: it's inline in an
  // async canvas-drawing function with no meaningful pure core beyond
  // the already-tested computeRhythmShares/rhythmVerdictLabel/
  // RHYTHM_MIN_PLAYS/windowedPhaseCounts this reuses, not a new decision
  // of its own. No .toUpperCase() any more -- RF22's own "Lately, mostly
  // after dark" is meant to read as a sentence, not a shouted label like
  // the old "NIGHT LISTENER" chip text.
  let markY = Math.max(leftY, rightY, Math.round(h*0.02)) + Math.round(h*0.03);
  if(sections.rhythm !== false){
    const windowed = windowedPhaseCounts(S.phasePlayCountsByDay, Date.now(), RHYTHM_WINDOW_DAYS);
    const total = Object.values(windowed).reduce((a,b) => a+b, 0);
    if(total >= RHYTHM_MIN_PLAYS){
      const label = rhythmVerdictLabel(computeRhythmShares(windowed).shares);
      ctx.font = '600 22px "IBM Plex Mono", monospace';
      const chipW = ctx.measureText(label).width + 44;
      shareChip(ctx, kit, label, Math.round((w - chipW) / 2), markY, false);
      markY += 46 + Math.round(h*0.03);
    }
  }

  ctx.textAlign = 'center';
  drawShareWordmark(ctx, w/2, Math.min(markY, bottomY), Math.round(w*0.034), kit.ink, kit.accent);
  ctx.textAlign = 'left';

  return canvas;
}
