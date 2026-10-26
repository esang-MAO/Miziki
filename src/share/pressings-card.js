/* SH4 (docs/18_SHARE.md): the Pressings card — a grid of unlocked
   pressings, shared from Profile › Records › Pressings. Stubbed here with
   the exact exported name SH4 will give a real body — see this doc's own
   SH4 entry for the final composition (grid of discs, family counts,
   "+ N more · newest first"). Until then this is a plain placeholder
   canvas so SH1's sheet/entry-point wiring has something real to render. */
import { SHARE_FORMATS, resolveShareStyle, drawShareWordmark } from './styles.js';

export async function composePressingsShareImage(opts){
  const { style, format, data } = opts || {};
  const dims = SHARE_FORMATS[format] || SHARE_FORMATS.story;
  const kit = await resolveShareStyle(style);
  const canvas = document.createElement('canvas');
  canvas.width = dims.w; canvas.height = dims.h;
  const ctx = canvas.getContext('2d');
  kit.paintBg(ctx, dims.w, dims.h);
  ctx.textAlign = 'center';
  ctx.fillStyle = kit.ink;
  ctx.font = '600 44px Antonio, sans-serif';
  const total = (data && data.total) || 0;
  ctx.fillText(total + ' of 110', dims.w/2, dims.h/2);
  drawShareWordmark(ctx, dims.w/2, dims.safeBottom, 40, kit.ink, kit.accent);
  return canvas;
}
