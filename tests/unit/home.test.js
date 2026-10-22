import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// NV4 (docs/11_SMOOTH_NAVIGATION.md): social/screens/home.js's real
// circular pair with friend-store.js, plus its real imports of
// profile/storefront.js and sundown/spin-wording.js, all reach wider
// chains than this file needs for its own subject (renderHome()'s own
// build-once/cache/patch behavior) -- mocked directly, the usual "stop the
// chain at the door" reasoning every other mock-heavy file in this suite
// already uses.
mock.module(new URL('../../src/social/screens/friend-store.js', import.meta.url).href, {
  namedExports: { openFriendStore(){} },
});
mock.module(new URL('../../src/profile/storefront.js', import.meta.url).href, {
  namedExports: {
    storeAwning(){ return el('div', 'store-awning', 'awning'); },
    storeRequestsCard(){ return el('div', 'requests-card', 'requests'); },
  },
});
mock.module(new URL('../../src/sundown/spin-wording.js', import.meta.url).href, {
  namedExports: { spinPhaseWording(){ return null; } },
});
// home.js's own real circular pair with profile/settings.js (settings.js
// already imports renderHome/clearHomeFeedCache back from here) -- mocked
// the same "stop the chain at the door" way, since the real settings.js
// reaches the whole profile/storefront.js/screens.js cluster.
mock.module(new URL('../../src/profile/settings.js', import.meta.url).href, {
  namedExports: { beginSocialSignIn(){} },
});
// Ken, 2026-10-22: home.js's own real circular pair with shell/routes.js
// (routes.js already imports renderHome back from here) -- mocked the
// same "stop the chain at the door" way, since the real routes.js reaches
// profile/screens.js and the gatefold/nav-stack chain.
let lastShowRouteCall = null;
mock.module(new URL('../../src/shell/routes.js', import.meta.url).href, {
  namedExports: { showRoute(name){ lastShowRouteCall = name; } },
});

// A small but real fake DOM: appendChild tracks real parent-child
// structure and innerHTML='' really clears children (same convention as
// tests/unit/library-view.test.js), since buildHomeShell()'s "only ever
// wipes #homeBody when (re)building the shell" claim is the thing under
// test here.
function fakeEl(tag){
  const kids = [];
  const classes = new Set();
  const node = {
    tagName: (tag || 'div').toUpperCase(),
    children: kids,
    className: '', textContent: '', type: '', placeholder: '', style: {}, id: '', dataset: {},
    // tabs-design-unify swapped a few inline-style writes in home.js for
    // classList.add() (home-feed-card/home-feed-more/home-spin-cover/
    // home-spin-tap) -- a real classList, same stub shape as
    // favorites.test.js's fakeEl().
    classList: {
      add(...cs){ cs.forEach(c => classes.add(c)); },
      remove(...cs){ cs.forEach(c => classes.delete(c)); },
      contains(c){ return classes.has(c); },
    },
    appendChild(child){ kids.push(child); child.parent = node; return child; },
    addEventListener(){},
    setAttribute(){}, removeAttribute(){}, getAttribute(){ return null; },
  };
  Object.defineProperty(node, 'innerHTML', {
    get(){ return kids.length ? '…' : ''; },
    set(v){ if(v === '') kids.length = 0; },
  });
  return node;
}
function el(tag, cls, text){
  const e = fakeEl(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
const homeBody = fakeEl('div');
// A real (if tiny) attribute store, unlike fakeEl()'s no-op getAttribute --
// updateHomeTabVisibility()'s own "was this tab the one selected" check
// needs to read back what it (or showRoute()) actually set.
function fakeTabBtn(){
  const attrs = { 'aria-selected': 'false' };
  return {
    style: {},
    setAttribute(k, v){ attrs[k] = String(v); },
    getAttribute(k){ return k in attrs ? attrs[k] : null; },
  };
}
const homeTabBtn = fakeTabBtn();
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){
      if(sel === '#homeBody') return homeBody;
      if(sel === '#homeTabBtn') return homeTabBtn;
      return null;
    },
    el,
  },
});

globalThis.localStorage = (() => {
  let store = {};
  return {
    getItem(k){ return k in store ? store[k] : null; },
    setItem(k, v){ store[k] = String(v); },
    removeItem(k){ delete store[k]; },
    _reset(){ store = {}; },
  };
})();

const { renderHome, refreshHome, clearHomeFeedCache, groupFeedEvents, feedEventText, updateHomeTabVisibility, _resetHomeStateForTests } =
  await import('../../src/social/screens/home.js');

function fakeEvent(id, overrides){
  return Object.assign({ type:'added', title:'Album ' + id, actor_id:'a1', actor_handle:'a', actor_name:'A' }, overrides);
}

function resetHome(opts = {}){
  // home.js's own module-level "has the shell been built" state (and its
  // stable-host references) would otherwise leak between tests, since the
  // module is imported once for the whole file -- _resetHomeStateForTests()
  // is the test-only escape hatch, same precedent as nav-stack.js's
  // _debugLayers().
  _resetHomeStateForTests();
  homeBody.children.length = 0;
  homeTabBtn.style.display = '';
  homeTabBtn.setAttribute('aria-selected', 'false');
  lastShowRouteCall = null;
  localStorage._reset();
  globalThis.MizikiSocial = Object.assign({
    status(){ return { auth: 'ready' }; },
    listRequests: async () => ({ ok:true, requests:[] }),
    listFollowing: async () => ({ ok:true, following:[] }),
    homeFeed: async () => ({ ok:true, events:[] }),
    subscribeNowSpinning(){ return () => {}; },
    searchProfiles: async () => ({ ok:true, profiles:[] }),
    labelColor(){ return '#000'; },
  }, opts.social);
}

// --- updateHomeTabVisibility: the tab itself, not just its content -----

test('updateHomeTabVisibility: hides the tab signed out, shows it once ready', () => {
  resetHome({ social: { status(){ return { auth: 'signedOut' }; } } });
  updateHomeTabVisibility();
  assert.equal(homeTabBtn.style.display, 'none');

  resetHome({ social: { status(){ return { auth: 'ready' }; } } });
  updateHomeTabVisibility();
  assert.equal(homeTabBtn.style.display, '');
});

test('updateHomeTabVisibility: needsProfile stays hidden, same as signedOut', () => {
  resetHome({ social: { status(){ return { auth: 'needsProfile' }; } } });
  updateHomeTabVisibility();
  assert.equal(homeTabBtn.style.display, 'none');
});

test('updateHomeTabVisibility: signing out while Home was the selected tab lands back on Library', () => {
  resetHome({ social: { status(){ return { auth: 'signedOut' }; } } });
  homeTabBtn.setAttribute('aria-selected', 'true');
  updateHomeTabVisibility();
  assert.equal(lastShowRouteCall, 'library');
});

test('updateHomeTabVisibility: signing out while Home was NOT selected never redirects', () => {
  resetHome({ social: { status(){ return { auth: 'signedOut' }; } } });
  homeTabBtn.setAttribute('aria-selected', 'false');
  updateHomeTabVisibility();
  assert.equal(lastShowRouteCall, null);
});

test('updateHomeTabVisibility: staying signed in and selected never redirects', () => {
  resetHome({ social: { status(){ return { auth: 'ready' }; } } });
  homeTabBtn.setAttribute('aria-selected', 'true');
  updateHomeTabVisibility();
  assert.equal(lastShowRouteCall, null);
});

test('renderHome: signed out shows its own sign-in card, never builds the shell, never Profile\'s identity editor', async () => {
  resetHome({ social: { status(){ return { auth: 'signedOut' }; } } });
  await renderHome();
  assert.equal(homeBody.children.length, 2);
  assert.equal(homeBody.children[0].className, 'store-awning');
  assert.equal(homeBody.children[1].className, 'store-open-card');
  // Home's own card, not a reuse of Profile's -- no avatar/name editor and
  // no crate grid of this device's own records, just what the feed is for.
  const heading = homeBody.children[1].children.find(c => c.tagName === 'H3');
  assert.ok(heading, 'has its own heading');
  assert.match(heading.textContent, /friends/i);
});

test('renderHome: needsProfile shows "Finish setup" instead of "Sign in"', async () => {
  resetHome({ social: { status(){ return { auth: 'needsProfile' }; } } });
  await renderHome();
  const card = homeBody.children[1];
  const btn = card.children.find(c => c.tagName === 'BUTTON');
  assert.equal(btn.textContent, 'Finish setup');
});

test('renderHome: builds the shell once -- a second call never rebuilds it', async () => {
  resetHome();
  await renderHome();
  const firstCount = homeBody.children.length;
  const firstChild = homeBody.children[0];
  assert.ok(firstCount > 0);
  await renderHome();
  assert.equal(homeBody.children.length, firstCount, 'no extra top-level sections were added by the second call');
  assert.equal(homeBody.children[0], firstChild, 'the shell\'s own first child is the exact same node, not rebuilt');
});

test('renderHome: "Loading…" appears only on the very first load ever (no cache)', async () => {
  resetHome();
  await renderHome();
  // the feed section is the shell's last top-level child; its own holder
  // (second child of that section) starts with the loading row, replaced
  // once the (empty, per resetHome's default) feed resolves -- so after
  // the full await, the loading row is already gone.
  const feedSection = homeBody.children[homeBody.children.length - 1];
  const feedHolder = feedSection.children[1];
  assert.equal(feedHolder.children.length, 1);
  assert.equal(feedHolder.children[0].textContent, 'Nothing yet — follow some friends to see what they’re up to.');
});

test('renderHome: a cached feed shows synchronously, before the network call resolves', async () => {
  resetHome({
    social: {
      // never resolves within this test -- if paintFeed(cached) only ran
      // after awaiting this, the assertion below would see the loading
      // row instead, not the cached one
      homeFeed: () => new Promise(() => {}),
    },
  });
  localStorage.setItem('miziki-home-feed-cache', JSON.stringify({ events: [fakeEvent('x')] }));
  const pending = renderHome(); // not awaited yet -- runs synchronously up to its first await
  const feedSection = homeBody.children[homeBody.children.length - 1];
  const feedHolder = feedSection.children[1];
  assert.equal(feedHolder.children.length, 1);
  assert.notEqual(feedHolder.children[0].textContent, 'Loading…');
  void pending; // leaves the unresolved homeFeed() promise dangling on purpose
});

test('refreshHome: patches the feed holder in place without rebuilding the shell', async () => {
  resetHome({ social: { homeFeed: async () => ({ ok:true, events:[fakeEvent('a'), fakeEvent('b')] }) } });
  await renderHome();
  const shellCount = homeBody.children.length;
  await refreshHome();
  assert.equal(homeBody.children.length, shellCount, 'refreshHome() never adds/removes a top-level section');
});

// RF2 (docs/12_REFINE.md): hiding a record must also drop it from the
// cache, so a friend's own next-launch "show the cache immediately" paint
// never flashes a record the server no longer returns at all. saveFeedCache()
// is a full overwrite, never a merge (home.js's own refreshHome(), just
// above) -- this proves that's actually true end to end: a previously
// cached event the server stops returning is gone from the cache after one
// refresh, with no code change needed for this item of RF2.
test('refreshHome: a record the server stops returning disappears from the cache, not just the screen', async () => {
  resetHome({ social: { homeFeed: async () => ({ ok:true, events:[fakeEvent('a'), fakeEvent('b')] }) } });
  await renderHome(); // caches events a+b
  assert.deepEqual(JSON.parse(localStorage.getItem('miziki-home-feed-cache')).events.map(e => e.title),
    ['Album a', 'Album b']);

  // the record behind event 'b' got hidden server-side (RF2's own fix) --
  // the next homeFeed() response no longer includes it at all. Swapping the
  // mock in place (not calling resetHome() again, which would also wipe the
  // very cache this test is checking) simulates a plain later refresh.
  globalThis.MizikiSocial.homeFeed = async () => ({ ok:true, events:[fakeEvent('a')] });
  await renderHome();
  const cached = JSON.parse(localStorage.getItem('miziki-home-feed-cache')).events;
  assert.deepEqual(cached.map(e => e.title), ['Album a'], 'the hidden record\'s event was dropped, not kept alongside the new response');
});

test('clearHomeFeedCache: removes the cache and forces the shell to rebuild on the next renderHome()', async () => {
  resetHome();
  await renderHome();
  const firstChild = homeBody.children[0];
  localStorage.setItem('miziki-home-feed-cache', JSON.stringify({ events: [fakeEvent('a')] }));
  clearHomeFeedCache();
  assert.equal(localStorage.getItem('miziki-home-feed-cache'), null);
  await renderHome();
  assert.notEqual(homeBody.children[0], firstChild, 'the shell was rebuilt from scratch, not reused');
});

// --- groupFeedEvents: the feed's own ordering guarantee ------------------

test('groupFeedEvents: groups consecutive same-actor events, preserving input order (never reorders)', () => {
  const events = [fakeEvent('1', { actor_id:'a' }), fakeEvent('2', { actor_id:'a' }), fakeEvent('3', { actor_id:'b' })];
  const groups = groupFeedEvents(events);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].actor_id, 'a');
  assert.deepEqual(groups[0].events, [events[0], events[1]]);
  assert.equal(groups[1].actor_id, 'b');
});

test('groupFeedEvents: calling it twice on the same events array gives byte-identical grouping', () => {
  const events = [fakeEvent('1', { actor_id:'a' }), fakeEvent('2', { actor_id:'b' }), fakeEvent('3', { actor_id:'a' })];
  const once = groupFeedEvents(events);
  const twice = groupFeedEvents(events);
  assert.deepEqual(once.map(g => g.actor_id), twice.map(g => g.actor_id));
  assert.deepEqual(once.map(g => g.events.length), twice.map(g => g.events.length));
});

test('feedEventText: "added" with a plural count says how many, singular says the title', () => {
  assert.equal(feedEventText(fakeEvent('1', { type:'added', title:'Thriller', payload:{count:1} })), 'added Thriller');
  assert.equal(feedEventText(fakeEvent('1', { type:'added', title:'Thriller', payload:{count:3} })), 'added 3 records');
});
