// CC3 (docs/34_CARE_AND_CONTROL.md): the friends sticker itself -- the
// round badge ("3 friends" / "1 friend", friendsStickerText()'s own
// wording) shown on a record you don't own, and the small sheet it opens
// ("In [a], [b]'s crates" / "On [c]'s digging list"), each handle opening
// that friend's crate. Its own leaf so every caller (storefront.js,
// shelf-unit.js, friend-store.js, home.js) can share one badge/sheet
// without a new import cycle -- openFriendStore() is reached with a
// dynamic import, the same way home.js/storefront.js already reach it,
// since friend-store.js is the heavier screen that already imports
// storefront.js, not the other way round.
import { el } from '../util/dom.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';
import { friendsStickerText } from '../share/sticker-text.js';
import { isAfterSunset } from '../sundown/day.js';
import { currentDayPosition } from '../sundown/solar.js';

// CR3 (docs/25_FROM_SCRATCH.md) sticker palette: the existing round butter
// sticker, reusing .crate-sticker/.crate-sticker-friends (10-crate.css) --
// "one in, one out," no new CSS for the badge itself. `owners` is the raw
// count from friends_sticker()/friendsStickerCounts() -- 0/null/undefined
// all read as "nothing at 0" via friendsStickerText(), so this returns
// null outright rather than an empty/hidden element a caller could
// mistakenly still append.
// `inline`: a plain, non-absolute badge for a context with no cover-art
// box to anchor against (Fresh for you's text-only rows) -- same wording/
// background, just not .crate-sticker's own position:absolute corner
// placement.
// CC3's own preview note ("night ... shows them dimmed, consistent with
// GF11"): the same isAfterSunset() read GF11 (gatefold/view.js) already
// takes once at open time -- "less after dark" (CLAUDE.md), applied the
// same way everywhere this sticker can appear, not only inside the
// gatefold.
export function stickerBadge(releaseId, owners, {inline} = {}){
  const text = friendsStickerText(owners);
  if(!text) return null;
  const night = isAfterSunset(currentDayPosition().phase);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'crate-sticker crate-sticker-friends' + (inline ? ' crate-sticker-friends--inline' : '') + (night ? ' crate-sticker--night' : '');
  btn.textContent = text;
  btn.setAttribute('aria-label', text + ' have this');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    openFriendsStickerSheet(releaseId);
  });
  return btn;
}

function personRow(card, handle){
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'crate-hold-btn'; b.setAttribute('role', 'menuitem');
  b.textContent = '@' + handle;
  b.addEventListener('click', async () => {
    closeLayer('friends-sticker');
    const { openFriendStore } = await import('./screens/friend-store.js');
    openFriendStore(handle);
  });
  card.appendChild(b);
}

function groupLabel(verb, handles, noun){
  const names = handles.join(', ');
  return verb + ' ' + names + "’s " + (handles.length === 1 ? noun : noun + 's');
}

// Reuses crate/view.js's own "crate-hold" scrim+card action-sheet shape
// (crate-hold-scrim/-card/-title/-btn, 10-crate.css) -- a dynamically
// built overlay, not a static miziki.html sheet, since this is a small,
// read-only list that opens from several different screens. The extra
// `friends-sticker-sheet` class only raises the stacking context
// (10-crate.css): unlike crate/view.js's own menu, this one has to open
// from on top of the record sheet (#recordSheetOverlay, z-index:128) too,
// a context crate-hold-card's own z-index:60 was never meant to clear.
export async function openFriendsStickerSheet(releaseId){
  const scrim = el('div', 'crate-hold-scrim friends-sticker-sheet');
  const card = el('div', 'crate-hold-card friends-sticker-sheet');
  card.setAttribute('role', 'menu');
  card.appendChild(el('p', 'crate-hold-title', 'Loading…'));
  function teardown(){ scrim.remove(); card.remove(); }
  scrim.addEventListener('click', () => closeLayer('friends-sticker'));
  document.body.appendChild(scrim);
  document.body.appendChild(card);
  openLayer('friends-sticker', teardown, {container: [scrim, card]});

  const r = await MizikiSocial.friendsStickerDetail(releaseId);
  card.innerHTML = '';
  const people = (r.ok && r.people) || [];
  const owns = people.filter(p => p.kind === 'owns').map(p => p.handle);
  const wants = people.filter(p => p.kind === 'wants').map(p => p.handle);
  if(!owns.length && !wants.length){
    card.appendChild(el('p', 'crate-hold-title', 'Nothing to show.'));
    return;
  }
  if(owns.length){
    card.appendChild(el('p', 'crate-hold-title', groupLabel('In', owns, 'crate')));
    owns.forEach(h => personRow(card, h));
  }
  if(wants.length){
    card.appendChild(el('p', 'crate-hold-title', groupLabel('On', wants, 'digging list')));
    wants.forEach(h => personRow(card, h));
  }
}
