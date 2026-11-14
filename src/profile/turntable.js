// docs/32_SHELF_AND_TURNTABLES.md, ST2 + ST4: the turntable on top of the
// shelf unit. ST2 shipped only Standard; ST4 adds the other ten (found
// by listening, src/history/achievements.js) plus the picker. BD8
// (docs/38_BEFORE_THE_DOMAIN.md) removed Suitcase, whose earning rule
// leaned on the held-for-you social feature this plan also removes --
// eleven models total now, not twelve. CSS only,
// drawn at a fixed 200×112 (design `Turntable.dc.html`), scaled by the
// shelf unit's own container. Every model's geometry below is that design
// file's own px values, converted to percentages of the 200×112 box.
// The `.lab` (center label) the design draws is its own element
// (`.tt-label`, 18-storefront.css), appended inside `rec` whenever a
// record's actually on the platter -- not folded into `rec`'s own
// background the way ST2 first shipped it, since that can't survive a
// real pressing color's own inline `background` (see renderTurntable()'s
// own comment at the `rec`/`uplab` branch below).
import { el } from '../util/dom.js';
import { RPM_33 } from '../record-art/format.js';

export const TURNTABLE_LINEUP = [
  {id: 'standard', label: 'Standard', note: 'The everyday deck.', deluxe: false},
  {id: 'console', label: 'Console', note: 'Wood plinth, silver trim, smoked lid up.', deluxe: true},
  {id: 'linear', label: 'Linear', note: 'A silver slab; the arm tracks straight across.', deluxe: true},
  {id: 'deck', label: 'Deck', note: 'Direct drive, strobe dots, a target light.', deluxe: false},
  {id: 'clear', label: 'Clear', note: 'Acrylic on cone feet, belt and motor in view.', deluxe: false},
  {id: 'broadcast', label: 'Broadcast', note: 'A heavy radio-station table, long arm.', deluxe: false},
  {id: 'upright', label: 'Upright', note: 'The record stands on edge, like a clock.', deluxe: false},
  {id: 'radiogram', label: 'Radiogram', note: 'A cabinet with a radio dial and a lid that lifts.', deluxe: false},
  {id: 'slate', label: 'Slate', note: 'Stone plinth, heavy platter, motor apart.', deluxe: false},
  {id: 'lathe', label: 'Lathe', note: 'A cutting lathe with its microscope. Rare.', deluxe: false},
  {id: 'horn', label: 'Horn', note: 'A wind-up gramophone, brass horn. Rare.', deluxe: false},
];
const BY_ID = Object.fromEntries(TURNTABLE_LINEUP.map(m => [m.id, m]));
export const TURNTABLE_IDS = TURNTABLE_LINEUP.map(m => m.id);

export function turntableInfo(id){
  return BY_ID[id] || BY_ID.standard;
}
export function turntableModelLabel(model){
  return turntableInfo(model).label;
}

// ST4 point 3: "Deluxe (hasDeluxe()): Console and Linear count as had
// without being in the found list. If they're also earned, they're
// recorded as found [too]." -- these two are reachable purely by paying
// for Deluxe, with no listening milestone required. Derived from the
// lineup's own `deluxe` flag rather than listed again by hand.
const DELUXE_COUNTS_AS_HAD = TURNTABLE_LINEUP.filter(m => m.deluxe).map(m => m.id);

// Every id this account currently has: whatever's in the found map, plus
// Console/Linear while Deluxe is on, regardless of whether they've also
// been separately earned. Standard is always in `found` (state.js's own
// default), so it never needs a special case here.
export function turntablesHad(found, hasDeluxeNow){
  const had = new Set(Object.keys(found || {}));
  if(hasDeluxeNow) DELUXE_COUNTS_AS_HAD.forEach(id => had.add(id));
  return had;
}

// The id a saved `S.turntable` should actually display/draw as: falls
// back to Standard the same way displayShelfFinish() does for a finish
// that's no longer available (Deluxe turned back off after Console/Linear
// was selected purely via the Deluxe carve-out, or a stale value from a
// build that had fewer models) -- the saved id itself is left untouched.
export function displayTurntable(savedId, found, hasDeluxeNow){
  return turntablesHad(found, hasDeluxeNow).has(savedId) ? savedId : 'standard';
}

// Per-model static parts (everything except the one spinning disc, which
// every model has exactly one of): `chrome` parts share the one `.tt-chrome`
// gradient (18-storefront.css) instead of repeating it per model. `rec`
// is the disc itself (Standard/most models); `uplab` is Upright's own
// smaller, upright-standing label circle, the one part of its drawing that
// reacts to hasRecord/art -- the big grooved disc behind it is static
// furniture, always drawn the same way.
const MODEL_PARTS = {
  standard: [{c:'s0'},{c:'s1'},{c:'s2'},{c:'s3'},{c:'s4',x:1},{c:'rec'},{c:'s7',x:1},{c:'s8'},{c:'s9'},{c:'s10'}],
  console: [{c:'s0'},{c:'s1'},{c:'s2'},{c:'s3',x:1},{c:'s4'},{c:'s5'},{c:'s6'},{c:'s7',x:1},{c:'rec'},{c:'s10',x:1},{c:'s11'},{c:'s12'}],
  deck: [{c:'s0'},{c:'s1'},{c:'s2'},{c:'s3'},{c:'s4'},{c:'s5'},{c:'s6'},{c:'rec'},{c:'s9'},{c:'s10'},{c:'s11'},{c:'s12'},{c:'s13'}],
  clear: [{c:'s0',x:1},{c:'s1',x:1},{c:'s2'},{c:'s3'},{c:'s4'},{c:'s5'},{c:'rec'},{c:'s8'},{c:'s9'},{c:'s10'}],
  broadcast: [{c:'s0'},{c:'s1'},{c:'s2'},{c:'s3'},{c:'s4'},{c:'s5',x:1},{c:'rec'},{c:'s8'},{c:'s9'},{c:'s10'},{c:'s11'}],
  horn: [{c:'s0'},{c:'s1'},{c:'s2'},{c:'s3'},{c:'s4'},{c:'s5'},{c:'s6'},{c:'rec'},{c:'s9'},{c:'s10'}],
  linear: [{c:'s0'},{c:'s1'},{c:'s2'},{c:'s3'},{c:'s4'},{c:'s5'},{c:'s6'},{c:'s7'},{c:'rec'},{c:'s10'},{c:'s11'},{c:'s12'},{c:'s13'},{c:'s14'}],
  upright: [{c:'s0'},{c:'s1'},{c:'s2'},{c:'s3'},{c:'uplab'},{c:'s5'},{c:'s6'},{c:'s7'}],
  slate: [{c:'s0',x:1},{c:'s1',x:1},{c:'s2'},{c:'s3'},{c:'rec'},{c:'s6'},{c:'s7'},{c:'s8'}],
  radiogram: [{c:'s0'},{c:'s1'},{c:'s2'},{c:'s3'},{c:'s4'},{c:'s5'},{c:'s6'},{c:'s7'},{c:'s8'},{c:'rec'},{c:'s11'}],
  lathe: [{c:'s0'},{c:'s1'},{c:'s2'},{c:'s3',x:1},{c:'rec'},{c:'s6'},{c:'s7'},{c:'s8'},{c:'s9'},{c:'s10'},{c:'s11'},{c:'s12'}],
};

// `hasRecord` draws the record on the platter; `discBg` is the album's
// own resolved pressing -- record-art/looks.js's discLook(t).bg, the same
// shared surface the full player's #disc, the gatefold's sleeve-pocket
// disc, and the gatefold-to-player hand-off ghost disc all already paint
// with, so a record's color/pattern/rare pressing/metal never differs
// here from what the library actually shows (storefront.js's
// shelfUnitTurntableInfo() resolves it; both sheets' own static previews
// pass null for a plain generic disc instead, same as before). `spinning`
// toggles the CSS animation (ST5, docs/32_SHELF_AND_TURNTABLES.md) that
// turns the `.tt-rec`/`.tt-rec-uplab` disc continuously while playing --
// paused, `.tt-paused` (18-storefront.css) keeps it stopped exactly where
// it is, the same "pause in place, not reset to 0deg" rule the main
// platter's own #disc transform already follows. `turnSeconds` is seconds
// per revolution (60 / rpm, already rate-adjusted by the caller); only
// meaningful while spinning, so a default covers every caller that never
// passes one.
export function renderTurntable(model, hasRecord, discBg, spinning, turnSeconds){
  const m = MODEL_PARTS[model] ? model : 'standard';
  const wrap = el('div', 'tt tt-' + m);
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.setProperty('--tt-turn-dur', (turnSeconds || 60 / RPM_33) + 's');
  if(!spinning) wrap.classList.add('tt-paused');

  MODEL_PARTS[m].forEach(part => {
    if(part.c === 'rec' || part.c === 'uplab'){
      const rec = el('span', 'tt-rec' + (part.c === 'uplab' ? ' tt-rec-uplab' : ''));
      if(hasRecord){
        if(discBg) rec.style.background = discBg;
        else rec.classList.add('tt-rec--blank');
        // the paper/center label (18-storefront.css's .tt-label/.tt-label-
        // mark) -- its own element, not part of `rec`'s background, so the
        // `discBg` assignment just above (a plain CSS property, always
        // winning over the stylesheet's rule) can never paint over it the
        // way it used to when the label was baked into .tt-rec--blank's
        // own background-image.
        const label = el('span', 'tt-label');
        label.appendChild(el('span', 'tt-label-mark'));
        rec.appendChild(label);
      } else {
        rec.classList.add('tt-rec--empty');
      }
      wrap.appendChild(rec);
    } else {
      wrap.appendChild(el('span', 'tt-p tt-' + part.c + (part.x ? ' tt-chrome' : '')));
    }
  });
  return wrap;
}
