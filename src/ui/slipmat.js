/* ================= custom slipmat (CEREMONY §6) =================
   The user's own image as the slipmat: on the empty platter in place of
   the felt, and as the ring around a playing record. The image stays on
   this device: one 1024px square in the existing `artwork` store under
   SLIPMAT_ART_ID (no DB version bump, the same prefixed-id shape crate
   tiers use), never in prefs, never in the backup doc, never in Download my
   data. Prefs hold only S.slipmatCustom and the two switches,
   S.slipmatWordmark/S.slipmatDim (src/storage/prefs.js), and all three are
   device-only, stripped from the uploaded prefs the same way theme is
   (src/sync/backup.js). One image serves both themes.

   A missing or undecodable image falls back to the felt silently:
   applySlipmat() only adds .slipmat-custom once the image has actually
   decoded. The editor UI lives in src/profile/slipmat-editor.js. */
import { S } from '../state.js';
import { $ } from '../util/dom.js';
import { artwork } from '../storage/repo.js';

export const SLIPMAT_ART_ID = 'slipmat:custom';
export const SLIPMAT_PX = 1024;
export const SLIPMAT_MAX_ZOOM = 4;

// The square of the source image a circular crop covers. `zoom` is 1 for
// the largest square that fits, up to SLIPMAT_MAX_ZOOM; (cx, cy) is the
// requested centre in source pixels, clamped so the square never leaves the
// image. Pure, so the drag/zoom maths is testable without a canvas.
export function slipmatCrop(w, h, zoom, cx, cy){
  const z = Math.min(SLIPMAT_MAX_ZOOM, Math.max(1, Number(zoom) || 1));
  const side = Math.min(w, h) / z;
  const half = side / 2;
  const x = Math.min(w - half, Math.max(half, Number.isFinite(cx) ? cx : w / 2));
  const y = Math.min(h - half, Math.max(half, Number.isFinite(cy) ? cy : h / 2));
  return { sx: x - half, sy: y - half, side, cx: x, cy: y };
}

// a file the picker or a drop handed over is one we can use: PNG, JPG,
// WebP or SVG, by type or (when a browser leaves the type empty) by name
export function isSlipmatFile(file){
  if(!file) return false;
  if(/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type || '')) return true;
  return !file.type && /\.(png|jpe?g|webp|svg)$/i.test(file.name || '');
}

// decodes a blob into an <img>; rejects on anything the browser can't read
export function loadSlipmatImage(blob){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read image')); };
    img.src = url;
  });
}

// an SVG with no intrinsic size reports 0x0; draw it as a square instead
export function imageSize(img){
  const w = img.naturalWidth || img.width || SLIPMAT_PX;
  const h = img.naturalHeight || img.height || SLIPMAT_PX;
  return { w, h };
}

// the stored copy: the cropped square at SLIPMAT_PX, PNG so a transparent
// logo keeps its transparency
export function renderSlipmatBlob(img, crop){
  return new Promise((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width = SLIPMAT_PX; c.height = SLIPMAT_PX;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, crop.sx, crop.sy, crop.side, crop.side, 0, 0, SLIPMAT_PX, SLIPMAT_PX);
    c.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), 'image/png');
  });
}

let slipmatURL = null;
let applyToken = 0;

function setFelt(stage, mat){
  stage.classList.remove('slipmat-custom');
  mat.style.backgroundImage = '';
  if(slipmatURL){ URL.revokeObjectURL(slipmatURL); slipmatURL = null; }
}

// Puts the saved choice on the platter. Safe to call any time (boot,
// after a save or remove, after prefs restore); a newer call supersedes an
// older one still loading.
export async function applySlipmat(){
  const token = ++applyToken;
  const stage = $('#platterStage'), mat = stage && stage.querySelector ? stage.querySelector('.slipmat-rest') : null;
  if(!stage || !mat || !stage.classList) return;
  mat.classList.toggle('slipmat-dim', !!S.slipmatDim);
  mat.classList.toggle('slipmat-no-wordmark', !S.slipmatWordmark);
  if(!S.slipmatCustom){ setFelt(stage, mat); return; }
  try{
    const rec = await artwork.get(SLIPMAT_ART_ID);
    if(token !== applyToken) return;
    if(!rec || !rec.blob){ setFelt(stage, mat); return; }
    const { url } = await loadSlipmatImage(rec.blob);
    if(token !== applyToken){ URL.revokeObjectURL(url); return; }
    if(slipmatURL) URL.revokeObjectURL(slipmatURL);
    slipmatURL = url;
    mat.style.backgroundImage = 'url("' + url + '")';
    stage.classList.add('slipmat-custom');
  }catch(_e){
    if(token === applyToken) setFelt(stage, mat);
  }
}

export async function hasSavedSlipmat(){
  try{ const rec = await artwork.get(SLIPMAT_ART_ID); return !!(rec && rec.blob); }
  catch(_e){ return false; }
}

export function saveSlipmatImage(blob){ return artwork.put({ id: SLIPMAT_ART_ID, blob }); }
export function removeSlipmatImage(){ return artwork.del(SLIPMAT_ART_ID); }
export async function getSlipmatImage(){
  try{ const rec = await artwork.get(SLIPMAT_ART_ID); return rec && rec.blob ? rec.blob : null; }
  catch(_e){ return null; }
}
