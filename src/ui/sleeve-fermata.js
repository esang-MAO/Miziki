/* BD14b (docs/38_BEFORE_THE_DOMAIN.md): the fermata as placed on a sleeve
   (data/sleeve-fermata.svg) -- higher and smaller than the app icon's own
   drawing (data/fermata-icon.svg) to leave room for a title sticker. Split
   into its own tiny module, same reason ui/wordmark.js is its own file:
   house-sleeve.js's pure functions (houseSleeveKind/plainSleeveKind) need
   to stay importable under plain Node (tests/unit/house-sleeve.test.js),
   and a top-level `?raw` SVG import is a Vite-only feature node:test can't
   resolve at all -- isolating it here keeps that one import out of
   house-sleeve.js's own module graph for a test that never calls either
   of these DOM-building functions. */
import sleeveFermataRaw from '../../data/sleeve-fermata.svg?raw';

let template = null;
function template_(){
  if(!template) template = new DOMParser().parseFromString(sleeveFermataRaw, 'image/svg+xml').documentElement;
  return template;
}

// the whole drawing, upright, fill as given in the file (black) -- the
// emboss/house kinds draw this directly and recolour it with CSS.
export function sleeveFermataEl(){
  return template_().cloneNode(true);
}

// just the <g transform=...> (arch + dot), fill stripped so the die-cut's
// own mask/edge drawing (house-sleeve.js) can set its own -- cloned fresh
// every call, an SVG node can only live in one place in the DOM at a time,
// same reason wordmark.js's wordmarkEl() clones its own template.
export function sleeveFermataGroupEl(){
  const g = template_().querySelector('g').cloneNode(true);
  g.removeAttribute('fill');
  return g;
}
