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

// Builds one tick button per entry in `entries` ([{key,label,present}]),
// positioned along `rail`'s own already-laid-out height — the same
// "spread across whatever height the rail actually has right now" shape
// crate/view.js's updateRailUI() always used, just generalized so the
// class names and the jump/current-position callbacks are supplied by
// the caller instead of hardcoded to the crate's own CSS classes.
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
    tick.disabled = !e_.present;
    if(e_.present){
      if(isCurrent && isCurrent(e_)) tick.classList.add(currentClass);
      tick.addEventListener('pointerdown', ev => { ev.stopPropagation(); });
      tick.addEventListener('click', ev => { ev.stopPropagation(); if(onTap) onTap(e_); });
    }
    rail.appendChild(tick);
  });
}
