/* ================= crate view: browse like a record-store bin (CRATE spec) =================
   A second library layout, beside the list. Albums (not songs) laid out in
   the same vertical flip-through geometry as the launch (flowPose(), shared
   — see CRATE spec §3), one record centred, neighbours tilting away above
   and below. Everything here derives from S.tracks; nothing new is stored
   except the three prefs in applyPrefs()/saveMeta(). */
// Gives the stack headroom to recede above the front record within the
// 420px bin (--crate-stage-h, src/styles/10-crate.css) without clipping it.
// See CRATE_DEPTH_SPREAD's comment for the other half of this.
export const CRATE_ORIGIN_Y = 110;
export const CRATE_PALETTE = ['#B8452F','#6E8F5C','#4C5FA0','#C9A24A','#8E5C8F','#3F8C8A','#A8A29A'];
// flowPose()'s own opacity/scale/z formulas (shared with the launch intro,
// never touched here) fade a record's opacity to zero by a=7 regardless of
// this constant — what CRATE_VISIBLE_A controls is how many index-steps
// away from the centre stay pooled in the DOM at all, so it only needs to
// cover the depth flowPose still draws something nonzero for. 9 keeps a
// one-step safety margin past that a=7 cutoff for fractional positions
// mid-scroll.
export const CRATE_VISIBLE_A = 9;
// flowPose()'s per-step offset was tuned for a shorter stage; this factor
// (combined with CRATE_ORIGIN_Y above) scales that offset down so six
// receding record tops land fully inside the 420px stage, each a little
// dimmer than the last. Crate-only: launch/intro.js's own flowPose() call
// never reads this constant, so the launch sequence is unaffected by
// anything tuned here.
export const CRATE_DEPTH_SPREAD = 0.8;
export const CRATE_DPR = window.devicePixelRatio || 1;
export const CRATE_ALPHABET = ['#'].concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
