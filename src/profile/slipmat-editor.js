/* ================= Settings › Appearance › Slipmat (CEREMONY §6) =========
   The Slipmat row (Felt or Custom) and its editor: pick an image (file
   picker or drop), crop it to a circle with drag and zoom, choose the
   Miziki wordmark and "Dim for legibility", then Save or Cancel. Remove
   goes back to the felt. Storage and the platter itself are
   src/ui/slipmat.js; nothing here is uploaded anywhere. Built with el()/
   textContent like every other screen. */
import { S } from '../state.js';
import { el } from '../util/dom.js';
import { queueSave } from '../storage/meta.js';
import { storeSwitch } from './storefront.js';
import {
  slipmatCrop, isSlipmatFile, loadSlipmatImage, imageSize, renderSlipmatBlob,
  applySlipmat, getSlipmatImage, saveSlipmatImage, removeSlipmatImage, SLIPMAT_MAX_ZOOM,
} from '../ui/slipmat.js';

const PREVIEW_PX = 220;
let tileURL = null;

function setChoice(custom, rerender){
  S.slipmatCustom = custom;
  queueSave();
  applySlipmat();
  rerender();
}

function feltFace(){
  const f = el('div', 'slipmat-felt');
  f.appendChild(el('span', null, 'MIZIKI'));
  return f;
}

// Renders the Slipmat row into `section`. `rerender` redraws the whole
// settings screen after a change.
export async function renderSlipmatRow(section, rerender){
  section.appendChild(el('div', 'settings-sub-head', 'Slipmat'));
  const tiles = el('div', 'slipmat-tiles');
  const editorHost = el('div', 'slipmat-editor-host');
  const saved = await getSlipmatImage();
  const custom = S.slipmatCustom && !!saved;

  const felt = el('button', 'slipmat-tile');
  felt.setAttribute('aria-pressed', String(!custom));
  felt.appendChild(feltFace());
  felt.appendChild(el('span', 'slipmat-tile-label', 'Felt'));
  felt.addEventListener('click', () => setChoice(false, rerender));

  const cust = el('button', 'slipmat-tile');
  cust.setAttribute('aria-pressed', String(custom));
  const face = el('div', 'slipmat-custom-face');
  if(tileURL){ URL.revokeObjectURL(tileURL); tileURL = null; }
  if(saved){
    tileURL = URL.createObjectURL(saved);
    const thumb = el('div', 'slipmat-thumb');
    thumb.style.backgroundImage = 'url("' + tileURL + '")';
    face.appendChild(thumb);
  } else {
    face.appendChild(el('span', 'slipmat-plus', '+'));
  }
  cust.appendChild(face);
  cust.appendChild(el('span', 'slipmat-tile-label', 'Custom'));
  cust.setAttribute('aria-label', saved ? 'Custom slipmat' : 'Add a custom slipmat');
  cust.addEventListener('click', () => {
    if(saved) setChoice(true, rerender);
    else openPicker(editorHost, rerender);
  });

  tiles.appendChild(felt); tiles.appendChild(cust);
  section.appendChild(tiles);

  if(saved){
    const actions = el('div', 'stack slipmat-actions');
    const edit = el('button', 'cta ghost', 'Edit');
    edit.addEventListener('click', async () => {
      try{ await openAdjust(editorHost, saved, rerender); }
      catch(_e){ openPicker(editorHost, rerender); }
    });
    const remove = el('button', 'cta ghost', 'Remove');
    remove.addEventListener('click', async () => {
      await removeSlipmatImage();
      setChoice(false, rerender);
    });
    actions.appendChild(edit); actions.appendChild(remove);
    section.appendChild(actions);
  }
  section.appendChild(el('p', 'note',
    'Felt with the Miziki wordmark is the default. Add your own image or logo. It stays on this device.'));
  section.appendChild(editorHost);
}

function openPicker(host, rerender){
  host.textContent = '';
  const box = el('div', 'slipmat-editor');
  box.appendChild(el('div', 'slipmat-editor-title', 'Choose an image'));
  const drop = el('div', 'slipmat-drop');
  drop.appendChild(el('span', 'note', 'Drop an image here'));
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
  input.hidden = true;
  const choose = el('button', 'cta', 'Choose from this device');
  choose.addEventListener('click', () => input.click());
  drop.appendChild(choose);
  drop.appendChild(input);
  box.appendChild(drop);
  const err = el('p', 'note slipmat-error');
  box.appendChild(err);
  box.appendChild(el('p', 'note',
    'PNG, JPG, WebP or SVG. A transparent logo works well. Resized to 1024 px and kept only on this device.'));
  const cancel = el('button', 'cta ghost', 'Cancel');
  cancel.addEventListener('click', () => { host.textContent = ''; });
  box.appendChild(cancel);
  host.appendChild(box);

  const take = async file => {
    if(!isSlipmatFile(file)){ err.textContent = 'That file isn’t a PNG, JPG, WebP or SVG image.'; return; }
    try{ await openAdjust(host, file, rerender); }
    catch(_e){ err.textContent = 'That image couldn’t be read. Try another one.'; }
  };
  input.addEventListener('change', () => { if(input.files && input.files[0]) take(input.files[0]); });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) take(f);
  });
}

// the crop step; rejects (before touching `host`) if the image won't decode
async function openAdjust(host, blob, rerender){
  const { img, url } = await loadSlipmatImage(blob);
  const { w, h } = imageSize(img);
  let zoom = 1;
  let crop = slipmatCrop(w, h, zoom, w / 2, h / 2);
  let wordmark = S.slipmatWordmark, dim = S.slipmatDim;

  host.textContent = '';
  const box = el('div', 'slipmat-editor');
  const preview = el('div', 'slipmat-preview');
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(PREVIEW_PX * dpr);
  preview.appendChild(canvas);
  const mark = el('span', 'slipmat-mark', 'MIZIKI');
  preview.appendChild(mark);
  preview.setAttribute('role', 'img');
  preview.setAttribute('aria-label', 'Slipmat preview. Drag to position.');
  box.appendChild(preview);

  const draw = () => {
    const cx = canvas.getContext('2d');
    cx.clearRect(0, 0, canvas.width, canvas.height);
    cx.drawImage(img, crop.sx, crop.sy, crop.side, crop.side, 0, 0, canvas.width, canvas.height);
    preview.classList.toggle('slipmat-dim', dim);
    mark.hidden = !wordmark;
  };

  // drag moves the image under the circle, so the crop centre moves the
  // other way, scaled from preview pixels to source pixels
  let drag = null;
  preview.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, cx: crop.cx, cy: crop.cy };
    try{ preview.setPointerCapture(e.pointerId); }catch(_e){}
  });
  preview.addEventListener('pointermove', e => {
    if(!drag) return;
    const k = crop.side / PREVIEW_PX;
    crop = slipmatCrop(w, h, zoom, drag.cx - (e.clientX - drag.x) * k, drag.cy - (e.clientY - drag.y) * k);
    draw();
  });
  const end = () => { drag = null; };
  preview.addEventListener('pointerup', end);
  preview.addEventListener('pointercancel', end);

  const zoomRow = el('label', 'slipmat-zoom');
  zoomRow.appendChild(el('span', 'slipmat-zoom-label', 'Zoom'));
  const range = document.createElement('input');
  range.type = 'range'; range.min = '1'; range.max = String(SLIPMAT_MAX_ZOOM); range.step = '0.01'; range.value = '1';
  range.setAttribute('aria-label', 'Zoom');
  range.addEventListener('input', () => {
    zoom = parseFloat(range.value);
    crop = slipmatCrop(w, h, zoom, crop.cx, crop.cy);
    draw();
  });
  zoomRow.appendChild(range);
  box.appendChild(zoomRow);

  const switchRow = (label, on, set) => {
    const row = el('div', 'social-setting-row');
    row.appendChild(el('h2', null, label));
    row.appendChild(storeSwitch(label, on, v => { set(v); draw(); }, row));
    box.appendChild(row);
  };
  switchRow('Show Miziki wordmark', wordmark, v => { wordmark = v; });
  switchRow('Dim for legibility', dim, v => { dim = v; });

  const err = el('p', 'note slipmat-error');
  const actions = el('div', 'stack slipmat-actions');
  const cancel = el('button', 'cta ghost', 'Cancel');
  const done = () => { URL.revokeObjectURL(url); host.textContent = ''; };
  cancel.addEventListener('click', done);
  const save = el('button', 'cta', 'Save slipmat');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try{
      const out = await renderSlipmatBlob(img, crop);
      await saveSlipmatImage(out);
      S.slipmatWordmark = wordmark; S.slipmatDim = dim;
      done();
      setChoice(true, rerender);
    }catch(_e){
      save.disabled = false;
      err.textContent = 'The slipmat couldn’t be saved on this device.';
    }
  });
  actions.appendChild(cancel); actions.appendChild(save);
  box.appendChild(actions);
  box.appendChild(err);
  host.appendChild(box);
  draw();
}
