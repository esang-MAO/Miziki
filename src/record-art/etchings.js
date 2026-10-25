import { $ } from '../util/dom.js';
import { releaseSeed } from '../audio/surface-noise.js';
import { albumKey } from './tiers.js';

/* ================= dead-wax etchings (docs/15_SURFACE_NOISE.md §5) =================
   Tiny hand-scratched text in the run-out area, between the last groove and
   the label. Generated client-side from the release id, the same "seed per
   release" shape as the Surface Noise generators (releaseSeed, imported
   above) — every copy of an album shows the same etching, same as a real
   pressing. Visual only: no toggle, and not disabled by Pure mode (Pure
   only silences Surface Noise/needle-lift audio — see that file's own
   header). Shown via a <textPath> arc in the run-out band of #disc (see
   miziki.html), faded up by the existing .platter-stage.runout class (no
   change needed to shell/runout.js — see that module's header), and
   magnified via a long-press loupe (wired in player/scrub.js). */

// Same small deterministic-hash shape as surface-noise.js's rng()/releaseSeed,
// kept local rather than imported since this module needs a sequence of
// jitter values per glyph index, not a single seed-to-number mapping.
function hashSeed(seed, index){
  let h = (seed >>> 0) ^ ((index + 1) * 0x9E3779B1);
  h ^= h << 13; h >>>= 0;
  h ^= h >>> 17;
  h ^= h << 5; h >>>= 0;
  return h;
}

// A handful of hand-written marks/messages a release can be stamped with —
// deliberately plain, mirroring the spec's own examples. "Later" (not this
// build): artist-written etchings replacing this generated pick.
export const DEAD_WAX_MESSAGES = [
  'K.N.',
  'cut at night',
  'more bass please',
  '★',
  '≈ side two',
  'hello',
  'play loud',
  'no skips',
];

// The matrix number's own release-specific tail (e.g. "7F3A2") — shared by
// every side of the same release, since a real pressing's matrix prefix
// identifies the release, only the suffix letter/number identifies the side.
export function matrixTail(releaseId){
  const str = 'mx|' + String(releaseId || '');
  let h = 0;
  for(let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  // low-order hex digits, not high-order: a *31 rolling hash's top bits
  // barely move for a short, near-identical input (e.g. two release ids
  // differing in only their last character), while the low bits do.
  return (h || 1).toString(16).toUpperCase().padStart(5, '0').slice(-5);
}

// "MZK-7F3A2-A1"-style matrix line for one side. `side` is a bare letter
// ('A'/'B'/…) or '' when sides are off — '' falls back to '1' so there's
// always a side digit, the same single-side-release case runout.js/
// transport.js's own side-letter helpers already leave as ''.
export function matrixLineFor(releaseId, side){
  const letter = side || 'A';
  return 'MZK-' + matrixTail(releaseId) + '-' + letter + '1';
}

// Picks one of DEAD_WAX_MESSAGES deterministically per release+side, so a
// given side of a given release always shows the same mark.
export function messageFor(releaseId, side){
  const seed = releaseSeed(releaseId, side);
  return DEAD_WAX_MESSAGES[seed % DEAD_WAX_MESSAGES.length];
}

// The pair shown together for one side.
export function etchingFor(releaseId, side){
  return { matrix: matrixLineFor(releaseId, side), message: messageFor(releaseId, side) };
}

// Per-glyph "hand-scratched, not a perfect arc" jitter — a small vertical
// offset (dy, in SVG user units) and a slight rotation (deg), deterministic
// from the seed and the glyph's own index so the same string always jitters
// the same way.
export function glyphJitter(seed, index){
  const h1 = hashSeed(seed, index * 2);
  const h2 = hashSeed(seed, index * 2 + 1);
  const dy = ((h1 / 4294967296) - 0.5) * 1.6; // ±0.8 user units
  const rotate = ((h2 / 4294967296) - 0.5) * 9; // ±4.5deg
  return { dy, rotate };
}

// AU10 (docs/16_AUDIO.md §5): "the groove band ends at a radius set by how
// full the side is... short sides leave a wide band of smooth dead wax
// near the label, where the etchings already live." A full side's groove
// runs close to the label (a small radius for this arc); an empty/short
// side leaves a wide band, so the arc sits further out, nearer the disc's
// own edge. Plain units of the 200×200 #deadWax viewBox the path already
// uses (center 100,100) -- MAX_RADIUS kept well inside the groove area,
// MIN_RADIUS well outside the label.
const DEAD_WAX_MAX_RADIUS = 62; // fullness 0 (short side -- wide dead-wax band)
const DEAD_WAX_MIN_RADIUS = 38; // fullness 1 (full side -- narrow band, close to the groove's end)
export function deadWaxEtchRadius(fullness){
  const f = Math.max(0, Math.min(1, fullness == null ? 1 : fullness));
  return DEAD_WAX_MAX_RADIUS - f * (DEAD_WAX_MAX_RADIUS - DEAD_WAX_MIN_RADIUS);
}
export function deadWaxArcPath(radius){
  return 'M ' + (100 - radius) + ' 100 A ' + radius + ' ' + radius + ' 0 1 1 ' + (100 + radius) + ' 100';
}

const SVGNS = 'http://www.w3.org/2000/svg';

// Writes `str` into `textPathEl` as one <tspan> per character, each nudged
// by glyphJitter(seed, i) — never innerHTML (CLAUDE.md's tag-text rule
// applies to any generated text, not just file tags).
function writeEtchingGlyphs(textPathEl, str, seed){
  while(textPathEl.firstChild) textPathEl.removeChild(textPathEl.firstChild);
  for(let i = 0; i < str.length; i++){
    const { dy, rotate } = glyphJitter(seed, i);
    const tspan = document.createElementNS(SVGNS, 'tspan');
    tspan.setAttribute('dy', dy.toFixed(2));
    tspan.setAttribute('rotate', rotate.toFixed(1));
    tspan.textContent = str[i];
    textPathEl.appendChild(tspan);
  }
}

// Called from player/transport.js's load() right alongside the existing
// #labelTitle/#labelArcText writes. `t` may be null (nothing loaded, or the
// library just emptied) — clears both lines the same way those two do.
// `fullness` (AU10, docs/16_AUDIO.md §5) is this side's 0..1 fullness —
// see sideFullness() in record-art/format.js — and sets the arc's own
// radius; omitted (undefined) reads as fully used, the fixed radius this
// path always had before AU10.
export function applyDeadWaxEtching(t, side, fullness){
  const matrixEl = $('#deadWaxMatrixText');
  const messageEl = $('#deadWaxMessageText');
  const pathEl = $('#deadWaxPath');
  if(pathEl) pathEl.setAttribute('d', deadWaxArcPath(deadWaxEtchRadius(fullness)));
  if(!matrixEl || !messageEl) return;
  if(!t){
    writeEtchingGlyphs(matrixEl, '', 1);
    writeEtchingGlyphs(messageEl, '', 1);
    return;
  }
  const releaseId = albumKey(t);
  const { matrix, message } = etchingFor(releaseId, side);
  const seed = releaseSeed(releaseId, side);
  writeEtchingGlyphs(matrixEl, matrix, seed);
  writeEtchingGlyphs(messageEl, message, seed + 1);
}

// The long-press loupe (player/scrub.js's own long-press timer calls this
// on fire/release) — a plain class toggle, CSS (02-stage-platter.css) does
// the scale/opacity.
export function setDeadWaxMagnified(on){
  const el = $('#deadWax');
  if(el) el.classList.toggle('magnified', !!on);
}
