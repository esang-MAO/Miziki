/* BD14b (docs/38_BEFORE_THE_DOMAIN.md): the four house sleeves a record
   with no artwork is drawn in -- replacing the single wordmark placeholder
   wherever it used to be the only no-art face. One kind per album
   (houseSleeveKind), picked the same deterministic way pressings are, so an
   album wears the same sleeve in the crate, the player and on every
   device. `buildHouseSleeve()` is the one place every caller (player
   sleeve, crate card, launch intro, empty crate, and the other no-art
   fronts below) builds the actual DOM from a kind. */
import { normKey } from '../util/text.js';
import { contrastRatio } from './art-color.js';
import { variantBackground } from '../record-art/tiers.js';
import { wordmarkEl } from './wordmark.js';
import { sleeveFermataEl, sleeveFermataGroupEl } from './sleeve-fermata.js';

const SVGNS = 'http://www.w3.org/2000/svg';

// Odds (BD14b): 3 wordmark, 3 emboss, 2 house, 2 diecut -- the dark two
// (wordmark, emboss) weighted 6 in 10 so an untagged crate reads mostly
// dark with ochre accents.
const SLOTS = [
  'wordmark','wordmark','wordmark',
  'emboss','emboss','emboss',
  'house','house',
  'diecut','diecut',
];

function hash32(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const OCHRE = '#C47F1E';
const DIECUT_CONTRAST_FLOOR = 1.5;

// one sleeve per album, drawn from artist+album the same way pressings
// are (record-art/tiers.js's pressingKey()) -- the 'sleeve|' salt keeps
// this draw independent of the pressing draw on the same album. Die-cut
// fallback: an ochre-family pressing (its body colour under
// DIECUT_CONTRAST_FLOOR against the sleeve's own ochre) would nearly
// vanish through the cut-out, so it draws `house` instead -- pass the
// album's resolved pressing def (tiers.js's getVariantDef()) as
// `pressingDef` to apply this; omit it (launch intro fillers, the empty
// crate -- neither stands for a real pressing) to skip the check.
export function houseSleeveKind(artist, album, pressingDef){
  const key = 'sleeve|' + normKey(artist) + '|' + normKey(album);
  const kind = SLOTS[hash32(key) % SLOTS.length];
  if(kind === 'diecut' && pressingDef && pressingDef.colors){
    const body = pressingDef.colors[1];
    if(contrastRatio(body, OCHRE) < DIECUT_CONTRAST_FLOOR) return 'house';
  }
  return kind;
}

// launch intro filler cards (no real album behind the slot) and the empty
// crate rotate through all four in this fixed order, rather than hashing
// on nothing.
const PLAIN_ORDER = ['wordmark', 'house', 'emboss', 'diecut'];
export function plainSleeveKind(i){
  return PLAIN_ORDER[((i % PLAIN_ORDER.length) + PLAIN_ORDER.length) % PLAIN_ORDER.length];
}

function buildArt(kind, pressingDef, format){
  const art = document.createElement('div');
  art.className = 'house-sleeve-art';
  if(kind === 'wordmark'){
    const mark = document.createElement('div');
    mark.className = 'house-sleeve-wordmark';
    mark.appendChild(wordmarkEl());
    art.appendChild(mark);
  } else if(kind === 'emboss' || kind === 'house'){
    const mark = document.createElement('div');
    mark.className = 'house-sleeve-fermata';
    mark.appendChild(sleeveFermataEl());
    art.appendChild(mark);
  } else if(kind === 'diecut'){
    const disc = document.createElement('div');
    disc.className = 'house-sleeve-diecut-disc';
    if(pressingDef) disc.style.background = variantBackground(pressingDef, format);
    art.appendChild(disc);
    art.appendChild(buildDiecutCover());
  }
  return art;
}

// The ochre cover with the whole fermata (arch + dot) cut out, via a real
// SVG mask rather than CSS mask-image -- a white rect minus the fermata's
// own black shape, same "subtract this shape" idea the plan's own wording
// allows either way, but an inline mask element needs no vendor-prefixed
// mask-composite for broad Safari support. Each instance gets its own
// mask id (several house sleeves can be on screen -- the crate pool, the
// player sleeve, a stack of launch cards -- and SVG ids are document-
// global, so a shared id would make every later instance's mask resolve
// to whichever one painted last). A faint stroke of the same shape, drawn
// on top with no fill, is BD14b's own "thin edge on the cut."
let diecutMaskCounter = 0;
function buildDiecutCover(){
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'house-sleeve-diecut-cover');
  svg.setAttribute('aria-hidden', 'true');
  const maskId = 'hsDiecutMask' + (diecutMaskCounter++);
  const defs = document.createElementNS(SVGNS, 'defs');
  const mask = document.createElementNS(SVGNS, 'mask');
  mask.setAttribute('id', maskId);
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  const bg = document.createElementNS(SVGNS, 'rect');
  bg.setAttribute('width', '100'); bg.setAttribute('height', '100'); bg.setAttribute('fill', '#fff');
  mask.appendChild(bg);
  const cutShape = sleeveFermataGroupEl();
  cutShape.setAttribute('fill', '#000');
  mask.appendChild(cutShape);
  defs.appendChild(mask);
  svg.appendChild(defs);
  const cover = document.createElementNS(SVGNS, 'rect');
  cover.setAttribute('width', '100'); cover.setAttribute('height', '100');
  cover.setAttribute('fill', OCHRE);
  cover.setAttribute('mask', 'url(#' + maskId + ')');
  svg.appendChild(cover);
  const edge = sleeveFermataGroupEl();
  edge.setAttribute('fill', 'none');
  edge.setAttribute('stroke', 'rgba(0,0,0,.35)');
  edge.setAttribute('stroke-width', '1.5');
  svg.appendChild(edge);
  return svg;
}

function buildSticker(title, artist){
  if(!title && !artist) return null;
  const sticker = document.createElement('div');
  sticker.className = 'house-sleeve-sticker';
  const t = document.createElement('div'); t.className = 'house-sleeve-sticker-title'; t.textContent = title || '';
  const a = document.createElement('div'); a.className = 'house-sleeve-sticker-artist'; a.textContent = artist || '';
  sticker.appendChild(t); sticker.appendChild(a);
  return sticker;
}

// Returns one element: the sleeve's art plus, unless `plain` is set, a
// hand-lettered title/artist sticker (BD14b point 3) -- real albums (the
// player sleeve, crate cards) get the sticker; the launch intro and the
// empty crate pass `plain:true` since neither stands for any one record.
// `pressingDef`/`format` only matter for `kind:'diecut'` (the record's own
// pressing shows through the cut-out) -- harmless to omit for every other kind.
export function buildHouseSleeve(kind, { title, artist, pressingDef, format, plain } = {}){
  const sleeve = document.createElement('div');
  sleeve.className = 'house-sleeve house-sleeve-' + kind;
  sleeve.appendChild(buildArt(kind, pressingDef, format));
  if(!plain){
    const sticker = buildSticker(title, artist);
    if(sticker) sleeve.appendChild(sticker);
  }
  return sleeve;
}
