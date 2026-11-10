/* ================= letter rail (CR9, docs/13_CRATE.md) =================
   A small shared primitive extracted out of src/crate/view.js's own
   alphabet rail (CR1) so the rest of the library (Artists, Songs — CR9's
   "the crate rail reused") can show the same kind of tappable A–Z strip
   without duplicating the tick-building loop a second time.

   This module owns only the two cheap, pure-ish pieces that were
   genuinely the same code in both places: grouping an already-sorted
   list into letter buckets, and laying out/wiring one tick button per
   bucket along a rail element's own measured height. It deliberately
   does NOT own the crate's drag-to-scrub pointer handling (pointerdown/
   pointermove's momentum scrub, the amber bubble) — that's specific to
   the crate's 3D flow-stage and snapTo() easing, has nothing to do with
   tick building, and moving it here would risk the exact "no behavior
   change" regression CLAUDE.md's refactor rules warn against. crate/
   view.js keeps that part; it now calls buildRailTicks() below for the
   part that was actually shared. */
import { el } from '../util/dom.js';

// First letter of `label`, normalized the same way library/search.js
// already sorts (locale-aware elsewhere; here just A–Z vs "everything
// else" for a divider key) — anything that isn't a plain ASCII letter
// buckets under '#', same convention as crate/model.js's own dividers.
export function letterKeyFor(label){
  const ch = String(label || '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

// Walks an already-sorted `items` array and returns one entry per run of
// consecutive items that share a letter key — `labelFor(item)` extracts
// whatever field the caller is grouping by (a track's artist name, an
// artist's own name, …). Cheap (one pass, no DOM) — safe to call on the
// full list even when the actual rows render in idle-time chunks
// (library/view.js's own NV6 chunking).
export function buildLetterGroups(items, labelFor){
  const groups = [];
  let lastKey = null;
  items.forEach(item => {
    const key = letterKeyFor(labelFor(item));
    if(key !== lastKey){ groups.push({key, label: key, present: true}); lastKey = key; }
  });
  return groups;
}

const FULL_ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

// LB7 (docs/36A_LIBRARY_AND_LAUNCH.md decision 6): "the letter rail always
// shows A–Z and #" — today buildLetterGroups() above only ever returns the
// letters a given list actually has, so the rail's own letters move around
// between libraries (today F and G simply aren't there). This takes those
// present-only groups and spreads them across the full, fixed 27-entry
// alphabet, marking the gaps `present:false` rather than dropping them.
// Each entry also carries its own `jumpKey`: itself when present, or the
// nearest letter that *does* have entries otherwise — forward first (the
// next letter coming up), falling back to the nearest one behind it when
// nothing follows (a dim "Z" after the library's last real letter is "Y").
// A caller that passes these entries into buildRailTicks() below gets a
// dim tick that's still tappable, instead of doing nothing.
export function buildFullAlphabet(presentGroups){
  const present = new Set((presentGroups || []).map(g => g.key));
  const entries = FULL_ALPHABET.map(key => ({ key, label: key, present: present.has(key) }));
  entries.forEach((e_, i) => {
    if(e_.present){ e_.jumpKey = e_.key; return; }
    const fwd = entries.slice(i + 1).find(x => x.present);
    if(fwd){ e_.jumpKey = fwd.key; return; }
    const back = entries.slice(0, i).reverse().find(x => x.present);
    e_.jumpKey = back ? back.key : null;
  });
  return entries;
}

// Builds one tick button per entry in `entries` ([{key,label,present}]),
// positioned along `rail`'s own already-laid-out height — the same
// "spread across whatever height the rail actually has right now" shape
// crate/view.js's updateRailUI() always used, just generalized so the
// class names and the jump/current-position callbacks are supplied by
// the caller instead of hardcoded to the crate's own CSS classes.
//
// LB7: a dim (`present:false`) entry that also carries a `jumpKey` (see
// buildFullAlphabet() above) stays tappable rather than disabled — tapping
// it calls `onTap` the same as a present tick, and the caller resolves
// where to jump using `e_.jumpKey`. A caller whose own entries have no
// `jumpKey` on a dim one — crate/model.js's railEntries, which this same
// function still serves unchanged — keeps today's "disabled, no listener"
// shape exactly as it was.
export function buildRailTicks(rail, entries, opts){
  const {
    itemClass = 'letter-rail-item',
    dimClass = 'letter-rail-dim',
    currentClass = 'letter-rail-current',
    railHeightPad = 20,
    isCurrent,
    onTap,
  } = opts || {};
  rail.innerHTML = '';
  if(!entries.length) return;
  const h = Math.max(0, rail.getBoundingClientRect().height - railHeightPad);
  entries.forEach((e_, k) => {
    const t = entries.length > 1 ? k / (entries.length - 1) : 0;
    const tick = el('button', itemClass + (e_.present ? '' : ' ' + dimClass), e_.label);
    tick.style.top = (t * h) + 'px';
    const tappable = e_.present || e_.jumpKey != null;
    tick.disabled = !tappable;
    if(tappable){
      if(isCurrent && isCurrent(e_)) tick.classList.add(currentClass);
      tick.addEventListener('pointerdown', ev => { ev.stopPropagation(); });
      tick.addEventListener('click', ev => { ev.stopPropagation(); if(onTap) onTap(e_); });
    }
    rail.appendChild(tick);
  });
}
