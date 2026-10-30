/* TY6 (docs/22_TYPE.md): the crate's fixed bin-divider words, pre-drawn as
   outline SVGs (data/dividers/) rather than live Caveat, so a repeated
   letter never gives the font away. Parsed once and cloned per call site,
   same pattern as ui/wordmark.js's wordmarkEl() (an SVG element can only
   live in one place in the DOM at a time). Only the four bin keys below
   have art today; every other divider (letter/genre/decade/artist) keeps
   its live text label, since those words aren't fixed. */
import newArrivalsRaw from '../../data/dividers/new-arrivals.svg?raw';
import sealedRaw from '../../data/dividers/sealed.svg?raw';
import staffPicksRaw from '../../data/dividers/staff-picks.svg?raw';
import fortyFivesRaw from '../../data/dividers/45s.svg?raw';

const RAW_BY_BIN_KEY = {
  new: newArrivalsRaw,
  sealed: sealedRaw,
  picks: staffPicksRaw,
  '45s': fortyFivesRaw,
};

const templates = {};

export function dividerArtEl(binKey){
  const raw = RAW_BY_BIN_KEY[binKey];
  if(!raw) return null;
  if(!templates[binKey]){
    // DOMParser, not innerHTML -- CLAUDE.md's security rule bans assigning
    // innerHTML from anything but a string literal, and this is a
    // build-time asset, not a literal in this file either.
    templates[binKey] = new DOMParser().parseFromString(raw, 'image/svg+xml').documentElement;
  }
  return templates[binKey].cloneNode(true);
}
