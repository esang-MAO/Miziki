/* ================= crate/launch shared geometry =================
   Moved out of main.js's "launch intro" section (step 7c), unchanged.
   The 3D pose for a card at fractional distance `d` from the current
   position (negative = above/earlier, positive = below/later). Shared by
   the launch overlay and the crate (see CRATE spec §3) — one geometry
   implementation so the two views can never drift apart. `opts.originY`
   is where the stack's centre sits (launch: baked into its own CSS `top`,
   so it passes 0 here; crate: 170px, passed explicitly since the crate
   card sits at `top:0` and reads its vertical position from `pose.y`). */
export function flowPose(a, d, speed, opts){
  opts = opts || {};
  const originY = opts.originY || 0, spread = opts.spread == null ? 1 : opts.spread;
  const dir = d < 0 ? -1 : (d > 0 ? 1 : 0);
  const nearFactor = 1 + 0.3*speed, farFactor = 1 + 0.9*speed;
  const baseOffset = a < 1 ? 170*a*nearFactor : 170*nearFactor + (a-1)*34*farFactor;
  const offset = baseOffset * dir * spread;
  const tiltMag = 62 * Math.min(a,1);
  const rotX = dir < 0 ? -tiltMag : tiltMag;
  const scale = 0.86 - 0.06*Math.min(a,1) - 0.02*Math.max(0, Math.min(a,8)-1);
  const z = -70*Math.min(a,1) - 6*Math.max(0, a-1);
  const opacity = a <= 3 ? 1 : Math.max(0, 1 - 0.25*(a-3));
  return { y: originY + offset, rotX, scale, z, opacity };
}
// stacking order for a card at |offset| `a` from the centre — nearest on top
export function flowZIndex(a){ return Math.round((9 - Math.min(a,9)) * 10); }
