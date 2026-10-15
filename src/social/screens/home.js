import { $, el } from '../../util/dom.js';
import { renderOpenStoreCard, storeRequestsCard } from '../../profile/storefront.js';
// Real circular import with ./friend-store.js (the same shape as engine.js/
// transport.js and the other established peer pairs): openFriendStore is
// friend-store.js's own, needed here for every tap-through to a friend's
// crate (a feed card, a people-search result, a now-spinning tile); that
// file in turn imports feedEventText back from here, for the friend
// store's own "recently at the counter" activity rows.
import { openFriendStore } from './friend-store.js';
import { spinPhaseWording } from '../../sundown/spin-wording.js';

/* ---- Home tab: feed, people search, now-spinning, follow requests ---- */
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
  card.addEventListener('click', ()=> openFriendStore(group.actor_handle));
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
        btn.addEventListener('click', ()=> openFriendStore(p.handle));
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
      tile.addEventListener('click', ()=> openFriendStore(handle));
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
    renderOpenStoreCard(container, status.auth);
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
