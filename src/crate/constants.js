/* ================= crate view: browse like a record-store bin (CRATE spec) =================
   A second library layout, beside the list. Albums (not songs) laid out in
   the same vertical flip-through geometry as the launch (flowPose(), shared
   — see CRATE spec §3), one record centred, neighbours tilting away above
   and below. Everything here derives from S.tracks; nothing new is stored
   except the three prefs in applyPrefs()/saveMeta(). */
// was 170, then 98, then 26, then 74, then 45. CR1 (docs/13_CRATE.md) moved
// it back down to 110 so the stack has headroom to recede above the front
// record within the taller 420px bin (--crate-stage-h, src/styles/10-crate.
// css) without clipping it entirely by a=4 the way the 45px origin inside
// the old 316px stage did — see CRATE_DEPTH_SPREAD's own comment for the
// other half of this.
export const CRATE_ORIGIN_Y = 110;
export const CRATE_PALETTE = ['#B8452F','#6E8F5C','#4C5FA0','#C9A24A','#8E5C8F','#3F8C8A','#A8A29A'];
// CR1: "CRATE_VISIBLE_A so that six record tops show above the front
// record." flowPose()'s own opacity/scale/z formulas (shared with the
// launch intro, never touched here) already fade a record's opacity to
// zero by a=7 regardless of this constant — what CRATE_VISIBLE_A actually
// controls is how many index-steps away from the centre stay pooled in the
// DOM at all, so it only needs to cover the depth flowPose still draws
// something nonzero for. 9 (was 8) keeps a one-step safety margin past
// that a=7 cutoff for the fractional positions mid-scroll.
export const CRATE_VISIBLE_A = 9;
// CR1's own "adjust flowPose()'s opts.spread for the extra depth rather
// than changing the pose math" instruction — flowPose()'s per-step offset
// was tuned for the old 316px stage; multiplying it down by this factor
// (combined with the taller stage and CRATE_ORIGIN_Y's own move above)
// is what makes a=1..6's offset land fully inside a 420px stage (so six
// now-receding record tops are visible, each a little dimmer than the
// last, down to a mere sliver by a=6) instead of the old geometry's a=4
// already sitting entirely above the stage's own top edge and vanishing
// outright. Crate-only: launch/intro.js's own flowPose() call never reads
// this constant, so the launch sequence is untouched (CLAUDE.md's "Keep,
// whatever else changes" rule).
export const CRATE_DEPTH_SPREAD = 0.8;
export const CRATE_DPR = window.devicePixelRatio || 1;
export const CRATE_ALPHABET = ['#'].concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
