/* ================= library-wide search + sort =================
   Moved out of main.js (step 5e). Search matches artist/album/track title
   and groups results by type rather than interleaving them. Sort applies
   to whichever top-level list (Songs or Albums) is showing; session count
   is meaningful at the album scope, so on the Songs list it sorts by the
   containing album's count rather than being omitted. Preference persists
   like other prefs (see PLAYBACK spec §4).

   ================= tag-aware search (CREDITS spec §3) =====================
   Free text matches artist/album/title plus people/genre/label/catalog;
   fielded tokens (artist:/album:/title:/genre:/year:/label:/cat:/credit:/
   composer:/producer:/format:/rate:/bits:/is:) combine with free text and
   each other by AND. An unknown field name is just treated as plain text. */
import { S } from '../state.js';
import { $, el } from '../util/dom.js';
import { normKey } from '../util/text.js';
import { byName, trackSort, allIdx } from './model.js';
import { albumKey, trackIdentityKey, trackTier } from '../record-art/tiers.js';
import { emptyDetails } from './tags/index.js';
import { setQueue } from '../player/queue.js';
import { isFavorite } from './favorites.js';
import { openPersonOrArtist, personEntryFor, PERSON_ROLE_KEYS } from './credits.js';
// Temporary circular imports back to main.js (rule 8 in CLAUDE.md) —
// persistence/library-rendering functions not yet extracted. Used only
// inside the functions below, never at module top level.
import { queueSave, renderTracks, groupRow, songRow } from '../main.js';

const LIBRARY_SORTS = [['artist','Artist'],['album','Album'],['added','Added'],['played','Played'],['sessions','Sessions']];

export function librarySortBar(){
  const bar = el('div','sortbar');
  const label = LIBRARY_SORTS.find(([k]) => k === S.librarySort);
  bar.appendChild(el('span', null, 'Sort: ' + (label ? label[1] : '')));
  const toggle = el('button','sort-toggle');
  toggle.setAttribute('aria-label','Sort options');
  toggle.setAttribute('aria-haspopup','true');
  toggle.appendChild(el('span')); toggle.appendChild(el('span')); toggle.appendChild(el('span'));
  toggle.addEventListener('click', openSortMenu);
  bar.appendChild(toggle);
  return bar;
}

function openSortMenu(){
  const host = $('#sortMenuOptions');
  host.innerHTML = '';
  LIBRARY_SORTS.forEach(([k,label]) => {
    const b = document.createElement('button');
    b.className = 'cta' + (k === S.librarySort ? '' : ' ghost');
    b.textContent = label;
    b.addEventListener('click', () => {
      S.librarySort = k; queueSave(); renderTracks(); closeSortMenu();
    });
    host.appendChild(b);
  });
  $('#sortMenuOverlay').classList.add('open');
  $('#sortMenuOverlay').setAttribute('aria-hidden','false');
}
export function closeSortMenu(){
  $('#sortMenuOverlay').classList.remove('open');
  $('#sortMenuOverlay').setAttribute('aria-hidden','true');
}

export function librarySortComparator(mode){
  const key = S.librarySort;
  return (a, b) => {
    const ta = S.tracks[a], tb = S.tracks[b];
    switch(key){
      case 'album': return byName(ta.tags.album, tb.tags.album) || trackSort(a, b);
      case 'added': return (tb.addedAt||0) - (ta.addedAt||0);
      case 'played': return (S.trackLastPlayed[trackIdentityKey(tb)]||0) - (S.trackLastPlayed[trackIdentityKey(ta)]||0);
      case 'sessions': return (S.sessionCounts[albumKey(tb)]||0) - (S.sessionCounts[albumKey(ta)]||0) || byName(ta.tags.title, tb.tags.title);
      default: return byName(ta.tags.artist, tb.tags.artist) || byName(ta.tags.album, tb.tags.album) || trackSort(a, b);
    }
  };
}

export function sortAlbumGroups(groups){
  const key = S.librarySort;
  return groups.slice().sort((a, b) => {
    const [albumA, idxA] = a, [albumB, idxB] = b;
    const sampleA = S.tracks[idxA[0]], sampleB = S.tracks[idxB[0]];
    switch(key){
      case 'album': return byName(albumA, albumB);
      case 'added': return Math.max(...idxB.map(i => S.tracks[i].addedAt||0)) - Math.max(...idxA.map(i => S.tracks[i].addedAt||0));
      case 'played': return (S.albumLastPlayed[albumKey(sampleB)]||0) - (S.albumLastPlayed[albumKey(sampleA)]||0);
      case 'sessions': return (S.sessionCounts[albumKey(sampleB)]||0) - (S.sessionCounts[albumKey(sampleA)]||0);
      default: return byName(sampleA.tags.albumArtist, sampleB.tags.albumArtist) || byName(albumA, albumB);
    }
  });
}

const SEARCH_FIELD_KEYS = new Set(['artist','album','title','genre','year','label','cat','credit','composer','producer','format','rate','bits','is']);
const SEARCH_SMART_FILTERS = ['new','unplayed','hires','lossy','favorite'];

function trackAllCreditNames(t){
  const d = t.details; if(!d) return [];
  const names = [];
  PERSON_ROLE_KEYS.forEach(k => (d[k]||[]).forEach(n => names.push(n)));
  (d.performers||[]).forEach(p => names.push(p.name));
  return names;
}

function parseNumericToken(raw, kSuffix){
  const m = /^(>=|<=|>|<)?(.+)$/.exec(raw.trim());
  if(!m) return null;
  const op = m[1] || '=';
  let numStr = m[2], mult = 1;
  if(kSuffix && /k$/i.test(numStr)){ mult = 1000; numStr = numStr.slice(0, -1); }
  const value = parseFloat(numStr) * mult;
  return isNaN(value) ? null : {op, value};
}
function numMatches(actual, parsed){
  if(!parsed || actual === null || actual === undefined) return false;
  switch(parsed.op){
    case '>=': return actual >= parsed.value;
    case '<=': return actual <= parsed.value;
    case '>': return actual > parsed.value;
    case '<': return actual < parsed.value;
    default: return actual === parsed.value;
  }
}
function parseYearToken(raw){
  raw = raw.trim();
  const range = /^(\d{4})-(\d{4})$/.exec(raw);
  if(range) return {type:'range', lo:+range[1], hi:+range[2]};
  const cmp = /^(>=|<=|>|<)(\d{4})$/.exec(raw);
  if(cmp) return {type:'cmp', op:cmp[1], value:+cmp[2]};
  if(/^\d{4}$/.test(raw)) return {type:'eq', value:+raw};
  return null;
}
function yearMatches(actual, parsed){
  if(!parsed || !actual) return false;
  if(parsed.type === 'range') return actual >= parsed.lo && actual <= parsed.hi;
  if(parsed.type === 'eq') return actual === parsed.value;
  return numMatches(actual, parsed);
}

export function parseSearchQuery(raw){
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const fields = [], text = [];
  tokens.forEach(tok => {
    const m = /^([a-zA-Z]+):(.+)$/.exec(tok);
    if(m && SEARCH_FIELD_KEYS.has(m[1].toLowerCase())) fields.push({key:m[1].toLowerCase(), value:m[2]});
    else text.push(tok);
  });
  return {fields, text: text.join(' ')};
}

function trackMatchesField(t, field){
  const d = t.details || emptyDetails();
  const q = normKey(field.value);
  switch(field.key){
    case 'artist': return normKey(t.tags.artist).includes(q) || normKey(t.tags.albumArtist).includes(q);
    case 'album': return normKey(t.tags.album).includes(q);
    case 'title': return normKey(t.tags.title).includes(q);
    case 'genre': return normKey(d.genre).includes(q);
    case 'label': return normKey(d.label).includes(q);
    case 'cat': return normKey(d.catalog).includes(q);
    case 'credit': return trackAllCreditNames(t).some(n => normKey(n).includes(q));
    case 'composer': return (d.composers||[]).some(n => normKey(n).includes(q));
    case 'producer': return (d.producers||[]).some(n => normKey(n).includes(q));
    case 'format': return normKey(t.meta.codec).includes(q);
    case 'year': return yearMatches(d.year, parseYearToken(field.value));
    case 'rate': return numMatches(t.meta.rate, parseNumericToken(field.value, true));
    case 'bits': return numMatches(t.meta.bits, parseNumericToken(field.value, false));
    case 'is': {
      const v = field.value.toLowerCase();
      if(v === 'favorite') return isFavorite(t.id);
      if(v === 'unplayed') return !(S.trackPlayCounts[trackIdentityKey(t)] > 0);
      if(v === 'hires') return trackTier(t) === 3;
      if(v === 'lossy') return trackTier(t) === 1;
      if(v === 'new') return (Date.now() - (t.addedAt || 0)) < 14 * 24 * 3600 * 1000;
      return false;
    }
    default: return true;   // unknown field name — never filtered out
  }
}

export function searchLibrary(query){
  const parsed = parseSearchQuery(query);
  const textQ = normKey(parsed.text);
  const artists = new Set(), albums = new Set(), people = new Set(), genres = new Set(), songs = [];
  S.tracks.forEach((t, i) => {
    if(!parsed.fields.every(f => trackMatchesField(t, f))) return;
    if(!textQ){ songs.push(i); return; }
    const d = t.details || emptyDetails();
    if(normKey(t.tags.artist).includes(textQ) || normKey(t.tags.albumArtist).includes(textQ)) artists.add(t.tags.artist);
    if(normKey(t.tags.album).includes(textQ)) albums.add(t.tags.album);
    if(normKey(t.tags.title).includes(textQ)) songs.push(i);
    if(d.genre && normKey(d.genre).includes(textQ)) genres.add(d.genre);
    if((d.label && normKey(d.label).includes(textQ)) || (d.catalog && normKey(d.catalog).includes(textQ))){
      if(!songs.includes(i)) songs.push(i);
    }
    trackAllCreditNames(t).forEach(n => { if(normKey(n).includes(textQ)) people.add(n); });
  });
  return { artists: [...artists].sort(byName), albums: [...albums].sort(byName), songs,
    people: [...people].sort(byName), genres: [...genres].sort(byName) };
}

// wraps each case-insensitive occurrence of query in the result's visible
// label text with <mark class="hl"> (amber, weight 600 — S1 §4)
export function highlightMatches(text, query){
  const frag = document.createDocumentFragment();
  if(!query){ frag.appendChild(document.createTextNode(text)); return frag; }
  const lowerText = text.toLowerCase(), lowerQ = query.toLowerCase();
  let i = 0;
  while(i < text.length){
    const at = lowerText.indexOf(lowerQ, i);
    if(at < 0){ frag.appendChild(document.createTextNode(text.slice(i))); break; }
    if(at > i) frag.appendChild(document.createTextNode(text.slice(i, at)));
    const mark = el('mark','hl', text.slice(at, at + query.length));
    frag.appendChild(mark);
    i = at + query.length;
  }
  return frag;
}
export function highlightRowLabel(row, selector, text, query){
  const target = row.querySelector(selector);
  if(!target || !query) return row;
  target.textContent = '';
  target.appendChild(highlightMatches(text, query));
  return row;
}

export function renderSearchResults(host, query){
  const results = searchLibrary(query);
  if(!results.artists.length && !results.albums.length && !results.songs.length
     && !results.people.length && !results.genres.length){
    host.appendChild(el('p','note','No matches for “' + query + '”.'));
    return;
  }
  const textQ = parseSearchQuery(query).text.trim();
  const goto = (mode, group) => { S.view.mode = mode; S.view.group = group; S.view.artistAlbum = null; $('#librarySearch').value = ''; renderTracks(); };
  if(results.artists.length){
    host.appendChild(el('p','note','Artists'));
    results.artists.forEach(artist => {
      const idx = allIdx().filter(i => S.tracks[i].tags.artist === artist);
      const albumCount = new Set(idx.map(i => S.tracks[i].tags.album)).size;
      const row = groupRow(artist, albumCount + (albumCount===1?' album · ':' albums · ') + idx.length
        + (idx.length===1?' track':' tracks'), idx, () => goto('artists', artist));
      host.appendChild(highlightRowLabel(row, '.g-text b', artist, textQ));
    });
  }
  if(results.albums.length){
    host.appendChild(el('p','note','Albums'));
    results.albums.forEach(album => {
      const idx = allIdx().filter(i => S.tracks[i].tags.album === album);
      const artist = S.tracks[idx[0]].tags.albumArtist;
      const row = groupRow(album, artist + ' · ' + idx.length + (idx.length===1?' track':' tracks'),
        idx, () => goto('albums', album));
      host.appendChild(highlightRowLabel(row, '.g-text b', album, textQ));
    });
  }
  if(results.people.length){
    host.appendChild(el('p','note','People'));
    results.people.forEach(name => {
      const entry = personEntryFor(name);
      const count = entry ? new Set(entry.entries.map(e => e.trackIdx)).size : 0;
      const row = groupRow(name, count + (count===1?' credit':' credits'), [],
        () => { $('#librarySearch').value = ''; openPersonOrArtist(name); });
      host.appendChild(highlightRowLabel(row, '.g-text b', name, textQ));
    });
  }
  if(results.genres.length){
    host.appendChild(el('p','note','Genres'));
    results.genres.forEach(genre => {
      const idx = allIdx().filter(i => S.tracks[i].details && S.tracks[i].details.genre === genre);
      const row = groupRow(genre, idx.length + (idx.length===1?' track':' tracks'), idx,
        () => { $('#librarySearch').value = ''; setQueue(idx, 0, true); });
      host.appendChild(highlightRowLabel(row, '.g-text b', genre, textQ));
    });
  }
  if(results.songs.length){
    host.appendChild(el('p','note','Songs'));
    const ul = el('ul','tracklist');
    results.songs.forEach((i, pos) => {
      const row = songRow(i, results.songs, pos);
      ul.appendChild(highlightRowLabel(row, '.t-name b', S.tracks[i].tags.title, textQ));
    });
    host.appendChild(ul);
  }
}

// discoverable field names + smart filters, shown while the search box is
// focused and empty (CREDITS spec §3)
export function renderSearchChips(){
  const host = $('#searchChips');
  if(!host) return;
  host.innerHTML = '';
  const chips = [...SEARCH_FIELD_KEYS].map(k => k + ':').concat(SEARCH_SMART_FILTERS.map(f => 'is:' + f));
  chips.forEach(label => {
    const chip = el('button','search-chip', label);
    chip.addEventListener('click', () => {
      const input = $('#librarySearch');
      input.value = (input.value.trim() ? input.value.trim() + ' ' : '') + label;
      input.focus();
      renderTracks();
    });
    host.appendChild(chip);
  });
}
export function updateSearchChipsVisibility(){
  const input = $('#librarySearch'), chips = $('#searchChips');
  if(!input || !chips) return;
  chips.style.display = (document.activeElement === input && !input.value.trim() && S.tracks.length > 0) ? 'flex' : 'none';
}
