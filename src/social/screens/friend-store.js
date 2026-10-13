import { $, el } from '../../util/dom.js';
import {
  storeAwning, storeStat, storePickTile, localAlbumArt, timeAgoShort,
  renderStoreError, STORE_TIER_LABEL,
} from '../../profile/storefront.js';
// Real circular import with ./home.js (the same shape as engine.js/
// transport.js and the other established peer pairs): feedEventText is
// home.js's own, but friendActivitySection below (the "recently at the
// counter" section of a friend's store) formats a friend's activity rows
// with the same text as the home feed does.
import { feedEventText } from './home.js';
import { renderSharedRhythmCard } from '../../profile/rhythm-card.js';

/* ================= Social Step D: friend store, locked state, record sheet, home feed ================= */

let socialNav = [];

function pushSocialScreen(screen){
  socialNav.push(screen);
  $('#socialNavOverlay').classList.add('open');
  $('#socialNavOverlay').setAttribute('aria-hidden','false');
  renderSocialNavTop();
}
export function popSocialScreen(){
  socialNav.pop();
  if(!socialNav.length){ closeSocialNav(); return; }
  renderSocialNavTop();
}
function closeSocialNav(){
  socialNav = [];
  $('#socialNavOverlay').classList.remove('open');
  $('#socialNavOverlay').setAttribute('aria-hidden','true');
}
function renderSocialNavTop(){
  const top = socialNav[socialNav.length - 1];
  const body = $('#socialNavBody'); body.innerHTML = '';
  if(top.type === 'friendStore'){
    $('#socialNavTitle').textContent = 'Browsing crate';
    loadAndRenderFriendStore(body, top.handle);
  }
}
export function openFriendStore(handle){
  pushSocialScreen({type:'friendStore', handle: String(handle || '').replace(/^@/, '')});
}

async function loadAndRenderFriendStore(body, handle){
  body.innerHTML = '';
  body.appendChild(el('p','store-loading','Loading crate…'));
  const full = await MizikiSocial.loadProfile(handle);
  if(!full.ok){ renderStoreError(body, full.error, ()=>loadAndRenderFriendStore(body, handle)); return; }
  $('#socialNavTitle').textContent = 'Browsing crate';
  body.innerHTML = '';
  if(!full.canView){ renderLockedFriendStore(body, full); return; }
  renderFriendStoreContent(body, full);
}

function friendStoreHeader(full, extraBtn){
  const header = el('div','store-header');
  const avatar = el('div','store-avatar');
  const label = el('div','store-avatar-label'); label.style.background = full.labelColor;
  avatar.appendChild(label);
  header.appendChild(avatar);
  const idBox = el('div','store-id');
  idBox.appendChild(el('div','store-kicker','CRATE'));
  idBox.appendChild(el('h2','store-handle', full.profile.handle));
  if(full.profile.display_name) idBox.appendChild(el('div','store-displayname', full.profile.display_name));
  header.appendChild(idBox);
  if(extraBtn) header.appendChild(extraBtn);
  return header;
}

function renderLockedFriendStore(body, full){
  body.appendChild(storeAwning());
  body.appendChild(friendStoreHeader(full));
  if(full.profile.bio) body.appendChild(el('p','store-bio', full.profile.bio));

  const row = el('div','store-follow-row');
  const pending = full.relationship.following === 'pending';
  const btn = el('button','store-follow-btn' + (pending ? ' pending' : ''), pending ? 'Requested' : 'Request to follow');
  if(pending) btn.disabled = true;
  else btn.addEventListener('click', async ()=>{
    btn.disabled = true; btn.textContent = 'Requesting…';
    const r = await MizikiSocial.follow(full.profile.id);
    if(r.ok && r.status === 'accepted'){ loadAndRenderFriendStore(body, full.profile.handle); return; }
    btn.textContent = 'Requested'; btn.classList.add('pending');
  });
  row.appendChild(btn);
  body.appendChild(row);

  const card = el('div','store-locked-card');
  card.appendChild(el('h3', null, 'Crate is friends-only'));
  card.appendChild(el('p', null, 'Closed until ' + full.profile.handle + ' approves your request.'));
  body.appendChild(card);
  const grid = el('div','store-locked-grid');
  for(let i = 0; i < 9; i++) grid.appendChild(el('div','store-locked-slot'));
  body.appendChild(grid);
  body.appendChild(el('p','store-locked-note','Nothing on the shelves until you’re in.'));
}

async function shareFriendStore(handle){
  const text = 'Check out @' + handle + '’s crate on Miziki.';
  if(navigator.share){ try{ await navigator.share({text}); } catch(_e){ /* user cancelled */ } }
  else if(navigator.clipboard){ try{ await navigator.clipboard.writeText(text); } catch(_e){ /* best effort */ } }
}

function friendNowSpinningRow(full){
  const card = el('div','store-card');
  card.appendChild(el('div','store-card-count','♪'));
  const text = el('div','store-card-text');
  if(full.nowSpinning && full.nowSpinning.track_title){
    const rel = full.nowSpinning.releases || {};
    text.appendChild(el('b', null, full.nowSpinning.track_title));
    text.appendChild(el('em', null, [rel.artist, rel.title].filter(Boolean).join(' · ')));
    card.appendChild(text);
    if(full.nowSpinning.started_at) card.appendChild(el('span','store-spin-ago',
      timeAgoShort(Date.now() - new Date(full.nowSpinning.started_at).getTime())));
  } else {
    text.appendChild(el('b', null, 'Nothing spinning right now'));
    card.appendChild(text);
  }
  return card;
}

function friendPicksSection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'Staff picks'));
  section.appendChild(head);
  const row = el('div','store-picks-row');
  full.staffPicks.forEach((p, i) => {
    const tile = storePickTile(p);
    tile.style.cursor = 'pointer';
    tile.addEventListener('click', ()=> openRecordSheet(full, p,
      full.profile.handle.toUpperCase() + ' · STAFF PICK ' + (p.pin_rank || i + 1) + ' OF ' + full.staffPicks.length));
    row.appendChild(tile);
  });
  section.appendChild(row);
  if(full.staffPicks.length > 1){
    const dots = el('div','store-picks-dots');
    full.staffPicks.forEach((_, i) => dots.appendChild(el('span', i === 0 ? 'on' : null)));
    section.appendChild(dots);
    let raf = null;
    row.addEventListener('scroll', ()=>{
      if(raf) return;
      raf = requestAnimationFrame(()=>{
        raf = null;
        const w = row.firstChild ? row.firstChild.getBoundingClientRect().width + 12 : 1;
        const idx = Math.max(0, Math.min(full.staffPicks.length - 1, Math.round(row.scrollLeft / w)));
        Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i === idx));
      });
    });
  }
  return section;
}

function friendFreshSection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'Fresh for you'));
  section.appendChild(head);
  full.fresh.forEach(item => {
    const row = el('div','store-fresh-row');
    const text = el('div','store-fresh-text');
    text.appendChild(el('b', null, item.title));
    text.appendChild(el('em', null, item.artist));
    row.appendChild(text);
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'store-fresh-add' + (item.in_digging ? ' added' : '');
    add.textContent = item.in_digging ? '✓' : '+';
    if(item.in_digging) add.disabled = true;
    add.setAttribute('aria-label','Add ' + item.title + ' to your digging list');
    add.addEventListener('click', async e => {
      e.stopPropagation();
      add.disabled = true; add.classList.add('added'); add.textContent = '✓';
      await MizikiSocial.addToDigging(item.release_id, full.profile.id);
    });
    row.appendChild(add);
    row.style.cursor = 'pointer';
    row.addEventListener('click', ()=> openRecordSheet(full, item, full.profile.handle.toUpperCase() + ' · FRESH FOR YOU'));
    section.appendChild(row);
  });
  return section;
}

function friendDiggingPreview(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'Digging list'));
  section.appendChild(head);
  full.digging.forEach(item => {
    const row = el('div','store-dig-row');
    row.appendChild(el('div','store-dig-cover'));
    const text = el('div','store-dig-text');
    text.appendChild(el('b', null, item.title));
    text.appendChild(el('em', null, item.artist));
    row.appendChild(text);
    if(!item.in_my_digging && !item.in_my_crate){
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'store-fresh-add'; add.textContent = '+';
      add.setAttribute('aria-label','Add ' + item.title + ' to your digging list');
      add.addEventListener('click', async ()=>{
        add.disabled = true; add.classList.add('added'); add.textContent = '✓';
        await MizikiSocial.addToDigging(item.release_id, full.profile.id);
      });
      row.appendChild(add);
    }
    section.appendChild(row);
  });
  return section;
}

async function loadFriendCrate(full, holder, limit){
  const r = await MizikiSocial.crate(full.profile.id, {offset: 0, limit});
  holder.innerHTML = '';
  if(!r.ok || !r.items.length){
    holder.appendChild(el('p','store-loading','Nothing in the crate yet.'));
    return;
  }
  const letters = [];
  const grid = el('div','store-crate-grid');
  let lastLetter = null;
  r.items.forEach(item => {
    const letter = (item.artist || '#').trim().charAt(0).toUpperCase();
    if(letter !== lastLetter){
      lastLetter = letter;
      letters.push(letter);
      grid.appendChild(el('div','store-crate-letter-head', letter));
    }
    const cell = document.createElement('button');
    cell.type = 'button'; cell.className = 'store-crate-cell';
    const art = localAlbumArt(item.title, item.artist);
    const cover = el('div','store-crate-cover');
    if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
    cell.appendChild(cover);
    cell.appendChild(el('div','store-crate-name', item.title));
    cell.appendChild(el('div','store-crate-artist', item.artist));
    cell.addEventListener('click', ()=> openRecordSheet(full, item, full.profile.handle.toUpperCase() + ' · CRATE'));
    grid.appendChild(cell);
  });
  if(letters.length > 1){
    const bar = el('div','store-letter-bar');
    const heads = Array.from(grid.querySelectorAll('.store-crate-letter-head'));
    letters.forEach(l => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'store-letter-btn'; b.textContent = l;
      b.addEventListener('click', ()=>{
        const target = heads.find(h => h.textContent === l);
        if(target) target.scrollIntoView({block:'start'});
      });
      bar.appendChild(b);
    });
    holder.appendChild(bar);
  }
  holder.appendChild(grid);
  if(r.items.length < full.summary.records && limit < full.summary.records){
    const more = el('button','cta ghost','Browse all ' + full.summary.records + ' records');
    more.style.cssText = 'width:100%;margin-top:14px;box-sizing:border-box';
    more.addEventListener('click', ()=> loadFriendCrate(full, holder, Math.min(full.summary.records, 200)));
    holder.appendChild(more);
  }
}

function friendCrateSection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'All records'));
  section.appendChild(head);
  const holder = el('div');
  holder.appendChild(el('p','store-loading','Loading crate…'));
  section.appendChild(holder);
  loadFriendCrate(full, holder, 60);
  return section;
}

function friendActivitySection(full){
  const section = el('div','store-section');
  const head = el('div','store-section-head'); head.appendChild(el('h2', null, 'Recently at the counter'));
  section.appendChild(head);
  const holder = el('div');
  holder.appendChild(el('p','store-loading','Loading…'));
  section.appendChild(holder);
  MizikiSocial.homeFeed({limit:50}).then(r => {
    holder.innerHTML = '';
    const mine = (r.ok ? r.events : []).filter(e => e.actor_id === full.profile.id).slice(0, 5);
    if(!mine.length){ holder.appendChild(el('p','store-loading','Nothing recent.')); return; }
    mine.forEach(e => holder.appendChild(el('div','store-activity-row', feedEventText(e))));
  });
  return section;
}

function renderFriendStoreContent(body, full){
  body.appendChild(storeAwning());
  const share = el('button','store-share-icon','↗');
  share.setAttribute('aria-label','Share this crate');
  share.addEventListener('click', ()=> shareFriendStore(full.profile.handle));
  body.appendChild(friendStoreHeader(full, share));
  if(full.profile.bio) body.appendChild(el('p','store-bio', full.profile.bio));

  const row = el('div','store-follow-row');
  const isFollowing = full.relationship.following === 'accepted';
  const btn = el('button','store-follow-btn' + (isFollowing ? ' following' : ''), isFollowing ? 'Following' : 'Follow');
  btn.addEventListener('click', async ()=>{
    btn.disabled = true;
    if(isFollowing) await MizikiSocial.unfollow(full.profile.id);
    else await MizikiSocial.follow(full.profile.id);
    loadAndRenderFriendStore(body, full.profile.handle);
  });
  row.appendChild(btn);
  body.appendChild(row);

  const stats = el('div','store-stats');
  stats.appendChild(storeStat('Records', full.summary.records));
  stats.appendChild(storeStat('Staff picks', full.summary.pins));
  stats.appendChild(storeStat('In common', full.summary.in_common || 0, true));
  body.appendChild(stats);

  body.appendChild(friendNowSpinningRow(full));
  // DA5 (docs/DAY_ARC.md): only when this friend has actually turned the
  // Privacy screen's own "Share my listening rhythm" switch on and has
  // enough plays to show anything — get_listening_rhythm() (007_rhythm.sql)
  // already came back null for every other case (not shared, not enough
  // plays, this viewer isn't allowed to see it, or signed out), so a plain
  // truthiness check here is the whole gate.
  if(full.listeningRhythm){
    const rhythmHost = el('div', null);
    body.appendChild(rhythmHost);
    renderSharedRhythmCard(rhythmHost, full.listeningRhythm);
  }
  if(full.staffPicks.length) body.appendChild(friendPicksSection(full));
  if(full.fresh && full.fresh.length) body.appendChild(friendFreshSection(full));
  if(full.diggingShared && full.digging.length) body.appendChild(friendDiggingPreview(full));
  body.appendChild(friendCrateSection(full));
  body.appendChild(friendActivitySection(full));
}

/* ---- record sheet (frame 04) ---- */
export function openRecordSheet(full, item, kicker){
  $('#recordSheetKicker').textContent = kicker || full.profile.handle.toUpperCase();
  renderRecordSheetBody(full, item);
  $('#recordSheetOverlay').classList.add('open');
  $('#recordSheetOverlay').setAttribute('aria-hidden','false');
}
export function closeRecordSheet(){
  $('#recordSheetOverlay').classList.remove('open');
  $('#recordSheetOverlay').setAttribute('aria-hidden','true');
}

function renderRecordSheetBody(full, item){
  const body = $('#recordSheetBody'); body.innerHTML = '';
  const cover = el('div','record-cover');
  const art = localAlbumArt(item.title, item.artist);
  if(art){ const im = document.createElement('img'); im.src = art; im.alt = ''; cover.appendChild(im); }
  body.appendChild(cover);
  body.appendChild(el('h3','record-title', item.title));
  body.appendChild(el('p','record-artist', [item.artist, item.year].filter(Boolean).join(' · ')));
  if(item.quality_tier){
    const chips = el('div','record-chips');
    chips.appendChild(el('span','record-chip', STORE_TIER_LABEL[item.quality_tier] || ''));
    body.appendChild(chips);
  }
  if(item.rating){
    body.appendChild(el('div','record-rating-label', full.profile.handle + '’s rating'));
    body.appendChild(el('div','record-stars', '★'.repeat(item.rating) + '☆'.repeat(5 - item.rating)));
  }
  if(item.sleeve_note) body.appendChild(el('div','record-note', item.sleeve_note));
  const owned = 'in_my_crate' in item ? item.in_my_crate : false;
  const inDigging = 'in_my_digging' in item ? item.in_my_digging : false;
  body.appendChild(el('p','record-owned', owned ? 'Already in your crate.' : 'Not in your crate yet.'));
  const stack = el('div','stack social-stack');
  if(!owned){
    const addBtn = el('button','cta', inDigging ? 'In your digging list' : 'Add to digging list');
    if(inDigging) addBtn.disabled = true;
    addBtn.addEventListener('click', async ()=>{
      addBtn.disabled = true; addBtn.textContent = 'Added to digging list';
      await MizikiSocial.addToDigging(item.release_id, full.profile.id);
    });
    stack.appendChild(addBtn);
  }
  const listen = el('button','cta ghost','Listen elsewhere ↗');
  listen.addEventListener('click', ()=>{
    const q = encodeURIComponent([item.artist, item.title].filter(Boolean).join(' '));
    window.open('https://www.google.com/search?q=' + q, '_blank', 'noopener');
  });
  stack.appendChild(listen);
  body.appendChild(stack);
}
