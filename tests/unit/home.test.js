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
    renderOpenStoreCard(host){ host.appendChild(el('p', 'open-store-card', 'open store card')); },
    storeRequestsCard(){ return el('div', 'requests-card', 'requests'); },
  },
});
mock.module(new URL('../../src/sundown/spin-wording.js', import.meta.url).href, {
  namedExports: { spinPhaseWording(){ return null; } },
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
mock.module(new URL('../../src/util/dom.js', import.meta.url).href, {
  namedExports: {
    $(sel){ return sel === '#homeBody' ? homeBody : null; },
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

const { renderHome, refreshHome, clearHomeFeedCache, groupFeedEvents, feedEventText, _resetHomeStateForTests } =
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

test('renderHome: signed out shows the calm card, never builds the shell', async () => {
  resetHome({ social: { status(){ return { auth: 'signedOut' }; } } });
  await renderHome();
  assert.equal(homeBody.children.length, 1);
  assert.equal(homeBody.children[0].className, 'open-store-card');
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
