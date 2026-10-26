/* SH3 (docs/18_SHARE.md): the Record card — a record's own sleeve, pressing
   and rating, shared from the gatefold/record sheet. Stubbed here with the
   exact exported name SH3 will give a real body — see this doc's own SH3
   entry for the final composition (sleeve + emerging disc, pressing
   column, rating ticks, sleeve note, friends sticker). Until then this is
   a plain placeholder canvas so SH1's sheet/entry-point wiring has
   something real to render and the "Share record" row isn't dead. */
import { SHARE_FORMATS, resolveShareStyle, drawShareWordmark } from './styles.js';

export async function composeRecordShareImage(opts){
  const { style, format, data } = opts || {};
  const dims = SHARE_FORMATS[format] || SHARE_FORMATS.square;
  const kit = await resolveShareStyle(style);
  const canvas = document.createElement('canvas');
  canvas.width = dims.w; canvas.height = dims.h;
  const ctx = canvas.getContext('2d');
  kit.paintBg(ctx, dims.w, dims.h);
  ctx.textAlign = 'center';
  ctx.fillStyle = kit.ink;
  ctx.font = '600 44px Antonio, sans-serif';
  const title = (data && data.album) || 'Coming soon';
  ctx.fillText(title, dims.w/2, dims.h/2);
  drawShareWordmark(ctx, dims.w/2, dims.safeBottom, 40, kit.ink, kit.accent);
  return canvas;
}
