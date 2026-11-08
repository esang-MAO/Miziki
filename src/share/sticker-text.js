// CC3 (docs/34_CARE_AND_CONTROL.md): friendsStickerText() pulled out of
// record-card.js into its own import-free leaf so src/social/sticker.js
// (the badge shown outside the share card -- storefront.js, shelf-unit.js,
// friend-store.js, home.js) can share the exact same wording without
// pulling in record-card.js's own share/styles.js chain, which reaches
// ui/wordmark.js's `?raw` SVG import -- fine under Vite, but a plain
// `import ... from '*.svg?raw'` the Node test runner's module loader can't
// resolve at all, so a module reached by unit tests (home.test.js, via
// home.js's own badge) can never afford to pull it in.
// FS8 (docs/25_FROM_SCRATCH.md point 3): "3 friends" / "1 friend", the
// plain count the round sticker draws -- replacing the old "IN N FRIENDS'
// CRATES" chip copy. RF20: friends only (mutual follows), gated by the
// owner's own "count me in friends' stickers" switch, both already
// decided by whoever gathered the count.
export function friendsStickerText(friendsCount){
  const n = Math.round(friendsCount || 0);
  if(n <= 0) return null;
  return n + (n === 1 ? ' friend' : ' friends');
}
