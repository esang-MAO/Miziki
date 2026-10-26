import { S } from '../state.js';
import { el } from '../util/dom.js';
import { groupBy } from '../library/model.js';
import { albumKey, getVariantDef, variantBackground } from '../record-art/tiers.js';
import { metalBackground } from '../record-art/metals.js';
import { thumbURL } from '../library/thumbs.js';
import { peekBackgroundFor } from '../record-art/peek.js';
import { achievementsList, ownedPressingIds, ownedRarePressingIds, ownedZoetropePressingIds } from '../history/achievements.js';
// Part of the profile's own circular cluster (storefront.js/screens.js,
// see CLAUDE.md's src/profile/ entry): storefront.js imports
// storeRecordsSection() from here, screens.js imports renderRecordsScreen(),
// and this file reaches both back only from inside functions.
import { renderPressingCard } from './storefront.js';
import { renderProfile } from './screens.js';

/* ================= profile records + pressings =================
   One section for the crate and what it has earned. The profile home shows
   the first ten records (A–Z); a record with an unlocked pressing (the
   Collection) or an earned metal has its disc peeking out of the top of
   its sleeve, in that pressing — the same drawing as the crate's pull and
   the launch intro (record-art/peek.js's .peek-disc). "See all" opens the
   Records screen: All (every record, A–Z) or Pressings (the pressing
   chart, then unlocked Colors, Effects and Metals). This replaced both the
   storefront's old 60-cover "All records" grid and the Listening screen's
   separate Collection section/screen. */

export const RECORDS_PREVIEW_COUNT = 10;
const METAL_NAME = {rare:'Rare', platinum:'Platinum', gold:'Gold', silver:'Silver', bronze:'Bronze'};
const RARE_FALLBACK_BG = 'linear-gradient(155deg,#2A2018,#171310)';

function plural(n, one, many){ return n + ' ' + (n === 1 ? one : many); }

function firstTrackFor(albumId){
  for(const t of S.tracks) if(albumKey(t) === albumId) return t;
  return null;
}

// The album thumbnail, else the given art, else the album's own embedded
// art when it's still in the library (a Collection/achievement record's
// saved art pointer doesn't survive a reload).
function albumArt(albumId, fallback){
  if(thumbURL['album:' + albumId]) return thumbURL['album:' + albumId];
  if(fallback) return fallback;
  const t = firstTrackFor(albumId);
  return (t && t.art) || null;
}

// A rare has no metal gradient of its own — its disc is the album's own
// rare look, read through the same resolver the platter uses.
export function metalDisc(rec){
  if(rec.tier === 'rare'){
    const t = firstTrackFor(rec.albumId);
    return t ? peekBackgroundFor(t) : RARE_FALLBACK_BG;
  }
  return metalBackground(rec.tier) || RARE_FALLBACK_BG;
}

export function pressingDisc(rec){
  return variantBackground(getVariantDef(rec.variant)) || RARE_FALLBACK_BG;
}

export function pressingName(rec){
  const def = getVariantDef(rec.variant);
  return def ? def.name : 'Pressing';
}

// What an album has earned, metal first (the same precedence as the
// platter: rare > metal > pressing). null when nothing is unlocked yet.
export function earnedFor(albumId){
  const ach = S.achievements[albumId];
  if(ach && METAL_NAME[ach.tier]) return {kind:'metal', label:METAL_NAME[ach.tier], bg:metalDisc(ach)};
  const rec = S.collection[albumId];
  if(rec) return {kind:'pressing', label:pressingName(rec), bg:pressingDisc(rec)};
  return null;
}

// One entry per album in the library, A–Z by album name.
export function libraryRecords(){
  return groupBy('album').map(([name, idxs]) => {
    const t = S.tracks[idxs[0]];
    const albumId = albumKey(t);
    return {albumId, name: name || 'Unknown album',
      artist: t.tags.albumArtist || t.tags.artist || '', art: albumArt(albumId, t.art)};
  });
}

export function pressingCounts(){
  return {pressings: Object.keys(S.collection).length, metals: achievementsList().length};
}

export function recordsCountLine(nRecords, counts){
  const parts = [plural(nRecords, 'record', 'records')];
  if(counts.pressings) parts.push(plural(counts.pressings, 'pressing', 'pressings'));
  if(counts.metals) parts.push(plural(counts.metals, 'metal', 'metals'));
  return parts.join(' · ');
}

// "A"–"Z", or "#" for anything that doesn't start with a plain letter.
export function recordLetter(name){
  const c = String(name || '').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase();
  return /^[A-Z]$/.test(c) ? c : '#';
}

function openRecords(filter){
  S.profileView.screen = 'records';
  S.profileView.recordsFilter = filter;
  renderProfile();
}

function buildDisc(bg){
  const d = el('span','peek-disc rec-disc');
  d.setAttribute('aria-hidden','true');
  d.style.background = bg;
  d.appendChild(el('span','peek-disc-grooves'));
  d.appendChild(el('span','peek-disc-sheen'));
  return d;
}

// opts: {name, artist, art, disc, label, pulled, showText, pressingFirst}
function recordCell(opts){
  const cell = el('div','rec-cell' + (opts.pulled ? ' pulled' : ''));
  const artBox = el('div','rec-art');
  if(opts.disc) artBox.appendChild(buildDisc(opts.disc));
  const sleeve = el('div','rec-sleeve');
  if(opts.art){
    const im = document.createElement('img');
    im.src = opts.art; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async';
    sleeve.appendChild(im);
  }
  artBox.appendChild(sleeve);
  cell.appendChild(artBox);
  if(opts.showText){
    const label = opts.label ? el('span','rec-label') : null;
    if(label){
      const dot = el('span','rec-dot');
      dot.setAttribute('aria-hidden','true');
      dot.style.background = opts.disc;
      label.appendChild(dot);
      label.appendChild(el('span', null, opts.label));
    }
    if(opts.pressingFirst){
      if(label) cell.appendChild(label);
      cell.appendChild(el('span','rec-artist', opts.name));
    } else {
      cell.appendChild(el('span','rec-name', opts.name));
      cell.appendChild(el('span','rec-artist', opts.artist));
      if(label) cell.appendChild(label);
    }
  } else {
    sleeve.setAttribute('role','img');
    sleeve.setAttribute('aria-label', opts.name + (opts.artist ? ', ' + opts.artist : '') + (opts.label ? ' — ' + opts.label : ''));
  }
  return cell;
}

/* ---------- the profile home's section ---------- */
export function storeRecordsSection(){
  const records = libraryRecords();
  const counts = pressingCounts();
  const section = el('div','store-section store-records');

  const head = el('div','store-section-head store-records-head');
  const title = el('div','store-records-title');
  title.appendChild(el('h2', null, 'Records'));
  title.appendChild(el('span','store-records-count', recordsCountLine(records.length, counts)));
  head.appendChild(title);
  if(records.length || counts.pressings || counts.metals){
    const seeAll = el('button', null, 'See all ›');
    seeAll.setAttribute('aria-label','See all records');
    seeAll.addEventListener('click', ()=> openRecords('all'));
    head.appendChild(seeAll);
  }
  section.appendChild(head);

  if(!records.length){
    section.appendChild(el('p','store-loading','Nothing in the crate yet.'));
  } else {
    const grid = el('div','records-grid preview');
    let anyDisc = false;
    records.slice(0, RECORDS_PREVIEW_COUNT).forEach(r => {
      const earned = earnedFor(r.albumId);
      if(earned) anyDisc = true;
      grid.appendChild(recordCell({name:r.name, artist:r.artist, art:r.art,
        disc: earned ? earned.bg : null, label: earned ? earned.label : null}));
    });
    section.appendChild(grid);
    if(anyDisc) section.appendChild(el('p','store-records-note','A record peeking out of its sleeve has an unlocked pressing or metal.'));
    if(records.length > RECORDS_PREVIEW_COUNT){
      const more = el('button','store-records-more','Show all ' + plural(records.length, 'record', 'records') + ' ▾');
      more.addEventListener('click', ()=> openRecords('all'));
      section.appendChild(more);
    }
  }

  const row = el('button','store-records-pressings');
  const chips = el('span','store-records-chips');
  chips.setAttribute('aria-hidden','true');
  Object.values(S.collection).slice(0, 4).forEach(rec => {
    const c = el('span'); c.style.background = pressingDisc(rec); chips.appendChild(c);
  });
  const topMetal = achievementsList()[0];
  if(topMetal){ const c = el('span'); c.style.background = metalDisc(topMetal); chips.appendChild(c); }
  if(chips.childNodes.length) row.appendChild(chips);
  const text = el('span','store-records-pressings-text');
  text.appendChild(el('b', null, 'Pressings & metals'));
  text.appendChild(el('small', null, counts.pressings || counts.metals
    ? [counts.pressings ? plural(counts.pressings, 'pressing', 'pressings') : null,
       counts.metals ? plural(counts.metals, 'metal', 'metals') : null].filter(Boolean).join(' · ')
    : 'Play an album through to unlock its pressing'));
  row.appendChild(text);
  row.appendChild(el('span','g-chev','›'));
  row.addEventListener('click', ()=> openRecords('pressings'));
  section.appendChild(row);
  return section;
}

/* ---------- the Records screen ---------- */
export function renderRecordsScreen(body){
  const filter = S.profileView.recordsFilter === 'pressings' ? 'pressings' : 'all';
  const records = libraryRecords();
  const counts = pressingCounts();
  const wrap = el('div','records-screen');
  wrap.appendChild(el('div','store-records-count', recordsCountLine(records.length, counts)));

  const tabs = el('div','seg records-tabs');
  tabs.setAttribute('role','tablist');
  tabs.setAttribute('aria-label','Show');
  [['all', 'All · ' + records.length], ['pressings', 'Pressings · ' + (counts.pressings + counts.metals)]].forEach(([key, label]) => {
    const b = el('button', null, label);
    b.setAttribute('role','tab');
    b.setAttribute('aria-selected', String(key === filter));
    b.setAttribute('aria-pressed', String(key === filter));
    b.addEventListener('click', ()=>{ if(key !== filter) openRecords(key); });
    tabs.appendChild(b);
  });
  wrap.appendChild(tabs);

  if(filter === 'all') renderAllRecords(wrap, records);
  else renderPressings(wrap);
  body.appendChild(wrap);
}

function renderAllRecords(wrap, records){
  if(!records.length){
    const empty = el('div','profile-empty'); empty.appendChild(el('p', null, 'Nothing in the crate yet.'));
    wrap.appendChild(empty); return;
  }
  let letter = null, grid = null;
  records.forEach(r => {
    const l = recordLetter(r.name);
    if(l !== letter){
      letter = l;
      wrap.appendChild(el('div','records-letter', l));
      grid = el('div','records-grid');
      wrap.appendChild(grid);
    }
    const earned = earnedFor(r.albumId);
    grid.appendChild(recordCell({name:r.name, artist:r.artist, art:r.art, showText:true,
      disc: earned ? earned.bg : null, label: earned ? earned.label : null}));
  });
}

function pressingsGroup(wrap, title, items){
  if(!items.length) return;
  const head = el('div','records-group-head');
  head.appendChild(el('h3', null, title));
  head.appendChild(el('span','store-records-count', String(items.length)));
  wrap.appendChild(head);
  const grid = el('div','records-grid');
  items.forEach(item => grid.appendChild(recordCell(Object.assign({pulled:true, showText:true, pressingFirst:true}, item))));
  wrap.appendChild(grid);
}

function renderPressings(wrap){
  // PRESSINGS_110 PR8 (§7): the chart card's own owned set grew from
  // solid/effect alone to all four families — merge the three counters
  // that each own one family rather than teaching any of them the others.
  const owned = new Set([...ownedPressingIds(), ...ownedRarePressingIds(), ...ownedZoetropePressingIds()]);
  wrap.appendChild(renderPressingCard(owned, {showNumbers: true}));
  const coll = Object.values(S.collection).sort((a, b) => pressingName(a).localeCompare(pressingName(b)));
  const asItem = rec => ({name: rec.name, artist: rec.artist, art: albumArt(rec.albumId, rec.art),
    disc: pressingDisc(rec), label: pressingName(rec)});
  const colors = coll.filter(rec => rec.pattern === 'solid').map(asItem);
  const effects = coll.filter(rec => rec.pattern !== 'solid').map(asItem);
  const metals = achievementsList().map(rec => ({name: rec.name, artist: rec.artist,
    art: albumArt(rec.albumId, rec.art), disc: metalDisc(rec), label: METAL_NAME[rec.tier] || rec.tier}));
  if(!colors.length && !effects.length && !metals.length){
    const empty = el('div','profile-empty');
    empty.appendChild(el('p', null, 'Play an album through on a lossless file to unlock its pressing. Keep playing it to earn metals.'));
    wrap.appendChild(empty);
    return;
  }
  pressingsGroup(wrap, 'Colors', colors);
  pressingsGroup(wrap, 'Effects', effects);
  pressingsGroup(wrap, 'Metals', metals);
}
