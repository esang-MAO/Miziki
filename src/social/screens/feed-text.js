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
  if(e.type === 'pinned') return 'pinned ' + title + ' to staff picks';
  if(e.type === 'review'){
    const p = e.payload || {};
    if(p.rating) return 'rated ' + title + ' ' + '★'.repeat(p.rating);
    return 'wrote a sleeve note on ' + title;
  }
  if(e.type === 'unlock') return 'unlocked a ' + ((e.payload && e.payload.variant) || 'rare') + ' pressing of ' + title;
  return 'updated ' + title;
}
