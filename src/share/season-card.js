/* SH6 (docs/18_SHARE.md): the Season card — the listening-rhythm verdict,
   shared from Profile home once the rhythm card is unlocked. Stubbed here
   with the exact exported name SH6 will give a real body — see this doc's
   own SH6 entry for the final composition (phase ring, legend, metals
   row). Until then this is a plain placeholder canvas so SH1's sheet/
   entry-point wiring has something real to render. */
import { SHARE_FORMATS, resolveShareStyle, drawShareWordmark } from './styles.js';

export async function composeSeasonShareImage(opts){
  const { style, format, data } = opts || {};
  const dims = SHARE_FORMATS[format] || SHARE_FORMATS.square;
  const kit = await resolveShareStyle(style);
  const canvas = document.createElement('canvas');
  canvas.width = dims.w; canvas.height = dims.h;
  const ctx = canvas.getContext('2d');
  kit.paintBg(ctx, dims.w, dims.h);
  ctx.textAlign = 'center';
  ctx.fillStyle = kit.ink;
  ctx.font = '600 40px Antonio, sans-serif';
  const verdict = (data && data.verdict) || 'This season';
  ctx.fillText(verdict, dims.w/2, dims.h/2);
  drawShareWordmark(ctx, dims.w/2, dims.safeBottom, 40, kit.ink, kit.accent);
  return canvas;
}
