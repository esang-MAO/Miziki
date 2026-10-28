/* ================= share image =================
   Composed off-screen, not a screenshot of the tab — this has to work as a
   standalone object for people who don't have the app. Pure function,
   independent of the view layer (see PROFILE spec §6, §8): takes options,
   returns a canvas, touches nothing else. Front is a record sleeve: the #1
   album's art as the jacket, wordmark fallback when there is none. Stats
   read like a back-cover track listing. */
/* ---- style x format system (Part 2 §2). Styles (Night/Cover/Paper)
   resolve to a small "kit" — a background painter plus ink/sub/accent
   colours and chip styling — and formats resolve to pixel dimensions and a
   safe-zone band, kept in one table each rather than per-card magic
   numbers. Composers below take it from there. ---- */

// SH3 (docs/18_SHARE.md): the two constant colour tables fillShareDisc()
// needs below — METAL_COLORS (metal-tier gradients) and getVariantDef
// (the id-to-pattern-def lookup, already falling back to 'jet' for an
// unrecognized/missing id). Neither module touches the DOM at its own
// top level (just `S`/`$` imports that don't execute on load), so this
// doesn't cost styles.js the "safe to import directly in Node, no
// mocking" property tests/unit/share.test.js's own SHARE_FORMATS/
// resolveShareStyle tests rely on — only the two card composers that
// actually resolve a track's look (now-playing-card.js, via
// record-art/looks.js's own resolveLook()) still need the rest of
// tiers.js/metals.js's own machinery.
import { getVariantDef } from '../record-art/tiers.js';
import { METAL_COLORS } from '../record-art/metals.js';

export const SHARE_BG = ['#1D2F38', '#101A20', '#07080C'];

export const SHARE_FORMATS = {
  story:    {w:1080, h:1920, safeTop:250, safeBottom:1670},
  portrait: {w:1080, h:1350, safeTop:90,  safeBottom:1270},
  square:   {w:1080, h:1080, safeTop:70,  safeBottom:1010}
};

export function shareFitText(ctx, text, maxWidth){
  if(ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while(s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

// measures and shrinks text to fit maxWidth across at most maxLines,
// wrapping on spaces, stepping the font size down before ever truncating
export function shareFitLines(ctx, text, maxWidth, maxLines, baseSize, weight, family){
  const wrap = size => {
    ctx.font = weight + ' ' + size + 'px ' + family;
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = []; let line = '';
    for(const word of words){
      const test = line ? line + ' ' + word : word;
      if(line && ctx.measureText(test).width > maxWidth){ lines.push(line); line = word; }
      else line = test;
    }
    if(line) lines.push(line);
    return lines;
  };
  for(let size = baseSize; size >= Math.round(baseSize*0.55); size -= 2){
    const lines = wrap(size);
    if(lines.length <= maxLines) return { lines, fontSize: size };
  }
  const size = Math.round(baseSize*0.55);
  const lines = wrap(size).slice(0, maxLines);
  if(lines.length) lines[lines.length-1] = shareFitText(ctx, lines[lines.length-1], maxWidth);
  return { lines, fontSize: size };
}

export function shareSwatchGradient(ctx, cx, cy, r, colors){
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, colors[0]); g.addColorStop(0.6, colors[1]); g.addColorStop(1, colors[2]);
  return g;
}

// waits for decode() too, not just the load event, so the first draw never
// races a not-yet-decoded frame (spec §2 implementation notes)
export function loadImageEl(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { if(img.decode) img.decode().then(() => resolve(img), () => resolve(img)); else resolve(img); };
    img.onerror = reject;
    img.src = src;
  });
}

// whole-pixel positions, and a step-halving downscale for large source art
// so it never samples a single too-sharp blit — never upscales past source
export function drawCover(ctx, img, x, y, w, h){
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const scale = Math.min(1, Math.max(w / img.width, h / img.height));
  const sw = Math.min(img.width, w / scale), sh = Math.min(img.height, h / scale);
  const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
  let src = img, srcW = img.width, srcH = img.height, cropX = sx, cropY = sy, cropW = sw, cropH = sh;
  while(cropW * scale < cropW / 2 && cropW > w * 2 && cropH > h * 2){
    const half = document.createElement('canvas');
    half.width = Math.max(1, Math.round(srcW/2)); half.height = Math.max(1, Math.round(srcH/2));
    half.getContext('2d').drawImage(src, 0, 0, half.width, half.height);
    const ratio = half.width / srcW;
    cropX *= ratio; cropY *= ratio; cropW *= ratio; cropH *= ratio;
    src = half; srcW = half.width; srcH = half.height;
  }
  ctx.drawImage(src, cropX, cropY, cropW, cropH, x, y, w, h);
}

// SH3 (docs/18_SHARE.md): moved here from now-playing-card.js so the
// Record card can reuse it too — fills the full disc circle with
// whatever look is resolved for a track, same precedence
// applyDiscVariant() uses on the real platter, so a share image never
// falls back to a generic disc. `info` is `{art, look, variant, metal}`,
// already resolved by the caller (now-playing-card.js reads a live
// track; record-card.js's own `data` already carries all four
// pre-resolved by the gatefold) — this function itself does no
// track/album lookups of its own, which is what keeps it safe to import
// at this module's own top level (see the file-header comment above).
// `half` is true for the normal composition, where only the left
// semicircle ends up visible once the art square is drawn on top:
// asymmetric patterns need to orient themselves so both their colors
// land in that visible half instead of reading as one flat color (see
// LIBRARY spec §2, disc rendering).
export async function fillShareDisc(ctx, info, cx, cy, r, half){
  const { art, look, variant, metal } = info;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.closePath(); ctx.clip();
  ctx.fillStyle = '#15161B'; ctx.fillRect(cx - r, cy - r, r*2, r*2);
  if(look === 'rare'){
    try{
      const img = await loadImageEl(art);
      drawCover(ctx, img, cx - r, cy - r, r*2, r*2);
      const dark = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      dark.addColorStop(0, 'rgba(0,0,0,.12)'); dark.addColorStop(0.88, 'rgba(0,0,0,.55)'); dark.addColorStop(1, 'rgba(0,0,0,.78)');
      ctx.fillStyle = dark; ctx.fillRect(cx - r, cy - r, r*2, r*2);
    }catch(_e){}
  } else if(look === 'metal'){
    const base = ((METAL_COLORS[metal] || METAL_COLORS.bronze)).mid;
    const colors = [hexMix(base, '#ffffff', 0.45), base, hexMix(base, '#000000', 0.5)];
    ctx.fillStyle = shareSwatchGradient(ctx, cx, cy, r, colors);
    ctx.fillRect(cx - r, cy - r, r*2, r*2);
  } else {
    const def = getVariantDef(variant);
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
      const limg = await loadImageEl(art);
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, lr, 0, Math.PI*2); ctx.clip();
      drawCover(ctx, limg, cx - lr, cy - lr, lr*2, lr*2);
      ctx.restore();
    }catch(_e){}
  }
}

export function roundRectPath(ctx, x, y, w, h, r){
  if(ctx.roundRect){ ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

// the masthead wordmark, "zi" in the accent colour like the app header
export function drawShareWordmark(ctx, centerX, baselineY, fontPx, ink, accent){
  ctx.save();
  ctx.font = '700 ' + Math.round(fontPx) + 'px Antonio, sans-serif';
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const parts = [['Mi', ink], ['zi', accent], ['ki', ink]];
  const total = parts.reduce((s,[txt]) => s + ctx.measureText(txt).width, 0);
  let x = centerX - total/2;
  parts.forEach(([txt, col]) => { ctx.fillStyle = col; ctx.fillText(txt, x, baselineY); x += ctx.measureText(txt).width; });
  ctx.restore();
}

// measured width of the "Miziki" wordmark at a given size — callers use
// this to center/right-align drawShareWordmark() before drawing it
export function wordmarkWidth(ctx, fontPx){
  ctx.save();
  ctx.font = '700 ' + Math.round(fontPx) + 'px Antonio, sans-serif';
  const total = ['Mi', 'zi', 'ki'].reduce((s, txt) => s + ctx.measureText(txt).width, 0);
  ctx.restore();
  return total;
}

// a tiny, cached static-noise tile for Paper's grain — generated once,
// tiled via a canvas pattern rather than redrawn per pixel
let shareGrainCanvasCache = null;
export function shareGrainTile(){
  if(shareGrainCanvasCache) return shareGrainCanvasCache;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const cx = c.getContext('2d');
  const img = cx.createImageData(size, size);
  for(let i = 0; i < img.data.length; i += 4){
    const v = 180 + Math.floor(Math.random()*50);
    img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v;
    img.data[i+3] = Math.random() < 0.5 ? 12 : 5;
  }
  cx.putImageData(img, 0, 0);
  shareGrainCanvasCache = c;
  return c;
}

// downsamples art to ~32px and buckets by hue, picking the most saturated
// mid-luminance bucket — returns null (greyscale/missing art) when nothing
// qualifies, which the caller treats as "fall back to Night" (spec §2)
export function shareDominantColor(img){
  try{
    const size = 32;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0, size, size);
    const data = cx.getImageData(0, 0, size, size).data;
    const buckets = {};
    for(let i = 0; i < data.length; i += 4){
      const r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
      const max = Math.max(r,g,b), min = Math.min(r,g,b), l = (max+min)/2, d = max-min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2*l - 1));
      // only exclude true greys/near-black/near-white — a dark but saturated
      // colour (low l, high s) must still qualify, or legitimately dark art
      // would wrongly fall back to Night instead of a darkened Cover card
      if(s < 0.14 || l < 0.025 || l > 0.975) continue;
      let h = 0;
      if(d !== 0){
        if(max === r) h = ((g-b)/d) % 6;
        else if(max === g) h = (b-r)/d + 2;
        else h = (r-g)/d + 4;
        h = Math.round(h*60); if(h < 0) h += 360;
      }
      const key = Math.floor(h/24)*24;
      const bucket = buckets[key] || (buckets[key] = {h:0, s:0, l:0, n:0, score:0});
      const score = s * (1 - Math.abs(l - 0.5)*1.3);
      bucket.h += h; bucket.s += s; bucket.l += l; bucket.n++; bucket.score += score;
    }
    let best = null;
    Object.values(buckets).forEach(b => { if(!best || b.score > best.score) best = b; });
    if(!best || best.n < 4) return null;
    return { h: best.h/best.n, s: Math.min(1, best.s/best.n), l: Math.min(0.82, Math.max(0.12, best.l/best.n)) };
  }catch(_e){ return null; }
}
export function hslStr(h, s, l){ return 'hsl(' + h.toFixed(0) + ',' + Math.round(s*100) + '%,' + Math.round(l*100) + '%)'; }

// resolves a style name (+ optional art URL for Cover) into the kit every
// card draws with: a background painter and a consistent ink/sub/accent/
// chip palette, so cards never hand-roll per-style colours inline
export async function resolveShareStyle(style, artURL){
  if(style === 'cover' && artURL){
    try{
      const img = await loadImageEl(artURL);
      const dom = shareDominantColor(img);
      if(dom){
        // the top stop tracks the art's own lightness (darkened art stays
        // dark, bright art stays bright) so ink contrast has something real
        // to react to; the bottom stop always darkens toward the footer
        const topL = Math.min(0.74, Math.max(0.2, dom.l));
        const botL = Math.max(0.05, topL - 0.3);
        const bgTop = hslStr(dom.h, Math.min(0.6, dom.s + 0.05), topL);
        const bgBot = hslStr(dom.h, Math.min(0.5, dom.s), botL);
        const accent = hslStr(dom.h, Math.min(0.8, dom.s+0.2), Math.min(0.74, topL+0.18));
        // contrast is read against the top stop, since it's lighter/closer
        // to the WCAG-binding case than the always-dark bottom (spec §2)
        const useDark = topL > 0.52;
        return {
          name:'cover', ink: useDark ? '#171310' : '#EFE9DF',
          sub: useDark ? 'rgba(23,19,16,.66)' : 'rgba(239,233,223,.66)', accent,
          chipBorder: useDark ? 'rgba(23,19,16,.4)' : 'rgba(239,233,223,.4)',
          chipBg: useDark ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.08)',
          paintBg(ctx, w, h){
            const g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, bgTop); g.addColorStop(1, bgBot);
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
          }
        };
      }
    }catch(_e){ /* falls through to Night below */ }
  }
  if(style === 'paper'){
    return {
      name:'paper', ink:'#1C1816', sub:'rgba(28,24,22,.62)', accent:'#9A4B17',
      chipBorder:'rgba(28,24,22,.35)', chipBg:'rgba(28,24,22,.07)',
      paintBg(ctx, w, h){
        ctx.fillStyle = '#EDE6D6'; ctx.fillRect(0, 0, w, h);
        const pat = ctx.createPattern(shareGrainTile(), 'repeat');
        ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); ctx.restore();
      }
    };
  }
  return {
    name:'night', ink:'#EFE9DF', sub:'#94A0A6', accent:'#FF9E2C',
    chipBorder:'rgba(239,233,223,.32)', chipBg:'rgba(255,255,255,.05)',
    paintBg(ctx, w, h){
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, SHARE_BG[0]); g.addColorStop(0.55, SHARE_BG[1]); g.addColorStop(1, SHARE_BG[2]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
  };
}

// one spec chip, e.g. "FLAC · 44.1 kHz · 16-bit" or "VINYL" — `filled`
// renders it solid in the accent colour (used for the mode chip)
export function shareChip(ctx, kit, text, x, y, filled){
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  const padX = 22, h = 46;
  const w = ctx.measureText(text).width + padX*2;
  if(filled){
    roundRectPath(ctx, x, y, w, h, h/2);
    ctx.fillStyle = kit.accent; ctx.fill();
    ctx.fillStyle = kit.name === 'paper' ? '#EDE6D6' : '#171310';
  } else {
    roundRectPath(ctx, x, y, w, h, h/2);
    ctx.strokeStyle = kit.chipBorder; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = kit.ink;
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w/2, y + h/2 + 1);
  ctx.textBaseline = 'alphabetic';
  return w;
}

// SH2 (docs/18_SHARE.md): the chip row's own layout math, pulled out of
// composePlayerShareImage into a pure, directly-testable function — same
// font/padding shareChip() itself draws with, so a decision made here
// about what fits never disagrees with what actually gets drawn.
export const CHIP_FONT = '600 22px "IBM Plex Mono", monospace';
export const CHIP_HEIGHT = 46;
export const CHIP_PAD_X = 22;
export const CHIP_GAP = 16;
export const CHIP_ROW_GAP = 16;

// Wraps `chips` ({text, filled}) into left-to-right rows that each fit
// within maxW. Each row's items carry `x` as an offset from 0 (the row's
// own center) — the caller adds its real center-x when drawing. Three
// chips (SH2 item 3's own test case) wrap to two rows once their combined
// width — measured with shareChip()'s own font/padding — exceeds maxW.
// Returns {rows, height}: rows is an array of arrays of
// {text, filled, width, x}, height the total stacked height including
// CHIP_ROW_GAP between rows (0 for an empty chip list).
export function layoutChips(ctx, chips, maxW){
  ctx.save();
  ctx.font = CHIP_FONT;
  const widths = chips.map(c => Math.round(ctx.measureText(c.text).width) + CHIP_PAD_X*2);
  ctx.restore();
  const rawRows = [];
  let row = [], rowW = 0;
  chips.forEach((c, i) => {
    const w = widths[i];
    const nextW = row.length ? rowW + CHIP_GAP + w : w;
    if(row.length && nextW > maxW){ rawRows.push(row); row = []; rowW = 0; }
    row.push({ text: c.text, filled: c.filled, width: w });
    rowW = row.length === 1 ? w : rowW + CHIP_GAP + w;
  });
  if(row.length) rawRows.push(row);
  const rows = rawRows.map(r => {
    const totalW = r.reduce((s, c) => s + c.width, 0) + CHIP_GAP * (r.length - 1);
    let x = -totalW / 2;
    return r.map(c => { const item = { ...c, x }; x += c.width + CHIP_GAP; return item; });
  });
  const height = rows.length ? rows.length * CHIP_HEIGHT + (rows.length - 1) * CHIP_ROW_GAP : 0;
  return { rows, height };
}

// Small color-math/fallback-jacket helpers used by both card composers
// (composeShareImage and composePlayerShareImage) — kept here with the
// rest of the shared style primitives rather than duplicated, or homed
// arbitrarily in just one of the two card modules. Each sat physically
// between the two composer functions in the pre-step-6d main.js, with no
// sub-header of its own, since neither composer "owned" them outright.
export function hexMix(hex, target, amt){
  const c = parseInt(hex.slice(1), 16), t = parseInt(target.slice(1), 16);
  const mix = (shift) => Math.round(((c>>shift & 255) * (1-amt)) + ((t>>shift & 255) * amt));
  return 'rgb(' + mix(16) + ',' + mix(8) + ',' + mix(0) + ')';
}

// Black square with "Miziki" written diagonally across it — the fallback
// jacket when a track has no art at all (see LIBRARY spec §2)
export function drawDiagonalWordmark(ctx, x, y, side){
  ctx.save();
  ctx.fillStyle = '#0B0C0F'; ctx.fillRect(x, y, side, side);
  ctx.beginPath(); ctx.rect(x, y, side, side); ctx.clip();
  ctx.translate(x + side/2, y + side/2);
  ctx.rotate(-Math.PI/8);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 ' + Math.round(side*0.16) + 'px Antonio, sans-serif';
  ctx.fillStyle = 'rgba(239,233,223,.5)';
  ctx.fillText('M I Z I K I', 0, 0);
  ctx.restore();
}
