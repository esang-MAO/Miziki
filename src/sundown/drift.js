/* ================= day arc: character drift (DA2, docs/DAY_ARC.md) =================
   Pure, no DOM, no S import — same "testable without a browser" shape as
   solar.js/day.js themselves. driftOffsets(dayPos, intensity) takes the
   exact {phase, phaseProgress, nightness, rateProgress} shape dayPosition()
   (day.js, DA1) returns, plus S.charDrift's own value, and returns how far
   each of the four Character knobs should drift off the user's own midday
   baseline right now. effectiveChar() is the small additional convenience
   export that actually combines that with the user's slider value and
   clamps — engine.js's applyCharacter() is the one real caller, but the
   clamp-to-[0,1] step is also what the DA2 spec's own "no offset pushes an
   effective value outside 0-1" test needs a pure function to assert
   against directly, the same "a small decision function pulled out and
   exported for its own test" precedent as gatefoldSideSplits/
   skyGradientStops.

   Anchors, at Full intensity, from the doc's own table (Subtle is exactly
   half; Off is exactly zero) — the user's own Character sliders stay the
   midday baseline, these are added on top of them, never replacing them:
     Morning (peak ~1-2h after sunrise): soft -0.20, sat -0.10, comp -0.10, wow -0.05
     Midday: 0,0,0,0
     Golden hour: soft +0.08, sat +0.05, comp +0.03, wow 0
     Night: soft +0.20, sat +0.10, comp +0.10, wow +0.05

   Judgment call, since the doc's table names only these four points and
   the three phases dayPosition() can also return (dawn, afternoon,
   twilight) aren't in it at all: each of those three is read as the doc's
   own implied *transition* between its two neighboring anchors (dawn:
   Night -> Morning; afternoon: Midday -> Golden; twilight: Golden ->
   Night), smoothstep-blended across that phase's own phaseProgress — the
   same shape solar.js's easedProgress()/pace() already uses for Sundown's
   own dusk/dawn pacing, so a transition is held back then felt, not a
   straight ramp. Morning and Golden hour themselves are read as flat holds
   at their own anchor value for their whole phase (no further ramp inside
   Morning), and Midday is flat zero for its whole phase — not a single
   instant, the full phase. This makes "peak ~1-2h after sunrise" true in
   the ordinary sense a listener would notice it (the drift finishes
   rising at sunrise, the end of Dawn, and sits at its most "morning" the
   whole time Morning is current, which covers that 1-2h window and the
   rest of the ~3h span alongside it) without inventing a second ramp
   inside Morning that the doc's own table never asked for, and it keeps
   every phase boundary exactly continuous: a flat hold's own edge value is
   always identical to the smoothstep ramp's 0 or 1 endpoint next to it. */
import { clamp } from '../util/math.js';

// {soft, sat, comp, wow} at Full intensity, one per named anchor phase.
const ANCHORS = {
  morning: { soft: -0.20, sat: -0.10, comp: -0.10, wow: -0.05 },
  midday:  { soft: 0,     sat: 0,     comp: 0,     wow: 0     },
  golden:  { soft: 0.08,  sat: 0.05,  comp: 0.03,  wow: 0     },
  night:   { soft: 0.20,  sat: 0.10,  comp: 0.10,  wow: 0.05  },
};

const INTENSITY_SCALE = { off: 0, subtle: 0.5, full: 1 };

const smooth = p => p*p*(3 - 2*p);
const lerp = (a, b, p) => a + (b - a) * p;
const blend = (a, b, p) => {
  const t = smooth(clamp(p, 0, 1));
  return { soft: lerp(a.soft, b.soft, t), sat: lerp(a.sat, b.sat, t), comp: lerp(a.comp, b.comp, t), wow: lerp(a.wow, b.wow, t) };
};

// Full-intensity, un-scaled offsets for the given day position — the one
// place the four-anchor/three-transition shape above lives.
//
// 'morning' is the one phase that itself has to do two jobs, not one: the
// doc's own table gives Night/Golden/Twilight each exactly one neighboring
// "flat" phase to butt up against and one "ramp" phase to cross from the
// opposite direction (dawn, afternoon, twilight each ramp between two of
// the four named anchors) — but Morning sits between Dawn (which already
// ramps night -> morning, reaching the peak exactly at sunrise) and
// Midday (flat at zero), with no third ramp phase of its own to spend on
// the way down. Held flat at the peak through the first half of the
// phase (sunrise to ~1.5h after — the middle of the doc's own "peak
// ~1-2h after sunrise" window) and ramped down to Midday across the
// second half closes that gap exactly where it would otherwise jump: the
// morning/midday boundary, the only internal boundary none of dawn/
// afternoon/twilight's own ramps already cover.
function anchorOffsets(dayPos){
  switch(dayPos.phase){
    case 'night': return ANCHORS.night;
    case 'dawn': return blend(ANCHORS.night, ANCHORS.morning, dayPos.phaseProgress);
    case 'morning': {
      const p = dayPos.phaseProgress;
      return p < 0.5 ? ANCHORS.morning : blend(ANCHORS.morning, ANCHORS.midday, (p - 0.5) / 0.5);
    }
    case 'midday': return ANCHORS.midday;
    case 'afternoon': return blend(ANCHORS.midday, ANCHORS.golden, dayPos.phaseProgress);
    case 'golden': return ANCHORS.golden;
    case 'twilight': return blend(ANCHORS.golden, ANCHORS.night, dayPos.phaseProgress);
    default: return ANCHORS.midday;
  }
}

// driftOffsets(dayPos, intensity) -> {wow, sat, soft, comp}, the doc's own
// required export. `intensity` is S.charDrift's own value ('off'/'subtle'/
// 'full'); an unrecognized value is treated as 'off' (zero), the same
// defensive-default shape every other enum-ish setting in this codebase
// takes rather than throwing.
export function driftOffsets(dayPos, intensity){
  const scale = INTENSITY_SCALE[intensity] || 0;
  if(scale === 0) return { wow: 0, sat: 0, soft: 0, comp: 0 };
  const a = anchorOffsets(dayPos);
  return { wow: a.wow * scale, sat: a.sat * scale, soft: a.soft * scale, comp: a.comp * scale };
}

// effectiveChar(userChar, dayPos, intensity) -> {wow, sat, soft, comp},
// each clamp(user + offset, 0, 1) — what engine.js's applyCharacter()
// actually feeds the audio nodes. userChar is a plain {wow,sat,soft,comp}
// object (S.char itself, or any object shaped like it); never mutated.
export function effectiveChar(userChar, dayPos, intensity){
  const o = driftOffsets(dayPos, intensity);
  return {
    wow: clamp(userChar.wow + o.wow, 0, 1),
    sat: clamp(userChar.sat + o.sat, 0, 1),
    soft: clamp(userChar.soft + o.soft, 0, 1),
    comp: clamp(userChar.comp + o.comp, 0, 1),
  };
}

// DA3 (docs/DAY_ARC.md) added driftSummaryText() here for the Day view's
// own "Character now: a touch warmer (Subtle)" shortcut row -- RF9
// (docs/12_REFINE.md) removed that row outright (the Day/Sound tabs are
// the one way into Sound now), and nothing else in the app ever called
// it, so it's gone rather than left as a dead export.
