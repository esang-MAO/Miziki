/* ================= crate data model =================
   Moved out of main.js's "S4: crate image tiers" section (step 7c),
   unchanged — physically sat there only because that's where the file
   happened to put it, not because grouping/sorting albums is image-tier
   work (CRATE spec §2). One crate record per album id; loose ("Unknown
   Album") tracks collapse into one pseudo-record per artist instead of
   one per track. */
import { S } from '../state.js';
import { normKey } from '../util/text.js';
import { albumKey } from '../record-art/tiers.js';
import { queueSave } from '../storage/meta.js';
import { CRATE_ALPHABET } from './constants.js';

// CR2 (docs/13_CRATE.md): "New arrivals" is the same 14-day window
// library/search.js's own `is:new` field filter already uses for a single
// track's `addedAt` — duplicated here rather than imported, the same
// "duplicate a small shared formula rather than wire two independent
// systems together" call CLAUDE.md documents for sync/images.js's own
// crop logic and player/clock.js's PHASE_COLOR table.
const NEW_ARRIVAL_WINDOW_MS = 14 * 24 * 3600 * 1000;
// CR2: "an artist with three or more records" gets its own divider inside
// a letter.
const ARTIST_DIVIDER_MIN = 3;

// CR2: staff picks are MizikiSocial's own local pin state (X.state.pins,
// already in pin-rank order — getPins()'s own doc comment), reached as
// the real global per the established "never import MizikiSocial, check
// typeof first" pattern (library/credits.js's appendCreditFriendsLine(),
// src/sync/backup.js's getSocial()/getClient()) — crate/model.js stays a
// pure, DOM-free, main.js-free module importable by its own unit tests
// with nothing to mock for this. Pins work locally (and are available)
// whether or not the user has ever signed in — see miziki-social.js's own
// freshState()/pin()/getPins().
function localStaffPickIds(){
  if(typeof MizikiSocial === 'undefined' || !MizikiSocial.getPins) return [];
  // getPins() reads X.state.pins directly with no null guard of its own
  // (miziki-social.js) -- X.state stays null until init()'s own async
  // loadState() resolves, and the crate can render (and call this) before
  // that ever happens, e.g. the very first "switch to crate" tap on a cold
  // launch. A real bug this PR's own Playwright pass caught; try/catch
  // rather than a status() check, since pins are deliberately available
  // whether or not the user has ever signed in (this file's own comment
  // just above), so there's no "not ready yet" auth state to gate on.
  try{ return MizikiSocial.getPins(); }catch(_e){ return []; }
}

function titleCaseGenre(s){
  return s.split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
function firstGenreValue(raw){ return raw ? raw.split(/[;,]/)[0].trim() : ''; }
// normKey() already lowercases/strips diacritics/collapses to [a-z0-9 ]+;
// stripping a leading article on top of that gives the brief's sort key
function crateSortKey(name){ return normKey(name).replace(/^(the|a|an)\s+/, ''); }
function crateCompareNames(a, b){
  return crateSortKey(a).localeCompare(crateSortKey(b), undefined, {numeric:true, sensitivity:'base'});
}
function crateArtistPriority(artist){ return artist === 'Unknown Artist' ? 1 : 0; }
function compareCrateArtists(a, b){
  const pa = crateArtistPriority(a), pb = crateArtistPriority(b);
  return pa !== pb ? pa - pb : crateCompareNames(a, b);
}
function crateLetterFor(artist){
  if(artist === 'Unknown Artist') return '?';
  const c = crateSortKey(artist).charAt(0);
  return /[a-z]/.test(c) ? c.toUpperCase() : '#';
}
function crateLooseArtistId(artist){ return 'loose:' + normKey(artist); }
// oldest first, the way a record store files an artist's albums; 0 (no
// year) sorts after every dated album, alphabetically among themselves —
// so an untagged library just behaves like the plain alphabetical order
function compareCrateYear(a, b){
  const ay = a.year || 0, by = b.year || 0;
  if(!ay && !by) return 0;
  if(!ay) return 1;
  if(!by) return -1;
  return ay - by;
}
export function libraryHasGenres(){ return S.tracks.some(t => t.details && firstGenreValue(t.details.genre)); }

function albumGenreFor(idx){
  const counts = new Map();
  idx.forEach((i, pos) => {
    const g = firstGenreValue(S.tracks[i].details && S.tracks[i].details.genre);
    if(!g) return;
    const key = g.toLowerCase();
    if(!counts.has(key)) counts.set(key, {count:0, display:titleCaseGenre(g), firstPos:pos});
    counts.get(key).count++;
  });
  if(!counts.size) return '';
  let best = null;
  counts.forEach(v => { if(!best || v.count > best.count || (v.count === best.count && v.firstPos < best.firstPos)) best = v; });
  return best.display;
}

// an album's year is the most common non-zero t.details.year among its
// tracks, ties going to the earliest (CRATE spec §2) — 0 means unknown
function albumYearFor(idx){
  const counts = new Map();
  idx.forEach(i => {
    const y = S.tracks[i].details && S.tracks[i].details.year;
    if(!y) return;
    counts.set(y, (counts.get(y) || 0) + 1);
  });
  if(!counts.size) return 0;
  let best = 0, bestCount = -1;
  counts.forEach((count, year) => {
    if(count > bestCount || (count === bestCount && year < best)) { best = year; bestCount = count; }
  });
  return best;
}

// CR2: "New arrivals" needs one addedAt per record, same "most recent
// track wins" rule launch/intro.js's own resolveLastPlayedAlbum() helper
// (addedByAlbum) already uses for the launch stack's own most-recent-first
// ordering — a record is "new" from the moment any of its tracks were
// added, so the latest one decides.
function albumAddedFor(idx){
  let best = 0;
  idx.forEach(i => { const a = S.tracks[i].addedAt || 0; if(a > best) best = a; });
  return best;
}

// one crate record per album id; loose ("Unknown Album") tracks collapse
// into one pseudo-record per artist instead of one per track (CRATE spec §2)
function buildCrateRecords(){
  const byAlbum = new Map(), looseByArtist = new Map();
  S.tracks.forEach((t, i) => {
    if(t.tags.album === 'Unknown Album'){
      const artistName = t.tags.artist || 'Unknown Artist';
      const key = normKey(artistName) || 'unknown';
      if(!looseByArtist.has(key)) looseByArtist.set(key, {artist:artistName, idx:[]});
      looseByArtist.get(key).idx.push(i);
      return;
    }
    const id = albumKey(t);
    if(!byAlbum.has(id)) byAlbum.set(id, []);
    byAlbum.get(id).push(i);
  });

  const records = [];
  byAlbum.forEach((idx, albumId) => {
    const tracks = idx.map(i => S.tracks[i]);
    const artistSet = new Set(tracks.map(t => t.tags.artist));
    const albumArtistSet = new Set(tracks.map(t => t.tags.albumArtist));
    let artist;
    if(albumArtistSet.size === 1) artist = [...albumArtistSet][0];
    else if(artistSet.size > 1) artist = 'Various Artists';   // different artists, no consistent albumArtist
    else artist = tracks[0].tags.artist || 'Unknown Artist';
    records.push({type:'rec', kind:'album', albumId, idx, artist, album: tracks[0].tags.album,
      year: albumYearFor(idx), trackCount: idx.length, genre: albumGenreFor(idx), addedAt: albumAddedFor(idx)});
  });
  looseByArtist.forEach(({artist, idx}) => {
    records.push({type:'rec', kind:'loose', albumId: crateLooseArtistId(artist), idx, artist,
      album:'Singles & loose tracks', year:0, trackCount: idx.length, genre:'', addedAt: albumAddedFor(idx)});
  });
  return records;
}

function groupSortedRecords(records, keyFn){
  const groups = [];
  let cur = null;
  records.forEach(r => {
    const k = keyFn(r);
    if(!cur || cur.key !== k){ cur = {key:k, records:[]}; groups.push(cur); }
    cur.records.push(r);
  });
  return groups;
}

// a divider's own "play the bin/artist/letter in order" idx list (CR2
// point 4, the catalog card's PLAY ALL button) — the records' own track
// indices, concatenated in the same order the records themselves appear.
function flatIdx(recs){ return recs.reduce((acc, r) => acc.concat(r.idx), []); }

// CR2 point 3: "the count and year span on the card" — the divider's own
// meta line names the earliest/latest dated record among its group (0/no
// year is excluded, same convention compareCrateYear() already uses for
// "unknown sorts last" rather than reading as a real year). A single year
// prints once, not as a redundant "1998–1998" span.
function yearSpanLabel(recs){
  const years = recs.map(r => r.year).filter(Boolean);
  if(!years.length) return '';
  const lo = Math.min(...years), hi = Math.max(...years);
  return lo === hi ? String(lo) : lo + '–' + hi;
}

// CR2: new arrivals (addedAt within NEW_ARRIVAL_WINDOW_MS, newest first)
// and staff picks (MizikiSocial's own pins, already in pin-rank order) —
// two virtual bins pushed before the alphabet/genre groups below. Records
// inside a bin also appear a second time under their own letter/genre
// (the "double listing" CR2 asks for): this function never touches
// byAlbumId, only the main az/genre loop below does, so the alphabetical
// position is always the one callers resolve to by album id, per CR2
// point 1 ("byAlbumId points at the alphabetical one").
function buildVirtualBins(records){
  const bins = [];
  const now = Date.now();
  const newArrivals = records.filter(r => now - r.addedAt < NEW_ARRIVAL_WINDOW_MS)
    .sort((a, b) => b.addedAt - a.addedAt);
  if(newArrivals.length){
    bins.push({key:'new', label:'NEW ARRIVALS', panelSub:'New arrivals',
      meta: newArrivals.length + (newArrivals.length === 1 ? ' ALBUM' : ' ALBUMS'), records: newArrivals});
  }
  const byId = new Map(records.map(r => [r.albumId, r]));
  const staffPicks = localStaffPickIds().map(id => byId.get(id)).filter(Boolean);
  if(staffPicks.length){
    bins.push({key:'picks', label:'STAFF PICKS', panelSub:'Staff picks',
      meta: staffPicks.length + (staffPicks.length === 1 ? ' ALBUM' : ' ALBUMS'), records: staffPicks});
  }
  return bins;
}

// CR2 point 2: "inside a letter, an artist with three or more records
// gets a type:'div' item with kind:'artist' ahead of their records." The
// letter group's own records are already sorted by artist name first
// (compareCrateArtists, in the caller below), so a run of the same artist
// is always contiguous — no second grouping pass needed, just a walk that
// notices where one run ends and the next begins.
function withArtistDividers(letterRecords){
  const runs = groupSortedRecords(letterRecords, r => r.artist);
  const out = [];
  runs.forEach(run => {
    if(run.records.length >= ARTIST_DIVIDER_MIN){
      const span = yearSpanLabel(run.records);
      out.push({type:'div', kind:'artist', label:run.key,
        meta: run.records.length + ' ALBUMS' + (span ? ' · ' + span : ''), panelSub:'Artist', key:'artist:' + run.key,
        idx: flatIdx(run.records)});
    }
    out.push(...run.records);
  });
  return out;
}

// builds the ordered {type:'div'|'rec', ...} array once, plus lookup maps
// for jumping by album id or by letter/genre (CRATE spec §2)
function buildCrateModel(group){
  const records = buildCrateRecords();
  const items = [], byAlbumId = new Map(), jumpIndex = new Map();
  let railEntries = [];

  // CR2 point 1: the two virtual bins come first, every time, regardless
  // of A-Z/genre grouping — before any other divider/rail entry exists.
  const binRailEntries = [];
  buildVirtualBins(records).forEach(bin => {
    binRailEntries.push({key:bin.key, label: bin.key.toUpperCase(), itemIndex: items.length, present:true});
    jumpIndex.set('key:' + bin.key, items.length);
    items.push({type:'div', kind:'bin', label:bin.label, meta:bin.meta, panelSub:bin.panelSub, key:bin.key,
      idx: flatIdx(bin.records)});
    bin.records.forEach(r => items.push(r));
  });

  if(group === 'genre'){
    records.forEach(r => { r.genreGroup = r.genre || 'Unsorted'; });
    const counts = new Map();
    records.forEach(r => { if(r.genreGroup !== 'Unsorted') counts.set(r.genreGroup, (counts.get(r.genreGroup)||0) + 1); });
    if(counts.size > 25) records.forEach(r => { if(r.genreGroup !== 'Unsorted' && counts.get(r.genreGroup) < 3) r.genreGroup = 'Other'; });
    records.sort((a,b) => {
      const pa = a.genreGroup === 'Unsorted' ? 1 : 0, pb = b.genreGroup === 'Unsorted' ? 1 : 0;
      if(pa !== pb) return pa - pb;
      return crateCompareNames(a.genreGroup, b.genreGroup) || compareCrateArtists(a.artist, b.artist)
        || compareCrateYear(a, b) || crateCompareNames(a.album, b.album);
    });
    const groups = groupSortedRecords(records, r => r.genreGroup);
    const showDividers = groups.length >= 2;
    groups.forEach(g => {
      if(showDividers){
        const artistCount = new Set(g.records.map(r => r.artist)).size;
        const span = yearSpanLabel(g.records);
        jumpIndex.set('key:' + g.key, items.length);
        railEntries.push({key:g.key, label: g.key.slice(0,3).toUpperCase(), itemIndex: items.length, present:true});
        items.push({type:'div', kind:'genre', label:g.key,
          meta: artistCount + ' ARTISTS · ' + g.records.length + ' ALBUMS' + (span ? ' · ' + span : ''),
          panelSub:'Genre', key:g.key, idx: flatIdx(g.records)});
      }
      g.records.forEach(r => { byAlbumId.set(r.albumId, items.length); items.push(r); });
    });
  } else {
    records.sort((a,b) => compareCrateArtists(a.artist, b.artist) || compareCrateYear(a, b) || crateCompareNames(a.album, b.album));
    const groups = groupSortedRecords(records, r => crateLetterFor(r.artist));
    const showDividers = records.length >= 20;
    const present = new Set(groups.map(g => g.key));
    groups.forEach(g => {
      if(showDividers){
        const artistCount = new Set(g.records.map(r => r.artist)).size;
        const span = yearSpanLabel(g.records);
        jumpIndex.set('key:' + g.key, items.length);
        items.push({type:'div', kind:'letter', label:g.key,
          meta: artistCount + ' ARTISTS · ' + g.records.length + ' ALBUMS' + (span ? ' · ' + span : ''),
          panelSub: g.key === '?' ? 'Unknown artist' : 'Artists beginning with ' + g.key, key:g.key,
          idx: flatIdx(g.records)});
      }
      // CR2 point 2: artist dividers only ever sit inside a letter group,
      // never standing in for the letter divider above them.
      withArtistDividers(g.records).forEach(it => {
        if(it.type === 'div') items.push(it);
        else { byAlbumId.set(it.albumId, items.length); items.push(it); }
      });
    });
    if(showDividers){
      railEntries = CRATE_ALPHABET.concat(present.has('?') ? ['?'] : [])
        .map(letter => ({key:letter, label:letter, itemIndex: jumpIndex.get('key:'+letter), present: present.has(letter)}));
    }
  }
  railEntries = binRailEntries.concat(railEntries);
  return {items, byAlbumId, jumpIndex, railEntries, group};
}

export function ensureCrateModel(){
  if(!S.crate.model || S.crate.modelGroup !== S.crateGroup || S.crate.modelDirty){
    S.crate.model = buildCrateModel(S.crateGroup);
    S.crate.modelGroup = S.crateGroup;
    S.crate.modelDirty = false;
    // item indices just shifted under whatever S.crate.pos used to mean —
    // re-resolve from the anchor (a stable album id) rather than trust a
    // now-possibly-unrelated numeric position into the rebuilt list
    S.crate.pos = null;
  }
  return S.crate.model;
}
export function invalidateCrateModel(){ S.crate.modelDirty = true; }

export function isNowPlayingAlbum(item){ return item.type === 'rec' && S.index >= 0 && item.idx.includes(S.index); }

let crateAnchorSaveTimer = null;
export function persistCrateAnchor(item){
  S.crateAnchor = item ? item.albumId : null;
  clearTimeout(crateAnchorSaveTimer);
  crateAnchorSaveTimer = setTimeout(queueSave, 500);
}

// the rail always lands on the first record after a letter/genre divider,
// not the divider itself, falling back to the divider if nothing follows
// it (CRATE spec §4, "Release to land on the first record")
export function crateRailJumpTarget(model, key){
  const di = model.jumpIndex.get('key:' + key);
  if(di == null) return null;
  const next = di + 1;
  return (next < model.items.length && model.items[next].type === 'rec') ? next : di;
}
