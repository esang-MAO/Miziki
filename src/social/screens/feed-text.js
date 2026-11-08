/* TR2 (docs/19_PLAYER.md): feedEventText() was the one real circular
   import between social/screens/home.js and social/screens/friend-store.js
   (home.js imported openFriendStore from friend-store.js; friend-store.js
   imported feedEventText back, for the friend-store's own "recently at
   the counter" activity rows) -- a cycle that pinned both files into the
   same bundle chunk regardless of how any external call site imported
   them. Pulling this one pure, DOM-free function out breaks the cycle, so
   friend-store.js can move into its own lazy chunk (see home.js's and
   friend-store.js's own updated header comments). */
export function feedEventText(e){
  const title = e.title || 'a record';
  if(e.type === 'added'){
    const n = (e.payload && e.payload.count) || 1;
    return n > 1 ? ('added ' + n + ' records') : ('added ' + title);
  }
  if(e.type === 'pinned') return 'pinned ' + title + ' to in rotation';
  if(e.type === 'review'){
    const p = e.payload || {};
    if(p.rating) return 'rated ' + title + ' ' + '★'.repeat(p.rating);
    return 'wrote a sleeve note on ' + title;
  }
  if(e.type === 'unlock') return 'unlocked a ' + ((e.payload && e.payload.variant) || 'rare') + ' pressing of ' + title;
  return 'updated ' + title;
}

// CC1 (docs/34_CARE_AND_CONTROL.md): fresh_for_you (migration
// 015_fresh_from_pins_notes.sql) qualifies a record by pin_rank OR
// sleeve_note, but its return row never carries pin_rank itself -- only
// sleeve_note (text, null when there isn't one). That's enough to call
// the reason correctly without a schema change: the RPC's own where
// clause guarantees at least one of the two is set, so a null
// sleeve_note means the record must be pinned, and a non-null one is
// truly a sleeve note whether or not the record also happens to be
// pinned (pins already sort first, so the row's position already shows
// that).
export function freshReason(item){
  return item && item.sleeve_note ? 'sleeve note' : 'pinned';
}

export function freshCaption(handle){
  return 'Records ' + handle + ' pinned or wrote about that you don’t have — pins first, then newest.';
}
