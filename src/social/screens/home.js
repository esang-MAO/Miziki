import { $, el } from '../../util/dom.js';
import { renderOpenStoreCard, storeRequestsCard } from '../../profile/storefront.js';
// Real circular import with ./friend-store.js (the same shape as engine.js/
// transport.js and the other established peer pairs): openFriendStore is
// friend-store.js's own, needed here for every tap-through to a friend's
// crate (a feed card, a people-search result, a now-spinning tile); that
// file in turn imports feedEventText back from here, for the friend
// store's own "recently at the counter" activity rows.
import { openFriendStore } from './friend-store.js';

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

function groupFeedEvents(events){
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
  card.style.cssText = 'flex-direction:column;align-items:stretch;cursor:pointer';
  const head = el('div','store-card-text');
  head.appendChild(el('b', null, group.actor_name || group.actor_handle));
  head.style.marginBottom = '6px';
  card.appendChild(head);
  const shown = group.events.slice(0, 3);
  shown.forEach(e => card.appendChild(el('div','store-activity-row', feedEventText(e))));
  if(group.events.length > shown.length){
    const more = el('div','store-activity-row', '+' + (group.events.length - shown.length) + ' more');
    more.style.color = 'var(--accent)';
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
    cover.style.cssText += 'display:flex;align-items:center;justify-content:center;font-family:var(--data);font-size:11px;color:var(--accent)';
    cover.textContent = '♪ SPINNING';
    tile.appendChild(cover);
    const note = el('div','store-pick-note');
    note.appendChild(el('div','store-pick-name', (evt.release && evt.release.title) || evt.track || 'Now spinning'));
    note.appendChild(el('div', null, (evt.release && evt.release.artist) || ''));
    tile.appendChild(note);
    const handle = homeFollowingHandles.get(evt.userId);
    if(handle){
      tile.style.cursor = 'pointer';
      tile.addEventListener('click', ()=> openFriendStore(handle));
    }
    row.appendChild(tile);
  });
}

export async function renderHome(){
  const container = $('#homeBody');
  container.innerHTML = '';
  const status = MizikiSocial.status();
  if(status.auth !== 'ready'){
    renderOpenStoreCard(container, status.auth);
    return;
  }
  homePeopleSearch(container);

  const [reqs, following] = await Promise.all([MizikiSocial.listRequests(), MizikiSocial.listFollowing()]);
  if(reqs.ok && reqs.requests.length){
    container.appendChild(storeRequestsCard(reqs.requests, renderHome));
  }
  homeFollowingHandles = new Map();
  if(following.ok) following.following.forEach(f => {
    if(f.status === 'accepted' && f.profiles) homeFollowingHandles.set(f.followee_id, f.profiles.handle);
  });

  homeNowSpinningRow(container);

  const feedSection = el('div','store-section');
  feedSection.appendChild(el('div','store-section-head')).appendChild(el('h2', null, 'Activity'));
  const feedHolder = el('div');
  feedHolder.appendChild(el('p','store-loading','Loading…'));
  feedSection.appendChild(feedHolder);
  container.appendChild(feedSection);
  const feed = await MizikiSocial.homeFeed({limit:50});
  feedHolder.innerHTML = '';
  if(!feed.ok || !feed.events.length){
    feedHolder.appendChild(el('p','store-loading','Nothing yet — follow some friends to see what they’re up to.'));
    return;
  }
  groupFeedEvents(feed.events).forEach(g => feedHolder.appendChild(homeFeedGroupCard(g)));
}
