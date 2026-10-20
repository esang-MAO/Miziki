/* ================= crate data model =================
   Moved out of main.js's "S4: crate image tiers" section (step 7c),
   unchanged — physically sat there only because that's where the file
   happened to put it, not because grouping/sorting albums is image-tier
   work (CRATE spec §2). One crate record per album id; loose ("Unknown
   Album") tracks collapse into one pseudo-record per artist instead of
   one per track. */
import { S } from '../state.js';
import { normKey } from '../util/text.js';
import { clamp } from '../util/math.js';
import { albumKey, trackTier } from '../record-art/tiers.js';
import { albumMetalFor } from '../record-art/metals.js';
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

// CR3 (docs/13_CRATE.md) point 3: the catalog card's own meta line needs
// the album's label/catalog number (from library/tags/'s already-parsed
// details.label/details.catalog) and its total runtime — "most common
// non-empty value" would overreach for two fields that are supposed to be
// consistent across an album anyway; the first non-empty one found is
// enough, same spirit as albumGenreFor()'s own tie-break but simpler since
// there's no real "most common" question here.
function firstNonEmpty(idx, field){
  for(const i of idx){
    const v = S.tracks[i].details && S.tracks[i].details[field];
    if(v) return v;
  }
  return '';
}
function albumDurationFor(idx){ return idx.reduce((sum, i) => sum + (S.tracks[i].duration || 0), 0); }

// CR4 (docs/13_CRATE.md): "a divider per decade... pre-1950 shares the
// 1950s row; undated records sit last under 'Undated'" — 0 (no year) is
// the same "unknown" sentinel compareCrateYear()/albumYearFor() already
// use, so 'undated' just needs its own key rather than a new convention.
function decadeKeyFor(year){
  if(!year) return 'undated';
  if(year < 1950) return '1950s';
  return (Math.floor(year / 10) * 10) + 's';
}
// CR4: "the README's era table" (docs/design/crate/README.md, "Era tints")
// — three tints per decade, 20-25% over divider stock plus a 6px edge
// stripe. 2000s onward are the README's own "extrapolated, flagged as
// such" rows; CR4's own instructions in 13_CRATE.md don't ask for that
// flag to surface in the UI (only the README explains where the colours
// came from), so it isn't rendered here — a decade with no row at all
// (hypothetically, anything past the 2020s) just renders untinted, the
// same plain-cream look 'undated' already has.
const ERA_TINTS = {
  '1950s': ['#99C5C4', '#BF6464', '#4E6E68'],
  '1960s': ['#5A77A8', '#702F3B', '#784384'],
  '1970s': ['#676232', '#B68A3A', '#754734'],
  '1980s': ['#384883', '#AD5E99', '#798EA4'],
  '1990s': ['#807396', '#739072', '#40312F'],
  '2000s': ['#9BB7D4', '#5A5B9F', '#9B1B30'],
  '2010s': ['#009473', '#955251', '#5F4B8B'],
  '2020s': ['#0F4C81', '#6667AB', '#A47864'],
};
export function eraTintFor(decadeKey){ return ERA_TINTS[decadeKey] || null; }
// CR4: the rail's own compact decade label ("50s", not "1950s" — the rail
// already keeps letter/genre labels short, a single char or a 3-letter
// abbreviation); Undated gets a dash rather than its own word.
function decadeRailLabel(key){ return key === 'undated' ? '—' : key.slice(2); }

// CR3: the one place a run time gets formatted for the crate — a plain
// M:SS, no hours digit (an LP-length record never needs one); duplicated
// rather than importing fmt() from player/clock.js, which real-chains into
// sleep-timer.js/solar.js/history/played.js/player/background.js — this
// file stays the "pure, DOM-free, importable with nothing to mock" module
// its own header comment and unit tests already rely on.
function formatDuration(totalSec){
  const s = Math.max(0, Math.round(totalSec || 0));
  const m = Math.floor(s / 60), r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
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
      year: albumYearFor(idx), trackCount: idx.length, genre: albumGenreFor(idx), addedAt: albumAddedFor(idx),
      label: firstNonEmpty(idx, 'label'), catalog: firstNonEmpty(idx, 'catalog'), durationSec: albumDurationFor(idx)});
  });
  looseByArtist.forEach(({artist, idx}) => {
    records.push({type:'rec', kind:'loose', albumId: crateLooseArtistId(artist), idx, artist,
      album:'Singles & loose tracks', year:0, trackCount: idx.length, genre:'', addedAt: albumAddedFor(idx),
      label:'', catalog:'', durationSec: albumDurationFor(idx)});
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
  // CR10 point 3: a third virtual bin, Sealed, for the desktop sidebar's
  // BINS list. Reads S.sealed/S.sealedRecords directly rather than calling
  // isAlbumSealed() (library/sealed.js) -- same "every caller already has
  // the answer, don't widen the import surface" reasoning stickerFor()'s
  // own comment above gives, but here there's nothing to widen at all: the
  // two fields isAlbumSealed() itself reads are plain S state, not
  // anything that module computes, so reading them here needs no import
  // of library/sealed.js, circular or otherwise.
  const sealed = S.sealedRecords ? records.filter(r => S.sealed.has(r.albumId)) : [];
  if(sealed.length){
    bins.push({key:'sealed', label:'SEALED', panelSub:'Sealed',
      meta: sealed.length + (sealed.length === 1 ? ' ALBUM' : ' ALBUMS'), records: sealed});
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
  } else if(group === 'decade'){
    // CR4: "records sorted by year" — ascending, oldest first, the same
    // compareCrateYear() unknown-sorts-last convention az/genre already
    // use for a missing value; artist/album only ever break a same-year
    // tie, same ordering spirit as the az branch below.
    records.sort((a,b) => compareCrateYear(a, b) || compareCrateArtists(a.artist, b.artist) || crateCompareNames(a.album, b.album));
    const groups = groupSortedRecords(records, r => decadeKeyFor(r.year));
    groups.forEach(g => {
      const artistCount = new Set(g.records.map(r => r.artist)).size;
      const label = g.key === 'undated' ? 'Undated' : g.key;
      jumpIndex.set('key:' + g.key, items.length);
      railEntries.push({key:g.key, label: decadeRailLabel(g.key), itemIndex: items.length, present:true});
      items.push({type:'div', kind:'decade', label, decadeKey:g.key,
        meta: artistCount + ' ARTISTS · ' + g.records.length + ' ALBUMS', panelSub:'Decade', key:g.key,
        idx: flatIdx(g.records)});
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

// CR3 point 3: "[LABEL] · [CAT. NO.] · [YEAR] · N TRACKS · M:SS", falling
// back to "[GENRE] · [YEAR] · N TRACKS" (no runtime) once label and
// catalog are both empty — the design doc's own fallback example drops
// the duration, not just the two missing fields, so this matches that
// literally rather than reusing the first branch's bits minus two.
export function catalogLineFor(record){
  if(record.label || record.catalog){
    const bits = [record.label, record.catalog, record.year ? String(record.year) : null,
      record.trackCount + (record.trackCount === 1 ? ' TRACK' : ' TRACKS'),
      formatDuration(record.durationSec)].filter(Boolean);
    return bits.join(' · ').toUpperCase();
  }
  const bits = [record.genre, record.year ? String(record.year) : null,
    record.trackCount + (record.trackCount === 1 ? ' TRACK' : ' TRACKS')].filter(Boolean);
  return bits.join(' · ').toUpperCase();
}

const WEEKDAY_LABELS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
// "LAST SPUN TUE" within the last week; a bare M/D once it's further back,
// since "LAST SPUN TUE" said eight days later would misread as "this past
// Tuesday" rather than the one before it.
function lastSpunLabel(ts){
  if(!ts) return '';
  const diffDays = Math.floor((Date.now() - ts) / (24 * 3600 * 1000));
  if(diffDays < 7) return WEEKDAY_LABELS[new Date(ts).getDay()];
  const d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

// CR3 point 3: "a second mono line... appears once the record has been
// played." Reuses the same qualifying-session counter (and its RF4
// cross-device merged total, when one exists) the metal ladder already
// tracks — one source of truth for "how many times," rather than a new
// counter just for this line.
export function playedLineFor(record){
  const counts = S.mergedStats ? S.mergedStats.sessionCounts : S.sessionCounts;
  const n = (counts && counts[record.albumId]) || 0;
  if(!n) return '';
  const bits = ['PLAYED ' + n + (n === 1 ? ' TIME' : ' TIMES')];
  const spun = lastSpunLabel(S.albumLastPlayed[record.albumId]);
  if(spun) bits.push('LAST SPUN ' + spun);
  return bits.join(' · ');
}

// the "best" (highest bit depth/rate) hi-res track among an album's own
// tracks, or null if none clears trackTier()'s tier-3 threshold — an album
// is read as hi-res the moment any one of its tracks is, the same
// "one track's own tag decides" spirit trackTier() itself already has.
function albumHiResMeta(idx){
  let best = null;
  idx.forEach(i => {
    const t = S.tracks[i];
    if(trackTier(t) !== 3 || !t.meta) return;
    if(!best || (t.meta.bits || 0) > (best.bits || 0) || (t.meta.rate || 0) > (best.rate || 0)) best = t.meta;
  });
  return best;
}

// CR3 point 1: "a single stickerFor(record) ... returning at most one of
// sealed, new, friends, hires, metal, or none, by the README's priority."
// `sealed` is passed in rather than resolved here with isAlbumSealed()
// (library/sealed.js) on purpose — that module real-chains into
// library/view.js, which already imports crate/view.js, and threading a
// new edge through crate/model.js for one boolean isn't worth tangling
// that cycle further when every caller already has the answer in hand
// (crate/view.js already calls isAlbumSealed() for the seal overlay/the
// catalog card's own SEALED chip). `friends` has no real data source yet:
// the design doc's own "(RF20 era)" note names the class of feature this
// belongs to, not a built RPC — RF20/RF23 shipped records_in_common(p_other)
// and credit_friends(), both scoped to one named friend or one named
// credit, never "how many of my own friends also have this release,"
// which a crate card needs aggregated across the whole friends graph with
// no "other" argument at all. That RPC doesn't exist yet — this is a
// renderer only, so it stays dead until a future record carries
// friendsCount.
export function stickerFor(record, sealed){
  if(!record || record.type !== 'rec') return null;
  if(sealed) return {kind:'sealed', addedAt: record.addedAt};
  if(Date.now() - record.addedAt < NEW_ARRIVAL_WINDOW_MS) return {kind:'new'};
  if(record.friendsCount) return {kind:'friends', count: record.friendsCount};
  const hiRes = albumHiResMeta(record.idx);
  if(hiRes) return {kind:'hires', bits: hiRes.bits, rate: hiRes.rate};
  const metal = albumMetalFor(record.albumId);
  if(metal) return {kind:'metal', metal};
  return null;
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

// CR5 ("pull a record out"): the pull/flip/hold state machine, as a pure
// function over a pointer trace, per the README's own thresholds
// (docs/design/crate/README.md, "Gestures (CR5)") and the plan's own
// "Tests" requirement (docs/13_CRATE.md). crate/view.js's existing flip
// drag is purely vertical (e.clientY only, no horizontal tracking), so
// "moves up 24px before it moves 12px in either flip direction" reads as:
// sustained upward displacement from the pointerdown point commits to a
// pull once it reaches CRATE_PULL_UP_PX, provided it hasn't first fallen
// back by CRATE_PULL_REVERSAL_PX from its own peak -- which commits to an
// ordinary flip instead (the same read a flick-up-then-back-down, or a
// plain downward drag, already gets today).
export const CRATE_PULL_UP_PX = 24;
export const CRATE_PULL_REVERSAL_PX = 12;
export const CRATE_PULL_HOLD_MS = 450;
export const CRATE_PULL_COMMIT_FRACTION = 0.4;

// trace: an array of samples `{dy, t}` in order, dy = displacement in CSS
// px from the pointerdown point (positive = down, negative = up), t = ms
// elapsed since pointerdown; the first sample is always {dy:0, t:0}. Pure
// and DOM-free -- the real pointer handlers in crate/view.js feed it their
// own accumulated trace on every pointermove, and a hold timer feeds it
// a synthetic trailing sample purely to carry elapsed time forward.
//
// Returns 'pull', 'flip', 'hold' once committed, or 'pending' while still
// undecided (neither threshold crossed, and the hold deadline hasn't
// passed yet).
export function classifyCratePointerTrace(trace){
  if(!trace || trace.length < 2) return 'pending';
  let peakUp = 0;
  for(let i = 1; i < trace.length; i++){
    const curUp = -trace[i].dy;
    if(curUp > peakUp) peakUp = curUp;
    if(peakUp >= CRATE_PULL_UP_PX) return 'pull';
    if((peakUp - curUp) >= CRATE_PULL_REVERSAL_PX) return 'flip';
  }
  const elapsed = trace[trace.length - 1].t;
  if(elapsed >= CRATE_PULL_HOLD_MS) return 'hold';
  return 'pending';
}

// How far (0..1) a committed pull has travelled toward release, given the
// total upward displacement from the pointerdown point and the record's
// own height in px -- >= CRATE_PULL_COMMIT_FRACTION commits the pull on
// release; below it springs back.
export function cratePullProgress(upPx, cardHeightPx){
  if(!cardHeightPx) return 0;
  return clamp(upPx / cardHeightPx, 0, 1);
}
