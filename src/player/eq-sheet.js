/* AU6 (docs/16_AUDIO.md §3): the EQ sheet -- tilt + 10-band graphic EQ
   + up to 6-band parametric EQ, drawn from the true computed curve
   (BiquadFilterNode.getFrequencyResponse(), via audio/engine.js's
   computeEqCurveDb() -- never the raw slider positions, since
   neighboring graphic bands overlap and only the combined response is
   what's actually audible).

   openEqSheet()/closeEqSheet() follow sleep-timer.js's exact shape --
   openLayer/closeLayer from shell/nav-stack.js, a plain .edit-overlay
   sheet. renderEqSheet() is a full, structural rebuild (mode switch,
   preset tap, enable toggle, add/remove parametric band, band-type
   change); every slider's own 'input' handler instead calls the much
   lighter updateLiveValues(), which never touches the DOM structure --
   mutate S.eq, queueSave(), applyEQ(), update just that row's own
   value label and redraw the canvas. This is what keeps a mid-drag
   native <input type="range"> from losing its own pointer capture. */
import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { queueSave } from '../storage/meta.js';
import { openLayer } from '../shell/nav-stack.js';
import {
  applyEQ, computeEqCurveDb, auditionEqFlat, releaseEqAudition,
} from '../audio/engine.js';
import {
  GRAPHIC_BANDS_HZ, GRAPHIC_BAND_MAX_DB, TILT_MAX_DB, MAX_PARAMETRIC_BANDS,
  PARAMETRIC_BAND_MAX_DB, PARAMETRIC_TYPES, PARAMETRIC_GAIN_TYPES,
  PREAMP_MIN_DB, PREAMP_MAX_DB,
  EQ_PRESETS, EQ_PRESET_LABELS, EQ_PRESET_KEYS,
  clampTiltDb, clampGraphicBandDb, clampParametricGainDb, clampFreqHz, clampQForBand,
  clampPreampDb, sampleFrequenciesLog, matchPreset, defaultEqState,
} from '../audio/eq.js';

const PARAMETRIC_TYPE_LABELS = {
  peak: 'Peak', lowshelf: 'Low shelf', highshelf: 'High shelf',
  lowcut: 'Low cut', highcut: 'High cut',
};
const CURVE_FREQS = sampleFrequenciesLog(160);
let holdingFlat = false;

function ensureEq(){
  if(!S.eq) S.eq = defaultEqState();
  return S.eq;
}

function hz(f){ return f >= 1000 ? (f % 1000 === 0 ? (f/1000)+'k' : (f/1000).toFixed(1)+'k') : String(f); }
function fmtDb(db){ const v = Math.round(db * 10) / 10; return (v > 0 ? '+' : '') + v.toFixed(1); }

function currentStateLabel(eq){
  if(!eq.enabled) return 'OFF';
  if(eq.mode === 'parametric'){
    if(!eq.parametricBands || !eq.parametricBands.length) return 'FLAT · ON';
    return 'CUSTOM · ON';
  }
  const preset = matchPreset(eq.graphicBands, eq.tilt);
  return (preset ? EQ_PRESET_LABELS[preset] : 'CUSTOM') + ' · ON';
}
// exported for the Settings -> Playback row (profile/screens.js), which
// shows this same "CUSTOM · ON" text without needing its own copy of the
// matching logic.
export function eqStateLabel(){ return currentStateLabel(ensureEq()); }

function drawCurve(canvas){
  if(!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 280, h = canvas.clientHeight || 110;
  if(canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)){
    canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
  }
  const cx = canvas.getContext('2d');
  cx.save();
  cx.scale(dpr, dpr);
  cx.clearRect(0, 0, w, h);

  const style = getComputedStyle(canvas);
  const lineColor = style.color || '#E6B36B';
  const gridColor = style.getPropertyValue('--line') || 'rgba(255,255,255,.12)';

  cx.strokeStyle = gridColor; cx.lineWidth = 1;
  const zeroY = h/2;
  cx.beginPath(); cx.moveTo(0, zeroY); cx.lineTo(w, zeroY); cx.stroke();

  const eq = ensureEq();
  const curve = computeEqCurveDb(eq, CURVE_FREQS);
  const maxDb = 12;
  cx.strokeStyle = lineColor; cx.lineWidth = 2; cx.beginPath();
  curve.forEach((db, i) => {
    const x = (i / (curve.length - 1)) * w;
    const y = zeroY - (Math.max(-maxDb, Math.min(maxDb, db)) / maxDb) * (h/2 - 4);
    if(i === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
  });
  cx.stroke();
  cx.restore();
}

function updateCurveOnly(){
  const canvas = $('#eqCurveCanvas');
  if(canvas) drawCurve(canvas);
  const chip = $('#eqStateChip');
  if(chip) chip.textContent = currentStateLabel(ensureEq());
}

function sliderRow({ label, valueText, min, max, step, value, onInput }){
  const row = el('div','eq-slider-row');
  const head = el('div','eq-slider-head');
  head.appendChild(el('span','eq-slider-label', label));
  const valEl = el('span','eq-slider-value', valueText);
  head.appendChild(valEl);
  row.appendChild(head);
  const input = document.createElement('input');
  input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(value);
  input.className = 'eq-slider';
  input.addEventListener('input', () => { onInput(parseFloat(input.value), valEl); });
  row.appendChild(input);
  // PL8 items 2-3: lets a sibling slider's own onInput (gain capping a
  // boost's Q, or frequency capping a boost's gain) push a value onto
  // this slider without a full structural re-render -- which would drop
  // whichever <input> the user is actually mid-drag on, per this file's
  // own header comment on why live edits stay out of renderEqSheet().
  row.setValue = (v, text) => { input.value = String(v); valEl.textContent = text; };
  return row;
}

function renderGraphicBands(host, eq){
  const tiltRow = sliderRow({
    label: 'Tilt', valueText: fmtDb(eq.tilt) + ' dB',
    min: -TILT_MAX_DB, max: TILT_MAX_DB, step: 0.5, value: eq.tilt,
    onInput(v, valEl){
      eq.tilt = clampTiltDb(v); valEl.textContent = fmtDb(eq.tilt) + ' dB';
      queueSave(); applyEQ(); updateCurveOnly();
    },
  });
  host.appendChild(tiltRow);

  const bandsWrap = el('div','eq-graphic-bands');
  GRAPHIC_BANDS_HZ.forEach((f, i) => {
    const row = sliderRow({
      label: hz(f) + 'Hz', valueText: fmtDb(eq.graphicBands[i] || 0) + ' dB',
      min: -GRAPHIC_BAND_MAX_DB, max: GRAPHIC_BAND_MAX_DB, step: 0.5, value: eq.graphicBands[i] || 0,
      onInput(v, valEl){
        eq.graphicBands[i] = clampGraphicBandDb(v, f); valEl.textContent = fmtDb(eq.graphicBands[i]) + ' dB';
        queueSave(); applyEQ(); updateCurveOnly();
      },
    });
    row.classList.add('eq-graphic-band');
    bandsWrap.appendChild(row);
  });
  host.appendChild(bandsWrap);
}

function parametricBandRow(eq, index){
  const band = eq.parametricBands[index];
  const row = el('div','eq-param-band');

  const head = el('div','eq-param-head');
  const select = document.createElement('select');
  select.className = 'eq-param-type';
  PARAMETRIC_TYPES.forEach(type => {
    const opt = document.createElement('option');
    opt.value = type; opt.textContent = PARAMETRIC_TYPE_LABELS[type];
    if(type === band.type) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    band.type = select.value;
    if(!PARAMETRIC_GAIN_TYPES.includes(band.type)) band.gainDb = 0;
    queueSave(); applyEQ(); renderEqSheet();
  });
  head.appendChild(select);
  const removeBtn = el('button','eq-param-remove', '✕');
  removeBtn.setAttribute('aria-label','Remove band');
  removeBtn.addEventListener('click', () => {
    eq.parametricBands.splice(index, 1);
    queueSave(); applyEQ(); renderEqSheet();
  });
  head.appendChild(removeBtn);
  row.appendChild(head);

  // PL8 items 2-3: a boost's own gain caps lower near/above 10 kHz, and a
  // boost's own Q caps lower above +6 dB -- forward-declared so the Gain
  // and Frequency sliders' own onInput can reach across and re-cap each
  // other (via row.setValue(), never a structural re-render mid-drag).
  let gainRow = null, qRow = null;

  row.appendChild(sliderRow({
    label: 'Frequency', valueText: hz(Math.round(band.freq)) + 'Hz',
    min: 20, max: 20000, step: 1, value: band.freq,
    onInput(v, valEl){
      band.freq = clampFreqHz(v); valEl.textContent = hz(Math.round(band.freq)) + 'Hz';
      if(gainRow && PARAMETRIC_GAIN_TYPES.includes(band.type)){
        const cappedGain = clampParametricGainDb(band.gainDb, band.type, band.freq);
        if(cappedGain !== band.gainDb){
          band.gainDb = cappedGain;
          gainRow.setValue(band.gainDb, fmtDb(band.gainDb) + ' dB');
        }
      }
      queueSave(); applyEQ(); updateCurveOnly();
    },
  }));

  if(PARAMETRIC_GAIN_TYPES.includes(band.type)){
    gainRow = sliderRow({
      label: 'Gain', valueText: fmtDb(band.gainDb) + ' dB',
      min: -PARAMETRIC_BAND_MAX_DB, max: PARAMETRIC_BAND_MAX_DB, step: 0.5, value: band.gainDb,
      onInput(v, valEl){
        band.gainDb = clampParametricGainDb(v, band.type, band.freq);
        valEl.textContent = fmtDb(band.gainDb) + ' dB';
        if(qRow){
          const cappedQ = clampQForBand(band.q, band.gainDb, band.type);
          if(cappedQ !== band.q){
            band.q = cappedQ;
            qRow.setValue(band.q, band.q.toFixed(2));
          }
        }
        queueSave(); applyEQ(); updateCurveOnly();
      },
    });
    row.appendChild(gainRow);
  }

  qRow = sliderRow({
    label: 'Q', valueText: band.q.toFixed(2),
    min: 0.1, max: 18, step: 0.1, value: band.q,
    onInput(v, valEl){
      band.q = clampQForBand(v, band.gainDb, band.type); valEl.textContent = band.q.toFixed(2);
      queueSave(); applyEQ(); updateCurveOnly();
    },
  });
  row.appendChild(qRow);

  return row;
}

function renderParametricBands(host, eq){
  const list = el('div','eq-param-list');
  eq.parametricBands.forEach((_b, i) => list.appendChild(parametricBandRow(eq, i)));
  host.appendChild(list);

  const addBtn = el('button','cta ghost eq-add-band',
    '+ Add band · ' + eq.parametricBands.length + ' of ' + MAX_PARAMETRIC_BANDS);
  addBtn.disabled = eq.parametricBands.length >= MAX_PARAMETRIC_BANDS;
  addBtn.addEventListener('click', () => {
    if(eq.parametricBands.length >= MAX_PARAMETRIC_BANDS) return;
    eq.parametricBands.push({ type: 'peak', freq: 1000, q: 0.7, gainDb: 0 });
    queueSave(); applyEQ(); renderEqSheet();
  });
  host.appendChild(addBtn);
}

function renderPresets(host, eq){
  const row = el('div','eq-preset-row');
  EQ_PRESET_KEYS.forEach(key => {
    const preset = EQ_PRESETS[key];
    const active = eq.mode === 'graphic' && matchPreset(eq.graphicBands, eq.tilt) === key;
    const chip = el('button','eq-preset-chip' + (active ? ' active' : ''), EQ_PRESET_LABELS[key]);
    chip.setAttribute('aria-pressed', String(active));
    chip.addEventListener('click', () => {
      eq.mode = 'graphic';
      eq.tilt = preset.tilt;
      eq.graphicBands = preset.graphicBands.slice();
      queueSave(); applyEQ(); renderEqSheet();
    });
    row.appendChild(chip);
  });
  Object.keys(eq.savedPresets || {}).forEach(name => {
    const chip = el('button','eq-preset-chip eq-preset-chip-saved', name);
    chip.addEventListener('click', () => {
      const saved = eq.savedPresets[name];
      eq.mode = saved.mode || 'graphic';
      eq.tilt = saved.tilt || 0;
      eq.graphicBands = (saved.graphicBands || eq.graphicBands).slice();
      eq.parametricBands = (saved.parametricBands || []).map(b => Object.assign({}, b));
      queueSave(); applyEQ(); renderEqSheet();
    });
    row.appendChild(chip);
  });
  host.appendChild(row);
}

export function renderEqSheet(){
  const body = $('#eqSheetBody');
  if(!body) return;
  body.textContent = '';
  const eq = ensureEq();

  const head = el('div','eq-head-row');
  head.appendChild(el('div','eq-head-sub', 'Pure and Vinyl'));
  const switchBtn = el('button','eq-switch', eq.enabled ? 'ON' : 'OFF');
  switchBtn.setAttribute('role','switch');
  switchBtn.setAttribute('aria-checked', String(eq.enabled));
  switchBtn.addEventListener('click', () => {
    eq.enabled = !eq.enabled;
    queueSave(); applyEQ(); renderEqSheet();
  });
  head.appendChild(switchBtn);
  body.appendChild(head);

  const canvasWrap = el('div','eq-curve-wrap');
  const canvas = document.createElement('canvas');
  canvas.id = 'eqCurveCanvas'; canvas.className = 'eq-curve-canvas';
  canvasWrap.appendChild(canvas);
  body.appendChild(canvasWrap);

  const modeSeg = el('div','seg eq-mode-seg');
  ['graphic', 'parametric'].forEach(mode => {
    const b = el('button', null, mode === 'graphic' ? 'Graphic' : 'Parametric');
    b.dataset.mode = mode;
    b.setAttribute('aria-pressed', String(eq.mode === mode));
    b.addEventListener('click', () => {
      eq.mode = mode; queueSave(); applyEQ(); renderEqSheet();
    });
    modeSeg.appendChild(b);
  });
  body.appendChild(modeSeg);

  if(eq.mode === 'graphic'){
    renderPresets(body, eq);
    renderGraphicBands(body, eq);
  } else {
    renderParametricBands(body, eq);
  }

  const preampRow = el('div','eq-preamp-row');
  preampRow.appendChild(el('div','eq-slider-label', 'Preamp'));
  const autoBtn = el('button','eq-auto-btn' + (eq.autoPreamp !== false ? ' active' : ''),
    eq.autoPreamp !== false ? 'AUTO ✓' : 'AUTO');
  autoBtn.addEventListener('click', () => {
    eq.autoPreamp = !eq.autoPreamp;
    queueSave(); applyEQ(); renderEqSheet();
  });
  preampRow.appendChild(autoBtn);
  body.appendChild(preampRow);
  if(eq.autoPreamp === false){
    body.appendChild(sliderRow({
      label: 'Manual preamp', valueText: fmtDb(eq.preampDb) + ' dB',
      min: PREAMP_MIN_DB, max: PREAMP_MAX_DB, step: 0.5, value: eq.preampDb,
      onInput(v, valEl){
        // PL8 item 1: manual preamp is capped at 0 dB -- it can only ever
        // push the combined curve into the limiter above that.
        eq.preampDb = clampPreampDb(v); valEl.textContent = fmtDb(eq.preampDb) + ' dB';
        queueSave(); applyEQ(); updateCurveOnly();
      },
    }));
  }

  const bottomRow = el('div','eq-bottom-row');
  const holdBtn = el('button','cta ghost eq-hold-flat', 'Hold to hear flat');
  holdBtn.setAttribute('aria-pressed', 'false');
  const releaseHold = () => {
    if(!holdingFlat) return;
    holdingFlat = false;
    holdBtn.setAttribute('aria-pressed','false');
    releaseEqAudition();
  };
  holdBtn.addEventListener('pointerdown', () => {
    holdingFlat = true;
    holdBtn.setAttribute('aria-pressed','true');
    auditionEqFlat();
  });
  holdBtn.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('pointerup', releaseHold);
  window.addEventListener('pointercancel', releaseHold);
  bottomRow.appendChild(holdBtn);

  const saveBtn = el('button','cta ghost eq-save-preset', 'Save preset');
  saveBtn.addEventListener('click', () => {
    const name = window.prompt('Name this preset');
    if(!name || !name.trim()) return;
    const trimmed = name.trim().slice(0, 40);
    eq.savedPresets = eq.savedPresets || {};
    eq.savedPresets[trimmed] = {
      mode: eq.mode, tilt: eq.tilt,
      graphicBands: eq.graphicBands.slice(),
      parametricBands: eq.parametricBands.map(b => Object.assign({}, b)),
    };
    queueSave(); renderEqSheet();
  });
  bottomRow.appendChild(saveBtn);
  body.appendChild(bottomRow);

  const chip = el('span','eq-state-chip'); chip.id = 'eqStateChip';
  chip.textContent = currentStateLabel(eq);
  head.insertBefore(chip, switchBtn);

  drawCurve(canvas);
}

export function openEqSheet(){
  renderEqSheet();
  const overlay = $('#eqOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  openLayer('eq', closeEqSheet, { container: overlay });
}
export function closeEqSheet(){
  if(holdingFlat){ holdingFlat = false; releaseEqAudition(); }
  $('#eqOverlay').classList.remove('open');
  $('#eqOverlay').setAttribute('aria-hidden','true');
}
