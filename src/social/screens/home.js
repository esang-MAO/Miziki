import { $, el } from '../../util/dom.js';
import { S } from '../../state.js';
import { storeAwning, storeRequestsCard } from '../../profile/storefront.js';
import { feedEventText } from './feed-text.js';
import { spinPhaseWording } from '../../sundown/spin-wording.js';
// FS9 (docs/25_FROM_SCRATCH.md point 1): "a small disc with the record's
// pressing colour" -- import-free (see its own header), so pulling it in
// here costs this file nothing new to mock.
import { PHASE_COLOR } from '../../profile/rhythm-card.js';
// Real circular import with profile/settings.js (the same shape as
// engine.js/transport.js) -- settings.js already imports renderHome/
// clearHomeFeedCache back from this file. Used only inside a click
// handler below, never at module top level.
import { beginSocialSignIn } from '../../profile/settings.js';
// Real circular import with shell/routes.js (routes.js already imports
// renderHome back from here, see showRoute()'s own "name === 'home'"
// branch) -- the same peer-import shape as audio/engine.js/player/
// transport.js (CLAUDE.md's refactor rule 8). Used only by
// updateHomeTabVisibility() below, to leave Home if it just disappeared
// out from under whoever was on it.
import { showRoute } from '../../shell/routes.js';

// RF7 (docs/12_REFINE.md) asks for "one card (what friends' crates are,
// and a sign-in button)," not a copy of the Profile screen's own identity
// editor -- so this is Home's own card, deliberately distinct from
// profile/storefront.js's renderOpenStoreCard(): no avatar, no username,
// no crate grid of this device's own records, just what the feed is for
// and a way in.
function renderHomeSignInCard(host, authState){
  host.innerHTML = '';
  host.appendChild(storeAwning());
  const card = el('div','store-open-card');
  card.appendChild(el('h3', null, 'See what friends are spinning'));
  card.appendChild(el('p', null, authState === 'needsProfile'
    ? 'Finish setting up your crate to follow friends and see what they’re playing here.'
    : 'Sign in to follow friends, see what they’re playing, and share your own crate.'));
  const btn = el('button','cta', authState === 'needsProfile' ? 'Finish setup' : 'Sign in');
  btn.addEventListener('click', beginSocialSignIn);
  card.appendChild(btn);
  host.appendChild(card);
}

// The Home tab itself is gone outright while signed out, not just its
// content -- reappears the instant MizikiSocial reports auth:'ready'.
// #homeTabBtn has no hidden markup of its own in miziki.html
// (it's the one every signed-in return visit actually wants to see), so
// this is what hides it. style.display, not the hidden attribute:
// .tabbar-btn's own display:flex rule in 08-shell.css has the exact same
// specificity as the UA [hidden]{display:none} default and would win
// against it by source order (see 25-day-arc-v2.css's own [hidden]
// override comment for this same pitfall elsewhere in the app).
// Called from main.js's boot sequence, once synchronously (status() starts
// at auth:'signedOut' regardless of whether social is configured at all,
// so there's nothing to wait on) and again on every later 'status' event
// (main.js wires MizikiSocial.on('status', ...) to this same function) --
// not wired here at this module's own top level, since that would call
// MizikiSocial before any test (or any other early-loading module) has a
// chance to stub it in, the same reason sync/backup.js's own 'status'
// listener is registered from inside initBackupSync(), called from
// main.js, rather than at that file's own top level either.
export function updateHomeTabVisibility(){
  const btn = $('#homeTabBtn');
  if(!btn) return;
  const signedIn = MizikiSocial.status().auth === 'ready';
  btn.style.display = signedIn ? '' : 'none';
  // the tab just vanished out from under whoever was looking at it (a
  // sign-out while Home itself was the route on screen) -- land back on
  // Library rather than leave a hidden tab marked aria-selected="true"
  // with its own route still the one actually showing.
  if(!signedIn && btn.getAttribute('aria-selected') === 'true') showRoute('library');
}

/* ---- Home tab: feed, people search, now-spinning, follow requests ---- */

// FS9 (docs/25_FROM_SCRATCH.md point 2): one sleeve tile per event --
// "added by …"/"pinned by …" read straight off the event's own type;
// anything else (a rating, a sleeve note with no pin, a rare-pressing
// unlock) falls back to feedEventText()'s own phrase, read aloud rather
// than captioned as "by handle". A pinned record's note comes from a
// same-release 'review' feed_events row elsewhere in this same batch --
// one crate_items row can produce both a 'pinned' row (payload '{}') and
// a 'review' row (payload {rating, note}) for the identical release
// (001_schema.sql's own trigger), so the two combine into the one tile
// the spec asks for ("a pinned record with a sleeve note shows it as a
// Caveat slip on the sleeve") instead of showing twice. Pure/exported,
// same reasoning as groupFeedEvents() before it (replaced outright --
// the old per-actor text list doesn't fit a tile grid).
export function buildFeedTiles(events){
  const notes = new Map();
  events.forEach(e => {
    if(e.type === 'review' && e.payload && e.payload.note){
      notes.set(e.actor_id + '|' + e.release_id, e.payload.note);
    }
  });
  return events.map(e => {
    const handle = e.actor_handle || e.actor_name || '';
    const caption = e.type === 'added' ? ('added by ' + handle)
      : e.type === 'pinned' ? ('pinned by ' + handle)
      : feedEventText(e);
    const note = e.type === 'pinned' ? (notes.get(e.actor_id + '|' + e.release_id) || null) : null;
    return { key: e.id, title: e.title || 'a record', caption, note, actor_handle: e.actor_handle };
  });
}

function homeFeedTile(t){
  const tile = el('div','store-pick home-feed-tile');
  tile.appendChild(el('div','store-pick-cover'));
  tile.appendChild(el('div','store-pick-name', t.title));
  tile.appendChild(el('div','home-feed-caption', t.caption));
  if(t.note){
    const note = el('div','store-pick-note');
    note.appendChild(el('div','store-pick-sleeve-note', t.note));
    tile.appendChild(note);
  }
  // TR2 (docs/19_PLAYER.md): friend-store.js is real weight the home feed
  // itself never needs until a tile is actually tapped -- dynamically
  // imported here and at this file's other openFriendStore call sites,
  // same pattern as src/wiring/share.js.
  if(t.actor_handle){
    tile.classList.add('home-feed-tap');
    tile.addEventListener('click', async ()=> {
      const { openFriendStore } = await import('./friend-store.js');
      openFriendStore(t.actor_handle);
    });
  }
  return tile;
}

function homePeopleSearch(container){
  const row = el('div','slider-row');
  const input = el('input','pl-input');
  input.type = 'search'; input.placeholder = 'Find people by handle';
  input.setAttribute('aria-label','Find people by handle');
  row.appendChild(input);
  container.appendChild(row);
  const results = el('div');
  container.appendChild(results);
  let seq = 0, timer = null;
  input.addEventListener('input', ()=>{
    clearTimeout(timer);
    const q = input.value.trim();
    timer = setTimeout(async ()=>{
      results.innerHTML = '';
      if(q.length < 2) return;
      const mySeq = ++seq;
      const r = await MizikiSocial.searchProfiles(q);
      if(mySeq !== seq || !r.ok) return;
      r.profiles.forEach(p => {
        const btn = el('button','store-card-btn store-card');
        const count = el('div','store-card-count');
        count.style.background = MizikiSocial.labelColor(p.handle);
        btn.appendChild(count);
        const text = el('div','store-card-text');
        text.appendChild(el('b', null, p.display_name || p.handle));
        text.appendChild(el('em', null, p.handle));
        btn.appendChild(text);
        btn.addEventListener('click', async ()=> {
          const { openFriendStore } = await import('./friend-store.js');
          openFriendStore(p.handle);
        });
        results.appendChild(btn);
      });
    }, 300);
  });
}

const homeSpinState = new Map();
let homeSpinUnsub = null;
let homeFollowingHandles = new Map();

// NV4 (docs/11_SMOOTH_NAVIGATION.md): build once, patch in place. Before
// this step, homeNowSpinningRow() (unsubscribe/resubscribe to realtime) ran
// on every single renderHome() call — the one place this file already had
// the "build once, patch" shape (homeSpinState/paintHomeSpinRow() persisting
// across calls) was undermined by resubscribing every time anyway. Now
// called only from buildHomeShell(), once per sign-in.
function homeNowSpinningRow(container){
  const section = el('div');
  section.id = 'homeSpinSection';
  section.style.display = 'none';
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'Now spinning'));
  section.appendChild(head);
  const row = el('div','home-spin-list');
  row.id = 'homeSpinRow';
  section.appendChild(row);
  container.appendChild(section);
  paintHomeSpinRow();
  if(homeSpinUnsub) homeSpinUnsub();
  homeSpinUnsub = MizikiSocial.subscribeNowSpinning(evt => {
    if(evt.type === 'stopped') homeSpinState.delete(evt.userId);
    else homeSpinState.set(evt.userId, evt);
    paintHomeSpinRow();
  });
}
// FS9 (docs/25_FROM_SCRATCH.md point 1): a vertical list of rows -- a
// small disc, the title, a muted "handle · …" subline -- replacing the
// old horizontal "♪ SPINNING" card row. The realtime now_spinning payload
// (miziki-social.js's subscribeNowSpinning()) carries no pressing/variant
// or side (A/B) for a *friend's* spin -- only release title/artist and
// the DA6 day-arc phase it started in -- so the disc is tinted by that
// phase (profile/rhythm-card.js's own PHASE_COLOR, already the dial's
// color for "what phase was this") rather than a pressing colour that
// isn't there to read, and the subline reuses the same phase wording
// ("at dusk") the spec's literal "side B" example would have sat next to.
function paintHomeSpinRow(){
  const section = $('#homeSpinSection'); if(!section) return;
  const row = $('#homeSpinRow'); row.innerHTML = '';
  const entries = [...homeSpinState.values()];
  section.style.display = entries.length ? '' : 'none';
  entries.forEach(evt => {
    const item = el('div','home-spin-row');
    const disc = el('div','home-spin-disc');
    disc.style.background = PHASE_COLOR[evt.phase] || PHASE_COLOR.midday;
    item.appendChild(disc);
    const text = el('div','home-spin-text');
    text.appendChild(el('div','home-spin-title', (evt.release && evt.release.title) || evt.track || 'Now spinning'));
    const handle = homeFollowingHandles.get(evt.userId);
    // DA6 (docs/DAY_ARC.md): the phase wording ("at dusk") the publisher's
    // own set_now_spinning call sent -- never a clock time or location.
    const wording = spinPhaseWording(evt.phase);
    text.appendChild(el('div','home-spin-sub', [handle, wording].filter(Boolean).join(' · ')));
    item.appendChild(text);
    if(handle){
      item.classList.add('home-spin-tap');
      item.addEventListener('click', async ()=> {
        const { openFriendStore } = await import('./friend-store.js');
        openFriendStore(handle);
      });
    }
    row.appendChild(item);
  });
}

// NV4 (docs/11_SMOOTH_NAVIGATION.md): a small device-only cache of the
// feed's own already-fetched events (never a token, never anything that
// isn't already public-to-this-viewer data) so a return visit shows the
// feed immediately instead of a blank "Loading…" flash. Cleared on
// sign-out and account deletion — see clearHomeFeedCache() below, called
// from src/profile/settings.js's three sign-out/delete-account sites.
// CLAUDE.md's own backup-table rule ("every new saved key goes into that
// table") applies to this too — see this PR's CLAUDE.md edit, device-only.
// RW2 (docs/23_RHYTHM_AND_WEAR.md) adds `fetchedAt` alongside `events` —
// when the feed itself was last actually fetched, read by
// shouldFetchHomeFeed()/homeBannerStateAt() below to decide whether
// today's once-a-day fetch is still owed.
const HOME_FEED_CACHE_KEY = 'miziki-home-feed-cache';
let homeShellBuilt = false;
let feedHolderEl = null;
let requestsHolderEl = null;
let bannerHolderEl = null;

function loadFeedCache(){
  try{
    const raw = localStorage.getItem(HOME_FEED_CACHE_KEY);
    if(!raw) return null;
    const data = JSON.parse(raw);
    return (data && Array.isArray(data.events)) ? { events: data.events, fetchedAt: data.fetchedAt || null } : null;
  }catch(_e){ return null; }
}
function saveFeedCache(events){
  try{ localStorage.setItem(HOME_FEED_CACHE_KEY, JSON.stringify({ events, fetchedAt: Date.now() })); }
  catch(_e){}
}
export function clearHomeFeedCache(){
  homeShellBuilt = false;
  try{ localStorage.removeItem(HOME_FEED_CACHE_KEY); }catch(_e){}
}

// shouldFetchHomeFeed(cachedFetchedAt, sunriseMs, nowMs) -> RW2's own
// fetch gate: true on the very first load (no cache yet), or once per day
// the first time `now` reaches today's sunrise after the cache's last
// fetch — i.e. the cache is stale *and* the morning window has opened.
// Pure/exported so this decision is testable with no DOM, same shape as
// groupFeedEvents() above. `sunriseMs` with nothing usable (no sun data
// at all, which shouldn't happen given location.js's own fallback) fails
// open to "always fetch" rather than get the feed permanently stuck.
export function shouldFetchHomeFeed(cachedFetchedAt, sunriseMs, nowMs){
  if(cachedFetchedAt == null) return true;
  if(sunriseMs == null) return true;
  return cachedFetchedAt < sunriseMs && nowMs >= sunriseMs;
}

// homeBannerStateAt(nowMs, sun) -> 'morning' | 'caughtUp' | null. 'morning'
// during today's own daylight window (sunrise up to sunset); 'caughtUp'
// the rest of the time (including the pre-dawn tail of last night, which
// reads the same as "after sunset" — nothing new arrives until the next
// sunrise either way). null with no usable sun data (nothing to anchor
// either state to — the shell just shows the feed with no banner).
export function homeBannerStateAt(nowMs, sun){
  if(!sun || !sun.rise || !sun.set) return null;
  const riseT = sun.rise.getTime(), setT = sun.set.getTime();
  return (nowMs >= riseT && nowMs < setT) ? 'morning' : 'caughtUp';
}

// paintHomeBanner(fetchedAt) -> the caught-up line below the feed (frame
// `12-after-dark-home`), or clears the host outside that state. FS9 point
// 3: "plain Archivo 14 muted" -- the old two-state card (a morning
// "Updated this morning · time" banner plus a dashed caught-up card) is
// gone; the section heading below ("This morning") already says when
// this is, so the morning state needs no banner of its own, and the
// caught-up state (most of the day, once sunset's passed -- this file's
// own RW2 fetch gate keeps the feed's *data* on its once-a-day schedule
// regardless) is now just the one line the spec asks for.
function paintHomeBanner(_fetchedAt){
  if(!bannerHolderEl) return;
  bannerHolderEl.innerHTML = '';
  const state = homeBannerStateAt(Date.now(), S.sun);
  if(state === 'caughtUp'){
    bannerHolderEl.appendChild(el('p','home-feed-caughtup', "You're caught up."));
  }
}

function paintRequests(reqs){
  if(!requestsHolderEl) return;
  requestsHolderEl.innerHTML = '';
  if(reqs.ok && reqs.requests.length){
    requestsHolderEl.appendChild(storeRequestsCard(reqs.requests, refreshHome));
  }
}

// Builds the feed's own rendered tile grid straight from `events`, in the
// exact order given — this file never reorders them itself, so repainting
// the same events (nothing new since the last refresh) always draws the
// same order. buildFeedTiles() is pure/exported for this reason, so a test
// can check that ordering claim without touching the DOM at all.
function paintFeed(events){
  if(!feedHolderEl) return;
  feedHolderEl.innerHTML = '';
  if(!events || !events.length){
    feedHolderEl.appendChild(el('p','store-loading','Nothing yet — follow some friends to see what they’re up to.'));
    return;
  }
  const grid = el('div','home-feed-grid');
  buildFeedTiles(events).forEach(t => grid.appendChild(homeFeedTile(t)));
  feedHolderEl.appendChild(grid);
}

// Builds #homeBody's own static shell once per sign-in: the people-search
// field, a stable host for the follow-requests card, the now-spinning
// section (subscribes to realtime once, see homeNowSpinningRow() above),
// and a stable host for the feed. Every later refresh only ever touches
// requestsHolderEl/feedHolderEl's own contents — #homeBody itself is never
// wiped again until a sign-out/sign-in actually changes what shell is
// needed (buildHomeShell() is the only thing that calls container.innerHTML
// = '', and only when (re)building the shell for the first time).
function buildHomeShell(container){
  container.innerHTML = '';
  homePeopleSearch(container);
  requestsHolderEl = el('div');
  container.appendChild(requestsHolderEl);
  homeNowSpinningRow(container);
  const feedSection = el('div','store-section');
  // FS9 (docs/25_FROM_SCRATCH.md point 2): "heading Antonio 20 +
  // 'from friends' muted" -- #homeBody .store-section-head h2's own
  // tabs-design-unify override (25-day-arc-v2.css) drops every section
  // heading in this tab to the small mono label Settings/Library tools
  // use; .home-section-head--display opts this one heading back into the
  // display treatment the spec asks for, without touching "Now spinning"
  // above, which the spec leaves alone.
  const feedHead = el('div','store-section-head home-section-head--display');
  feedHead.appendChild(el('h2', null, 'This morning'));
  feedHead.appendChild(el('span','home-feed-kicker', 'from friends'));
  feedSection.appendChild(feedHead);
  bannerHolderEl = el('div');
  feedSection.appendChild(bannerHolderEl);
  feedHolderEl = el('div');
  feedSection.appendChild(feedHolderEl);
  container.appendChild(feedSection);
}

// The actual data refresh — re-fetches requests/following, and patches
// each of buildHomeShell()'s own stable hosts in place. This is what
// pull-to-refresh calls (src/shell/pull-refresh.js), what the
// follow-request card's own accept/decline buttons call afterward (in
// place of a full renderHome(), which used to rebuild the whole tab just to
// reflect one answered request), and what a normal renderHome() call runs
// after making sure the shell exists. RW2 (docs/23_RHYTHM_AND_WEAR.md):
// requests/following/Now spinning stay live at every hour as before — the
// feed itself only re-fetches once shouldFetchHomeFeed() says today's
// morning window is owed a fetch; otherwise (including a pull-to-refresh
// after sunset) this just repaints the cache and the caught-up banner.
export async function refreshHome(){
  const [reqs, following] = await Promise.all([MizikiSocial.listRequests(), MizikiSocial.listFollowing()]);
  paintRequests(reqs);
  homeFollowingHandles = new Map();
  if(following.ok) following.following.forEach(f => {
    if(f.status === 'accepted' && f.profiles) homeFollowingHandles.set(f.followee_id, f.profiles.handle);
  });

  const cache = loadFeedCache();
  const sunriseMs = S.sun && S.sun.rise ? S.sun.rise.getTime() : null;
  if(shouldFetchHomeFeed(cache ? cache.fetchedAt : null, sunriseMs, Date.now())){
    const feed = await MizikiSocial.homeFeed({limit:50});
    if(feed.ok){
      paintFeed(feed.events);
      saveFeedCache(feed.events);
      paintHomeBanner(Date.now());
      return;
    }
  }
  if(cache) paintFeed(cache.events);
  paintHomeBanner(cache ? cache.fetchedAt : null);
}

export async function renderHome(){
  const container = $('#homeBody');
  const status = MizikiSocial.status();
  if(status.auth !== 'ready'){
    container.innerHTML = '';
    homeShellBuilt = false;
    renderHomeSignInCard(container, status.auth);
    return;
  }
  if(!homeShellBuilt){
    buildHomeShell(container);
    homeShellBuilt = true;
    // cached feed shows synchronously -- "Loading..." only ever appears
    // before this device has ever cached a feed at all, never on a return
    // visit, per NV4 item 1.
    const cached = loadFeedCache();
    if(cached){ paintFeed(cached.events); paintHomeBanner(cached.fetchedAt); }
    else feedHolderEl.appendChild(el('p','store-loading','Loading…'));
  }
  await refreshHome();
}

// test-only accessor — never used by app code
export function _resetHomeStateForTests(){
  homeShellBuilt = false;
  feedHolderEl = null;
  requestsHolderEl = null;
  bannerHolderEl = null;
  homeFollowingHandles = new Map();
  if(homeSpinUnsub){ homeSpinUnsub(); homeSpinUnsub = null; }
  homeSpinState.clear();
}
