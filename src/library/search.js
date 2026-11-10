/* ================= library-wide search + sort =================
   Search matches artist/album/track title and groups results by type
   rather than interleaving them. Sort applies
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
import { byName, trackSort, allIdx, idxOf } from './model.js';
import { albumKey, trackIdentityKey, trackTier } from '../record-art/tiers.js';
import { emptyDetails } from './tags/index.js';
import { setQueue } from '../player/queue.js';
import { isFavorite } from './favorites.js';
import { openPersonOrArtist, personEntryFor, PERSON_ROLE_KEYS } from './credits.js';
import { queueSave } from '../storage/meta.js';
import { renderTracks, groupRow, songRow, artistRow, playlistMosaicArt, openAlbumFromLibrary } from './view.js';
import { openLayer, closeLayer } from '../shell/nav-stack.js';

const LIBRARY_SORTS = [['artist','Artist'],['album','Album'],['added','Added'],['played','Played'],['sessions','Sessions']];

// RF8 (docs/12_REFINE.md), restyled by LB7 (docs/36A_LIBRARY_AND_LAUNCH.md
// decision 4): one line under the tabs — the sort label is now a pill
// chip ("By artist") reusing the crate's own .crate-section-chip class
// (10-crate.css, LB5/LB6) rather than a second, near-identical chip style;
// the count moves out to plain muted text on the right ("396 songs"),
// replacing the old mono-caps "By Artist ▾ · 396 SONGS" line. count/unit
// are optional (the album-detail view's own tracklist has no top-level
// count to show) and, when given, sit after the chip.
export function librarySortBar(count, unit){
  const bar = el('div','sortbar');
  const label = LIBRARY_SORTS.find(([k]) => k === S.librarySort);
  const toggle = el('button','crate-section-chip');
  toggle.setAttribute('aria-label','Sort options');
  toggle.setAttribute('aria-haspopup','true');
  toggle.textContent = 'By ' + (label ? label[1].toLowerCase() : '');
  toggle.addEventListener('click', openSortMenu);
  bar.appendChild(toggle);
  if(count != null) bar.appendChild(el('span','sortbar-count', count + ' ' + String(unit).toLowerCase()));
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
      S.librarySort = k; queueSave(); renderTracks(); closeLayer('sort-menu');
    });
    host.appendChild(b);
  });
  $('#sortMenuOverlay').classList.add('open');
  $('#sortMenuOverlay').setAttribute('aria-hidden','false');
  // Was a plain classList toggle with no Back/Escape/tap-outside support —
  // an accepted NV2 gap (src/wiring/overlays.js's own comment), closed now
  // per Ken's "easily close any menu" request.
  openLayer('sort-menu', closeSortMenu, { container: $('#sortMenuOverlay') });
}
export function closeSortMenu(){
  $('#sortMenuOverlay').classList.remove('open');
  $('#sortMenuOverlay').setAttribute('aria-hidden','true');
}

export function librarySortComparator(_mode){
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

// LB9 (docs/36A_LIBRARY_AND_LAUNCH.md, decision 14): playlists join the
// searchable set -- matched by name only (there's no sensible reading of
// "artist:Theo" against a playlist), and only for a plain-text query (a
// field: token is track-only syntax, so a query that's fields-only, or
// mixes fields with text, never browses playlists -- judgment call, flagged
// in the PR). Indices into S.playlists, not the objects themselves, same
// "hand back an index, resolve the live object at render time" shape
// albums/artists already follow with their own name strings.
export function searchLibrary(query){
  const parsed = parseSearchQuery(query);
  const textQ = normKey(parsed.text);
  const artists = new Set(), albums = new Set(), people = new Set(), genres = new Set(), songs = [];
  const playlists = [];
  if(textQ && !parsed.fields.length){
    S.playlists.forEach((pl, n) => { if(normKey(pl.name).includes(textQ)) playlists.push(n); });
  }
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
  return { artists: [...artists].sort(byName), albums: [...albums].sort(byName), songs, playlists,
    people: [...people].sort(byName), genres: [...genres].sort(byName) };
}

// ---- LB9: type filters, the hint line, and "Top result" --------------
// Pure helpers, kept DOM-free so they're directly unit-testable (search.js
// otherwise needs a fairly wide mock.module() preamble just to import, same
// as every other function in this file -- these three don't add to that
// cost for a test that only wants the selection logic).

// Decision 14's own four types, "All" first. Labels, not keys, are what the
// chips show -- "Records" (not "Albums") matches the addendum's own
// wording and LB7's "By album" sort label, even though the result shape
// underneath is still keyed "albums" throughout this module (searchLibrary(),
// the crate model, etc. all already say "albums" everywhere else).
export const SEARCH_TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'songs', label: 'Songs' },
  { key: 'albums', label: 'Records' },
  { key: 'artists', label: 'Artists' },
  { key: 'playlists', label: 'Playlists' },
];

// Which of searchLibrary()'s own result arrays a non-"all" filter shows.
// Returns null for 'all' (and any unknown key), since "all" isn't one list
// -- it's the Top result plus every type's own capped section.
export function resultsForFilter(results, filterKey){
  switch(filterKey){
    case 'songs': return results.songs;
    case 'albums': return results.albums;
    case 'artists': return results.artists;
    case 'playlists': return results.playlists;
    default: return null;
  }
}

// "Searching artist: Theo" -- shown only when the query actually used the
// field: syntax (decision 14's own example), never for a plain-text query.
// Multiple fields join with ", "; free text alongside a field (e.g.
// "artist:Theo night") is left out of the hint itself -- the field is what
// a listener would otherwise have to already know the syntax to notice,
// which is the whole reason this hint exists; the plain words they typed
// alongside it need no explaining.
export function searchHintText(fields){
  if(!fields || !fields.length) return null;
  return 'Searching ' + fields.map(f => `${f.key}: ${f.value}`).join(', ');
}

// "A 'Top result' section (the best single match of any type)" -- an
// exact (case/diacritic-insensitive) match on the full query wins outright,
// checked in this type order (an arbitrary but documented priority: a
// record or an artist is usually what a one-word query is "about" more
// than one of its own songs, with a playlist -- a listener's own naming,
// rather than tag data -- next); failing that, the first item of the
// highest-priority non-empty category. `lookup` resolves an albums/artists
// item (plain strings already) and a playlists/songs item (an index) to
// its own comparable label, kept as parameters rather than reaching for S
// directly so this stays callable with plain fixtures in a test.
const TOP_RESULT_ORDER = ['albums', 'artists', 'playlists', 'songs'];
export function pickTopResult(results, textQuery, lookup){
  if(!textQuery) return null;
  const q = normKey(textQuery);
  const labelFor = (type, item) => (type === 'albums' || type === 'artists') ? item : lookup(type, item);
  for(const type of TOP_RESULT_ORDER){
    const items = results[type] || [];
    const exact = items.find(item => normKey(labelFor(type, item)) === q);
    if(exact !== undefined) return { type, ref: exact };
  }
  for(const type of TOP_RESULT_ORDER){
    const items = results[type] || [];
    if(items.length) return { type, ref: items[0] };
  }
  return null;
}
function topResultLookup(type, item){
  if(type === 'playlists') return S.playlists[item] ? S.playlists[item].name : '';
  if(type === 'songs') return S.tracks[item] ? S.tracks[item].tags.title : '';
  return item;
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

// ---- LB9: search results, grouped by type with Top result leading --------
// Replaces step 7e/NV6's own canFilterInPlace()/filterSearchInPlace() fast
// path (keeping an already-rendered result list's rows in step with each
// new keystroke, rather than rebuilding): capped three-per-type lists with
// a "See all" overflow, a Top result pulled from across every type, and a
// filter that can swap which single type is showing all make "patch the
// existing rows" far more bookkeeping than it's worth now — a result
// crossing in or out of its own three-row cap, or the Top result itself
// changing type, isn't a case of some rows simply leaving and others
// simply staying the way a single flat list's substring-narrowing was.
// Removed per CLAUDE.md's "one in, one out": every render here is a plain
// rebuild, same as any other view in src/library/view.js.
const SEARCH_RESULT_CAP = 3;

// LB9 point 2: the active type filter ('all' by default), module-scoped
// the same way RF8's old searchChipsExpanded was — it's a transient view
// state of this one search session, not anything worth saving to S/prefs.
let activeSearchFilter = 'all';
export function getSearchFilter(){ return activeSearchFilter; }
export function setSearchFilter(key){ activeSearchFilter = key; }
export function resetSearchFilter(){ activeSearchFilter = 'all'; }

function searchSeeAllButton(n, type, label){
  const b = el('button', 'search-see-all', `See all ${n} ${label.toLowerCase()} ›`);
  b.type = 'button';
  b.addEventListener('click', () => { setSearchFilter(type); renderTracks(); });
  return b;
}

function appendAlbumRows(host, albums, textQ){
  albums.forEach(album => {
    const idx = allIdx().filter(i => S.tracks[i].tags.album === album);
    const artist = S.tracks[idx[0]].tags.albumArtist;
    const row = groupRow(album, artist + ' · ' + idx.length + (idx.length===1?' track':' tracks'),
      idx, () => openAlbumFromLibrary(album, idx));
    host.appendChild(highlightRowLabel(row, '.g-text b', album, textQ));
  });
}
function appendArtistRows(host, artists, textQ, goto){
  artists.forEach(artist => {
    const idx = allIdx().filter(i => S.tracks[i].tags.artist === artist);
    const row = artistRow(artist, idx, () => goto('artists', artist));
    host.appendChild(highlightRowLabel(row, '.g-text b', artist, textQ));
  });
}
// Playlists show their own mosaic (LB3, src/library/playlist-mosaic.js),
// at .g-art's own 44px box so a playlist hit sits at the same row height
// as every other search row.
function searchPlaylistRow(n, textQ, openPlaylist){
  const pl = S.playlists[n];
  const present = pl.items.map(idxOf).filter(i => i >= 0);
  const b = el('button', 'grouprow search-playlist-row');
  const art = el('span', 'g-art search-pl-mosaic');
  art.appendChild(playlistMosaicArt(pl, present));
  b.appendChild(art);
  const box = el('span', 'g-text');
  box.appendChild(el('b', null, pl.name));
  box.appendChild(el('em', null, present.length + (present.length===1?' song':' songs')));
  b.appendChild(box);
  b.appendChild(el('span', 'g-chev', '›'));
  b.addEventListener('click', () => openPlaylist(n));
  return highlightRowLabel(b, '.g-text b', pl.name, textQ);
}
function appendPlaylistRows(host, playlistIdxs, textQ, openPlaylist){
  playlistIdxs.forEach(n => host.appendChild(searchPlaylistRow(n, textQ, openPlaylist)));
}
function appendSongRows(host, songIdxs, textQ){
  if(!songIdxs.length) return;
  const ul = el('ul','tracklist');
  songIdxs.forEach((i, pos) => {
    const row = songRow(i, songIdxs, pos);
    ul.appendChild(highlightRowLabel(row, '.t-name b', S.tracks[i].tags.title, textQ));
  });
  host.appendChild(ul);
}

// `trueCount` (defaulting to items.length) is the type's real total match
// count, used only for "See all {n} {type}" -- callers that already
// excluded the Top result from `items` (so it isn't drawn twice) still
// want that link, when it shows at all, to name the type's actual total,
// since tapping it switches to the full, unexcluded list for that type
// (renderSingleTypeResults() below).
function appendCappedSection(host, items, label, type, renderRows, trueCount = items.length){
  if(!items.length) return;
  host.appendChild(el('p','note', label));
  renderRows(host, items.slice(0, SEARCH_RESULT_CAP));
  if(trueCount > SEARCH_RESULT_CAP) host.appendChild(searchSeeAllButton(trueCount, type, label));
}

function appendTopResultSection(host, top, textQ, goto, openPlaylist){
  host.appendChild(el('p','note','Top result'));
  if(top.type === 'albums') appendAlbumRows(host, [top.ref], textQ);
  else if(top.type === 'artists') appendArtistRows(host, [top.ref], textQ, goto);
  else if(top.type === 'playlists') appendPlaylistRows(host, [top.ref], textQ, openPlaylist);
  else appendSongRows(host, [top.ref], textQ);
}

// decision 14's four type filters, each showing every one of its own
// matches (no cap, no Top result -- that's an "all" idea only).
function renderSingleTypeResults(host, filter, results, textQ, goto, openPlaylist, query){
  const items = resultsForFilter(results, filter);
  if(!items.length){ noResultsNote(host, query); return; }
  if(filter === 'albums') appendAlbumRows(host, items, textQ);
  else if(filter === 'artists') appendArtistRows(host, items, textQ, goto);
  else if(filter === 'playlists') appendPlaylistRows(host, items, textQ, openPlaylist);
  else appendSongRows(host, items, textQ);
}

// decision 14 point 3's own wording, with a "Clear" text link (UN5's
// empty-note posture, at search-result scale rather than a full card) that
// clears the query and returns to whichever Songs/Albums/Artists/Playlists/
// crate tab was showing underneath -- the same thing the header's own ×
// clear button already does.
function noResultsNote(host, query){
  const wrap = host.appendChild(el('div','search-no-results'));
  wrap.appendChild(el('p','note', `Nothing in your library matches "${query}".`));
  const clear = el('button','search-see-all','Clear');
  clear.type = 'button';
  clear.addEventListener('click', clearSearchQuery);
  wrap.appendChild(clear);
}
export function clearSearchQuery(){
  const input = $('#librarySearch'); if(!input) return;
  input.value = '';
  const clearBtn = $('#hdrSearchClear'); if(clearBtn) clearBtn.style.display = 'none';
  resetSearchFilter();
  renderTracks();
}

export function renderSearchResults(host, query){
  const results = searchLibrary(query);
  const parsed = parseSearchQuery(query);
  const textQ = parsed.text.trim();
  updateSearchHint(parsed.fields);
  updateSearchFilterChipsState();
  const anyMatches = results.artists.length || results.albums.length || results.songs.length
    || results.people.length || results.genres.length || results.playlists.length;
  if(!anyMatches){ noResultsNote(host, query); return; }

  // leaving the search field (its own goto()/openPlaylist() below, and
  // the People/Genres rows further down) always lands back on a plain,
  // unfiltered library view -- the type filter is this search session's
  // own state, not something that should still be "Playlists" the next
  // time the field opens.
  const goto = (mode, group) => { S.view.mode = mode; S.view.group = group; S.view.artistAlbum = null; $('#librarySearch').value = ''; resetSearchFilter(); renderTracks(); };
  const openPlaylist = n => { $('#librarySearch').value = ''; resetSearchFilter(); S.view.mode = 'playlists'; S.view.playlist = n; renderTracks(); };

  const filter = getSearchFilter();
  if(filter !== 'all'){
    renderSingleTypeResults(host, filter, results, textQ, goto, openPlaylist, query);
    return;
  }

  const top = pickTopResult(results, textQ, topResultLookup);
  if(top) appendTopResultSection(host, top, textQ, goto, openPlaylist);
  // the item already shown as Top result doesn't also repeat in its own
  // type's capped section just below it.
  const sans = (type, items) => (top && top.type === type) ? items.filter(it => it !== top.ref) : items;

  appendCappedSection(host, sans('albums', results.albums), 'Records', 'albums', (h, items) => appendAlbumRows(h, items, textQ), results.albums.length);
  appendCappedSection(host, sans('artists', results.artists), 'Artists', 'artists', (h, items) => appendArtistRows(h, items, textQ, goto), results.artists.length);
  appendCappedSection(host, sans('playlists', results.playlists), 'Playlists', 'playlists', (h, items) => appendPlaylistRows(h, items, textQ, openPlaylist), results.playlists.length);
  appendCappedSection(host, sans('songs', results.songs), 'Songs', 'songs', (h, items) => appendSongRows(h, items, textQ), results.songs.length);

  // People/Genres (CREDITS spec §3) aren't one of decision 14's four
  // types, so they carry no filter chip of their own and no cap -- they
  // only ever show under "All", same visibility they always had.
  if(results.people.length){
    host.appendChild(el('p','note','People'));
    results.people.forEach(name => {
      const entry = personEntryFor(name);
      const count = entry ? new Set(entry.entries.map(e => e.trackIdx)).size : 0;
      const row = groupRow(name, count + (count===1?' credit':' credits'), [],
        () => { $('#librarySearch').value = ''; resetSearchFilter(); openPersonOrArtist(name); });
      host.appendChild(highlightRowLabel(row, '.g-text b', name, textQ));
    });
  }
  if(results.genres.length){
    host.appendChild(el('p','note','Genres'));
    results.genres.forEach(genre => {
      const idx = allIdx().filter(i => S.tracks[i].details && S.tracks[i].details.genre === genre);
      const row = groupRow(genre, idx.length + (idx.length===1?' track':' tracks'), idx,
        () => { $('#librarySearch').value = ''; resetSearchFilter(); setQueue(idx, 0, true); });
      host.appendChild(highlightRowLabel(row, '.g-text b', genre, textQ));
    });
  }
}

// ---- LB9 point 2: the type-filter chips + the field-syntax hint line -----
// Replaces RF8's own field-name/smart-filter chips (artist:/album:/year:/
// More) -- the typed syntax itself (parseSearchQuery(), trackMatchesField()
// above) is unchanged and still works when typed; only the discoverability
// chips change. Built once (main.js, same as renderSearchChips() used to
// be), then only re-painted for its pressed state on every search render.
export function renderSearchFilters(){
  const host = $('#searchChips');
  if(!host) return;
  host.innerHTML = '';
  SEARCH_TYPE_FILTERS.forEach(({ key, label }) => {
    const chip = el('button','search-chip', label);
    chip.type = 'button';
    chip.dataset.filter = key;
    chip.setAttribute('aria-pressed', String(key === activeSearchFilter));
    chip.addEventListener('click', () => { setSearchFilter(key); renderTracks(); });
    host.appendChild(chip);
  });
}
export function updateSearchFilterChipsState(){
  const host = $('#searchChips');
  if(!host || typeof host.querySelectorAll !== 'function') return;
  host.querySelectorAll('.search-chip').forEach(chip => {
    const pressed = chip.dataset.filter === activeSearchFilter;
    chip.setAttribute('aria-pressed', String(pressed));
    chip.classList.toggle('is-active', pressed);
  });
}
function updateSearchHint(fields){
  const hint = $('#searchHint');
  if(!hint) return;
  const text = searchHintText(fields);
  hint.textContent = text || '';
  hint.style.display = text ? '' : 'none';
}
export function updateSearchChipsVisibility(){
  const input = $('#librarySearch'), chips = $('#searchChips'), hint = $('#searchHint');
  if(!input || !chips) return;
  const hasText = !!input.value.trim();
  chips.style.display = (hasText && S.tracks.length > 0) ? 'flex' : 'none';
  if(hint && !hasText) hint.style.display = 'none';
}
