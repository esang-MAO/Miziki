// Zoetrope strobe animation — the pure motion math (docs/PRESSINGS_110.md
// §5, "How it animates (strobe model)"). Called from player/clock.js's
// render loop once an album has an earned zoetrope on the platter
// (S.zoetropeUnlocked, record-art/looks.js/tiers.js).
//
// Zero imports, no DOM, no S — a leaf module, same posture as audio/loudness.js/
// sundown/rhythm.js, safe to import directly in a test.
//
// The spec splits the disc into two layers: the frame ring (the band of figures,
// this module's whole job) and everything else (label/grooves/body, which keeps
// spinning smoothly at platter speed exactly as it already does — nothing here
// touches that layer). The ring's own rotation is the real, continuous disc angle
// (the same one everything else uses) *quantized* down to the nearest frame-slot
// boundary, which is what makes every figure in the ring appear to animate in
// place rather than merely spin: at nominal speed, the angle crosses one slot
// boundary at exactly nominalRps * frameCount times per second — the spec's own
// named "strobe rate" (33⅓: 0.556 rps × 12 = 6.7 ticks/s · 45: 0.75 rps × 16 =
// 12 ticks/s) falls out of this quantization as a derived property, not a
// separately-scheduled timer.

// Below this fraction of nominal speed, stop quantizing — the ring spins
// continuously with the rest of the disc and the figures' motion stills.
export const ZOETROPE_STILL_THRESHOLD = 0.7;

// The angular width of one frame slot, in degrees.
export function frameSlotDeg(frameCount){
  return 360 / frameCount;
}

// The strobe tick rate for a given nominal platter speed (rps) and frame count —
// how many frame-slot boundaries the ring crosses per second at full speed.
export function strobeTickHz(nominalRps, frameCount){
  return nominalRps * frameCount;
}

// Quantize a continuously-advancing disc angle (degrees, unbounded — the same
// cumulative value the real disc's own smooth rotation already uses) down to
// the nearest frame-slot boundary at or before it.
export function quantizeRingAngleDeg(realAngleDeg, frameCount){
  const slot = frameSlotDeg(frameCount);
  return Math.floor(realAngleDeg / slot) * slot;
}

// Whether the ring should still be snapping to frame slots at all, or has
// dropped below the spec's ~70% threshold and should spin continuously.
export function shouldQuantize(actualRps, nominalRps){
  if(!(nominalRps > 0)) return false;
  return (actualRps / nominalRps) >= ZOETROPE_STILL_THRESHOLD;
}

// The one entry point: given the disc's real, continuous angle and the current
// playback state, the angle the frame-ring layer should actually render at.
//
// - Pure mode: sundown/solar.js's computeRate() always returns exactly 1 in
//   Pure, so the platter never slows there — zoetropes always animate at full
//   strobe rate, continuous quantization, never drifting into a stutter.
// - Reduced motion: no stepping at all, in either mode — a plain continuous
//   spin, same as everything else on the disc.
// - Vinyl, at or above the still threshold: quantized, producing the strobe
//   illusion (full strength at nominal speed, drifting/stuttering as actual
//   speed falls toward the threshold, since fewer slot boundaries are crossed
//   per second than the nominal strobe rate calls for).
// - Vinyl, below the still threshold: continuous — the animation stills.
export function zoetropeRingAngleDeg({ realAngleDeg, frameCount, actualRps, nominalRps, mode, reducedMotion }){
  if(mode === 'pure' || reducedMotion) return realAngleDeg;
  if(!shouldQuantize(actualRps, nominalRps)) return realAngleDeg;
  return quantizeRingAngleDeg(realAngleDeg, frameCount);
}
