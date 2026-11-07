// docs/32_SHELF_AND_TURNTABLES.md, ST3: the five shelf finishes. Walnut and
// Oak ship with Miziki; Teak, Ash and Black ash need Deluxe (src/deluxe.js).
// Color values are ShelfUnit.dc.html's own finish table (F), duplicated here
// only for the swatch chip's own small preview gradient -- the real unit's
// wood comes from the --wood-* CSS custom properties 18-storefront.css
// keys off `[data-finish]` (src/profile/shelf-unit.js sets that attribute).
export const SHELF_FINISHES = [
  {id: 'walnut', label: 'Walnut', note: 'Deep and warm, with a dark grain. The default.', deluxe: false, base: '#5A3A24', hi: '#7C5838', line: 'rgba(28,14,6,.45)'},
  {id: 'oak', label: 'Oak', note: 'Honey-gold with an open, lively grain.', deluxe: false, base: '#B8894F', hi: '#D7AE73', line: 'rgba(96,60,24,.34)'},
  {id: 'teak', label: 'Teak', note: 'Mid-century orange-brown.', deluxe: true, base: '#8F5A2E', hi: '#B57A45', line: 'rgba(56,28,8,.40)'},
  {id: 'ash', label: 'Ash', note: 'Pale and light, with a fine straight grain.', deluxe: true, base: '#D8C6A4', hi: '#EEE2C8', line: 'rgba(130,104,70,.32)'},
  {id: 'black', label: 'Black ash', note: 'Stained near-black; the grain still shows through.', deluxe: true, base: '#2B2623', hi: '#3F3833', line: 'rgba(0,0,0,.50)'},
];

const BY_ID = Object.fromEntries(SHELF_FINISHES.map(f => [f.id, f]));

export function shelfFinishInfo(id){
  return BY_ID[id] || BY_ID.walnut;
}

// ST3 point 4: "if Deluxe is later turned off, a saved Deluxe finish falls
// back to Walnut on display (the saved value stays)" -- hasDeluxe() is
// passed in rather than imported, so the pure gating rule (what a given
// saved value + entitlement displays as) stays testable without pulling in
// deluxe.js's own S dependency.
export function displayShelfFinish(savedId, hasDeluxeNow){
  const info = shelfFinishInfo(savedId);
  return (info.deluxe && !hasDeluxeNow) ? 'walnut' : info.id;
}
