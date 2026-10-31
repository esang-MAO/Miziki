/* ================= crate view: browse like a record-store bin (CRATE spec) =================
   A second library layout, beside the list. Albums (not songs) laid out in
   the same vertical flip-through geometry as the launch (flowPose(), shared
   — see CRATE spec §3), one record centred, neighbours tilting away above
   and below. Everything here derives from S.tracks; nothing new is stored
   except the three prefs in applyPrefs()/saveMeta(). */
// Gives the stack headroom to recede above the front record within the
// stage (--crate-stage-h, src/styles/10-crate.css -- a nominal 420px
// fallback, but applyCrateMiniInset() usually sizes it shorter than that
// in practice, to whatever's actually left after the header/info-panel/
// mini-player/tabbar chrome above and below it). See CRATE_DEPTH_SPREAD's
// comment for the other half of this.
// Ken, 2026-10-31: on a real phone (mini-player visible, safe areas, the
// usual header rows) that leftover stage height routinely lands well
// under the ~368px the front record's own card needs below this origin
// to clear .crate-stage's own overflow:hidden at the bottom -- the front
// cover itself was getting clipped, not just a receding neighbour.
// Lowered from 110 so the whole stack (every card moves by the same
// amount, since this is additive in flowPose()) sits higher, trading
// blank headroom above the stack -- there was plenty to spare -- for
// clearance below the front record where it actually matters.
export const CRATE_ORIGIN_Y = 15;
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
