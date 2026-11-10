// UN6 (docs/36_UNIFORMITY.md): one place for "turn cover art into a
// readable colour" math. shareDominantColor() moved here unchanged from
// src/share/styles.js (refactor rule 1: no behaviour change in the move)
// — share cards still get the same {h,s,l} bucket-sampling result they
// always did. artTint() and spineColor() are new: the gatefold's own
// cover-matched interior (UN6) and the shelf's record spines (UN15).

// waits for decode() too, not just the load event, so the first draw never
// races a not-yet-decoded frame (SH spec §2 implementation notes) — moved
// here from src/share/styles.js (unchanged) so UN6's gatefold tint lookup
// can use it without pulling in that whole module's own ui/wordmark.js
// import, which node:test can't statically resolve (see that file's
// header comment and tests/unit/share.test.js's mock.module() for why).
export function loadImageEl(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { if(img.decode) img.decode().then(() => resolve(img), () => resolve(img)); else resolve(img); };
    img.onerror = reject;
    img.src = src;
  });
}

// downsamples art to ~32px and buckets by hue, picking the most saturated
// mid-luminance bucket — returns null (greyscale/missing art) when nothing
// qualifies, which the caller treats as "fall back to Night" (SH spec §2)
export function shareDominantColor(img){
  try{
    const size = 32;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0, size, size);
    const data = cx.getImageData(0, 0, size, size).data;
    const buckets = {};
    for(let i = 0; i < data.length; i += 4){
      const r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
      const max = Math.max(r,g,b), min = Math.min(r,g,b), l = (max+min)/2, d = max-min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2*l - 1));
      // only exclude true greys/near-black/near-white — a dark but saturated
      // colour (low l, high s) must still qualify, or legitimately dark art
      // would wrongly fall back to Night instead of a darkened Cover card
      if(s < 0.14 || l < 0.025 || l > 0.975) continue;
      let h = 0;
      if(d !== 0){
        if(max === r) h = ((g-b)/d) % 6;
        else if(max === g) h = (b-r)/d + 2;
        else h = (r-g)/d + 4;
        h = Math.round(h*60); if(h < 0) h += 360;
      }
      const key = Math.floor(h/24)*24;
      const bucket = buckets[key] || (buckets[key] = {h:0, s:0, l:0, n:0, score:0});
      const score = s * (1 - Math.abs(l - 0.5)*1.3);
      bucket.h += h; bucket.s += s; bucket.l += l; bucket.n++; bucket.score += score;
    }
    let best = null;
    Object.values(buckets).forEach(b => { if(!best || b.score > best.score) best = b; });
    if(!best || best.n < 4) return null;
    return { h: best.h/best.n, s: Math.min(1, best.s/best.n), l: Math.min(0.82, Math.max(0.12, best.l/best.n)) };
  }catch(_e){ return null; }
}

// UN6: the gatefold's no-art/near-grey fallback — today's plum pair,
// unchanged, and the warm-black family (00-base.css's --disc-a/--disc-b)
// for a cover with no real colour to carry.
export const ART_TINT_FALLBACK_FROM = '#2A1B38';
export const ART_TINT_FALLBACK_TO = '#1C1226';
const DISC_A = '#242127', DISC_B = '#1C1A1F';

// near-grey cutoff matches shareDominantColor()'s own "true grey" bucket
// exclusion above, so the two functions agree on what counts as colour.
const GREY_SATURATION_FLOOR = 0.14;
const SATURATION_CAP = 0.55;
const TO_STEP_LIGHTNESS = 0.08;
const LIGHTNESS_STEP = 0.02;

const ON_DARK_FROM_FLOOR = 7;      // UN1's --on-dark text on --gf-tint-from
const MUTED_ON_DARK_FLOOR = 4.5;   // the 66%-alpha muted read on the same bg
const ON_DARK = '#EFE9DF';
const MUTED_ON_DARK_ALPHA = 0.66;

function hslToHex(h, s, l){
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2*l - 1)) * s;
  const x = c * (1 - Math.abs(((h/60) % 2) - 1));
  const m = l - c/2;
  let r=0, g=0, b=0;
  if(h < 60){ r=c; g=x; b=0; }
  else if(h < 120){ r=x; g=c; b=0; }
  else if(h < 180){ r=0; g=c; b=x; }
  else if(h < 240){ r=0; g=x; b=c; }
  else if(h < 300){ r=x; g=0; b=c; }
  else { r=c; g=0; b=x; }
  const toByte = v => Math.round((v + m) * 255);
  const toHex = v => v.toString(16).padStart(2, '0');
  return '#' + toHex(toByte(r)) + toHex(toByte(g)) + toHex(toByte(b));
}

function hexToRgb(hex){
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}

// standard WCAG relative luminance / contrast ratio — same formula
// tests/unit/theme.test.js's relLuminanceTY1/contrastRatioTY1 use.
function srgbToLinear(c){ const n = c/255; return n <= 0.03928 ? n/12.92 : Math.pow((n+0.055)/1.055, 2.4); }
function relLuminance(hex){
  const { r, g, b } = hexToRgb(hex);
  return 0.2126*srgbToLinear(r) + 0.7152*srgbToLinear(g) + 0.0722*srgbToLinear(b);
}
function contrastRatio(hexA, hexB){
  const l1 = relLuminance(hexA), l2 = relLuminance(hexB);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
// alpha-composites an rgba() foreground over a hex background — same
// compositing UN1's tests/unit/theme.test.js uses for --ring/--dot.
function compositeOverHex(r, g, b, a, bgHex){
  const bg = hexToRgb(bgHex);
  const mix = (fg, bgch) => Math.round(a*fg + (1-a)*bgch);
  const toHex = v => v.toString(16).padStart(2, '0');
  return '#' + toHex(mix(r, bg.r)) + toHex(mix(g, bg.g)) + toHex(mix(b, bg.b));
}

// keeps the cover's main hue, caps saturation, and pulls lightness down
// until --on-dark text clears 7:1 on `from` and the 66%-alpha muted read
// clears 4.5:1 — `to` is the same hue one step darker. A near-grey input
// (low saturation, including no input at all) gets the warm --disc-a/
// --disc-b pair instead of a muddy tint (UN6 point 1).
export function artTint(hsl){
  if(!hsl || hsl.s == null || hsl.s < GREY_SATURATION_FLOOR || hsl.h == null){
    return { from: DISC_A, to: DISC_B };
  }
  const h = hsl.h, s = Math.min(hsl.s, SATURATION_CAP);
  let l = 0.6;
  let from = hslToHex(h, s, l);
  while(l > 0){
    from = hslToHex(h, s, l);
    const onDarkOk = contrastRatio(ON_DARK, from) >= ON_DARK_FROM_FLOOR;
    const mutedComposite = compositeOverHex(239, 233, 223, MUTED_ON_DARK_ALPHA, from);
    const mutedOk = contrastRatio(mutedComposite, from) >= MUTED_ON_DARK_FLOOR;
    if(onDarkOk && mutedOk) break;
    l -= LIGHTNESS_STEP;
  }
  l = Math.max(l, 0);
  from = hslToHex(h, s, l);
  const to = hslToHex(h, s, Math.max(0, l - TO_STEP_LIGHTNESS));
  return { from, to };
}

// the cover's main colour, lightly normalised toward a legible mid-range
// (never near-black or near-white, same shelf-spine legibility this needs
// regardless of the cover's own extremes), never darker than the
// matching artTint()'s own `to` — UN15's shelf spines read as "the same
// colour, a little brighter" rather than vanishing into the tint behind
// them.
const SPINE_LIGHTNESS_MIN = 0.3, SPINE_LIGHTNESS_MAX = 0.7;
export function spineColor(hsl){
  if(!hsl || hsl.s == null || hsl.s < GREY_SATURATION_FLOOR || hsl.h == null) return DISC_A;
  const h = hsl.h, s = Math.min(hsl.s, SATURATION_CAP);
  const { to } = artTint(hsl);
  const toL = relLuminanceToApproxL(to);
  const normalizedL = Math.max(SPINE_LIGHTNESS_MIN, Math.min(SPINE_LIGHTNESS_MAX, hsl.l == null ? 0.5 : hsl.l));
  const l = Math.max(normalizedL, toL);
  return hslToHex(h, s, l);
}

// `to`'s own HSL lightness isn't tracked alongside its hex — cheap to
// recover via the same max/min-channel formula hslToHex() inverts, so
// spineColor()'s "never darker than to" bound compares lightness to
// lightness, not hex to hex.
function relLuminanceToApproxL(hex){
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r,g,b)/255, min = Math.min(r,g,b)/255;
  return (max + min) / 2;
}
