import { $, el } from '../../util/dom.js';
import { storeAwning, storeRequestsCard } from '../../profile/storefront.js';
import { feedEventText } from './feed-text.js';
import { spinPhaseWording } from '../../sundown/spin-wording.js';
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

// Ken, 2026-10-22: Home used to reuse profile/storefront.js's own
// renderOpenStoreCard() wholesale when signed out -- the exact same card
// Profile shows, avatar/name editor, this device's own Records count and
// crate grid included. That made the two tabs look identical signed out,
// which was never the intent: RF7 (docs/12_REFINE.md) only asked for "one
// card (what friends' crates are, and a sign-in button)," not a second
// copy of the Profile screen's own identity editor. This is Home's own
// card -- no avatar, no username, no crate grid of this device's own
// records, just what the feed is for and a way in.
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

// Ken, 2026-10-22: the Home tab itself is gone outright while signed out,
// not just its content -- reappears the instant MizikiSocial reports
// auth:'ready'. #homeTabBtn has no hidden markup of its own in miziki.html
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
export function groupFeedEvents(events){
  const groups = [];
  events.forEach(e => {
    const last = groups[groups.length - 1];
    if(last && last.actor_id === e.actor_id) last.events.push(e);
    else groups.push({actor_id: e.actor_id, actor_handle: e.actor_handle, actor_name: e.actor_name, events: [e]});
  });
  return groups;
}

function homeFeedGroupCard(group){
  const card = el('div','store-card');
  card.classList.add('home-feed-card');
  const head = el('div','store-card-text home-feed-head');
  head.appendChild(el('b', null, group.actor_name || group.actor_handle));
  card.appendChild(head);
  const shown = group.events.slice(0, 3);
  shown.forEach(e => card.appendChild(el('div','store-activity-row', feedEventText(e))));
  if(group.events.length > shown.length){
    const more = el('div','store-activity-row home-feed-more', '+' + (group.events.length - shown.length) + ' more');
    card.appendChild(more);
  }
  // TR2 (docs/19_PLAYER.md): friend-store.js is real weight the home feed
  // itself never needs until a card is actually tapped -- dynamically
  // imported here and at this file's other two openFriendStore call
  // sites below, same pattern as src/wiring/share.js.
  card.addEventListener('click', async ()=> {
    const { openFriendStore } = await import('./friend-store.js');
    openFriendStore(group.actor_handle);
  });
  return card;
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
  const row = el('div','store-picks-row');
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
function paintHomeSpinRow(){
  const section = $('#homeSpinSection'); if(!section) return;
  const row = $('#homeSpinRow'); row.innerHTML = '';
  const entries = [...homeSpinState.values()];
  section.style.display = entries.length ? '' : 'none';
  entries.forEach(evt => {
    const tile = el('div','store-pick');
    const cover = el('div','store-pick-cover');
    cover.classList.add('home-spin-cover');
    cover.textContent = '♪ SPINNING';
    tile.appendChild(cover);
    const note = el('div','store-pick-note');
    note.appendChild(el('div','store-pick-name', (evt.release && evt.release.title) || evt.track || 'Now spinning'));
    const artist = (evt.release && evt.release.artist) || '';
    // DA6 (docs/DAY_ARC.md): the phase wording ("at dusk") the publisher's
    // own set_now_spinning call sent -- never a clock time or location.
    const wording = spinPhaseWording(evt.phase);
    note.appendChild(el('div', null, wording ? [artist, wording].filter(Boolean).join(' · ') : artist));
    tile.appendChild(note);
    const handle = homeFollowingHandles.get(evt.userId);
    if(handle){
      tile.classList.add('home-spin-tap');
      tile.addEventListener('click', async ()=> {
        const { openFriendStore } = await import('./friend-store.js');
        openFriendStore(handle);
      });
    }
    row.appendChild(tile);
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
const HOME_FEED_CACHE_KEY = 'miziki-home-feed-cache';
let homeShellBuilt = false;
let feedHolderEl = null;
let requestsHolderEl = null;

function loadFeedCache(){
  try{
    const raw = localStorage.getItem(HOME_FEED_CACHE_KEY);
    if(!raw) return null;
    const data = JSON.parse(raw);
    return (data && Array.isArray(data.events)) ? data.events : null;
  }catch(_e){ return null; }
}
function saveFeedCache(events){
  try{ localStorage.setItem(HOME_FEED_CACHE_KEY, JSON.stringify({ events })); }
  catch(_e){}
}
export function clearHomeFeedCache(){
  homeShellBuilt = false;
  try{ localStorage.removeItem(HOME_FEED_CACHE_KEY); }catch(_e){}
}

function paintRequests(reqs){
  if(!requestsHolderEl) return;
  requestsHolderEl.innerHTML = '';
  if(reqs.ok && reqs.requests.length){
    requestsHolderEl.appendChild(storeRequestsCard(reqs.requests, refreshHome));
  }
}

// Builds the feed's own rendered list straight from `events`, in the exact
// order given — this file never reorders them itself, so repainting the
// same events (nothing new since the last refresh) always draws the same
// order. groupFeedEvents() is pure/exported for this reason, so a test can
// check that ordering claim without touching the DOM at all.
function paintFeed(events){
  if(!feedHolderEl) return;
  feedHolderEl.innerHTML = '';
  if(!events || !events.length){
    feedHolderEl.appendChild(el('p','store-loading','Nothing yet — follow some friends to see what they’re up to.'));
    return;
  }
  groupFeedEvents(events).forEach(g => feedHolderEl.appendChild(homeFeedGroupCard(g)));
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
  feedSection.appendChild(el('div','store-section-head')).appendChild(el('h2', null, 'Activity'));
  feedHolderEl = el('div');
  feedSection.appendChild(feedHolderEl);
  container.appendChild(feedSection);
}

// The actual data refresh — re-fetches requests/following/the feed and
// patches each of buildHomeShell()'s own stable hosts in place. This is
// what pull-to-refresh calls (src/shell/pull-refresh.js), what the
// follow-request card's own accept/decline buttons call afterward (in
// place of a full renderHome(), which used to rebuild the whole tab just to
// reflect one answered request), and what a normal renderHome() call runs
// after making sure the shell exists.
export async function refreshHome(){
  const [reqs, following] = await Promise.all([MizikiSocial.listRequests(), MizikiSocial.listFollowing()]);
  paintRequests(reqs);
  homeFollowingHandles = new Map();
  if(following.ok) following.following.forEach(f => {
    if(f.status === 'accepted' && f.profiles) homeFollowingHandles.set(f.followee_id, f.profiles.handle);
  });
  const feed = await MizikiSocial.homeFeed({limit:50});
  if(feed.ok){
    paintFeed(feed.events);
    saveFeedCache(feed.events);
  }
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
    if(cached) paintFeed(cached);
    else feedHolderEl.appendChild(el('p','store-loading','Loading…'));
  }
  await refreshHome();
}

// test-only accessor — never used by app code
export function _resetHomeStateForTests(){
  homeShellBuilt = false;
  feedHolderEl = null;
  requestsHolderEl = null;
  homeFollowingHandles = new Map();
  if(homeSpinUnsub){ homeSpinUnsub(); homeSpinUnsub = null; }
  homeSpinState.clear();
}
