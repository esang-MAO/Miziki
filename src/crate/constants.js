/* ================= crate view: browse like a record-store bin (CRATE spec) =================
   A second library layout, beside the list. Albums (not songs) laid out in
   the same vertical flip-through geometry as the launch (flowPose(), shared
   — see CRATE spec §3), one record centred, neighbours tilting away above
   and below. Everything here derives from S.tracks; nothing new is stored
   except the three prefs in applyPrefs()/saveMeta(). */
// was 170, then 98, then 26, then 74 — now moved back up .3in
// (29px @ 96px/in) per feedback, to 45.
export const CRATE_ORIGIN_Y = 45;
export const CRATE_PALETTE = ['#B8452F','#6E8F5C','#4C5FA0','#C9A24A','#8E5C8F','#3F8C8A','#A8A29A'];
export const CRATE_VISIBLE_A = 8;
export const CRATE_DPR = window.devicePixelRatio || 1;
export const CRATE_ALPHABET = ['#'].concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
