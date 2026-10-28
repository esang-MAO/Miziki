/* ================= connected crate: MusicBrainz parsing (docs/20_CONNECTED.md) =================
   Pure functions only — no fetch, no Deno, no Supabase — shared by the
   mb-connections edge function (which does the network and the writes)
   and tests/unit/connected.test.js (which runs them under Node against
   fixture JSON). Plain JavaScript on purpose, so both runtimes import the
   same file. */

// Must stay byte-for-byte equivalent to src/util/text.js's normKey(): the
// client sends its own normKey() as the cache key it reads, and the edge
// function keys what it writes with this. The unit test asserts parity.
export function normName(s){
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,' ').trim();
}

// A search hit is only trusted when it's an exact name (or alias) match
// after normalization and MusicBrainz itself scores it near-certain. A
// wrong artist is worse than no shelf at all, so anything less is a miss.
export const MIN_SCORE = 95;

export function pickArtist(searchJson, name){
  const want = normName(name);
  if(!want) return null;
  const hits = (searchJson && searchJson.artists) || [];
  for(const a of hits){
    if((a.score || 0) < MIN_SCORE) continue;
    const names = [a.name, a['sort-name'], ...((a.aliases || []).map(x => x && x.name))];
    if(names.some(n => normName(n) === want)) return { mbid: a.id, name: a.name };
  }
  return null;
}

// How a related artist relates to the page's artist, from one MusicBrainz
// artist-artist relationship. Returns null for every relationship type
// the shelf doesn't use (teachers, tributes, voice actors, ...).
export function roleFor(rel){
  if(!rel || !rel.artist || !rel.artist.id) return null;
  if(rel.type === 'member of band') return rel.direction === 'backward' ? 'member' : 'band';
  if(rel.type === 'collaboration') return 'collab';
  return null;
}

const ROLE_ORDER = { member: 0, band: 1, collab: 2 };

// The related artists worth a release-group lookup, deduped (someone can
// be both a member and a collaborator — the closer role wins), members
// first, capped so one artist page never costs more than `cap` extra
// MusicBrainz calls.
export function relatedFrom(lookupJson, cap = 4){
  const byId = new Map();
  ((lookupJson && lookupJson.relations) || []).forEach(rel => {
    const role = roleFor(rel);
    if(!role) return;
    const id = rel.artist.id;
    const prev = byId.get(id);
    if(!prev || ROLE_ORDER[role] < ROLE_ORDER[prev.role]) byId.set(id, { mbid: id, name: rel.artist.name, role });
  });
  return [...byId.values()]
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name))
    .slice(0, cap);
}

// An artist's own Bandcamp first, then their official site — the "buy
// from the artist" destination. https only.
export function urlsFrom(lookupJson){
  const out = [];
  ((lookupJson && lookupJson.relations) || []).forEach(rel => {
    const url = rel && rel.url && rel.url.resource;
    if(typeof url !== 'string' || !/^https:\/\//.test(url) || url.length > 500) return;
    if(rel.type === 'bandcamp') out.push({ kind: 'bandcamp', url });
    else if(rel.type === 'official homepage') out.push({ kind: 'official', url });
  });
  out.sort((a, b) => (a.kind === 'bandcamp' ? 0 : 1) - (b.kind === 'bandcamp' ? 0 : 1));
  return out.slice(0, 3);
}

export function buyUrlFrom(urls){ return (urls && urls[0] && urls[0].url) || null; }

function yearOf(date){
  const y = parseInt(String(date || '').slice(0, 4), 10);
  return y >= 1860 && y <= 2200 ? y : null;
}

// A related artist's studio albums and EPs (no compilations, live,
// soundtracks, remixes...), oldest first, capped per artist so one
// prolific member can't crowd out the rest of the shelf.
export function releaseGroupsFrom(lookupJson, cap = 4){
  return ((lookupJson && lookupJson['release-groups']) || [])
    .filter(rg => rg && rg.id && rg.title
      && (rg['primary-type'] === 'Album' || rg['primary-type'] === 'EP')
      && !(rg['secondary-types'] || []).length)
    .map(rg => ({ release_group_mbid: rg.id, title: String(rg.title).slice(0, 300), year: yearOf(rg['first-release-date']) }))
    .sort((a, b) => (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title))
    .slice(0, cap);
}

// One related artist's lookup (inc=release-groups+url-rels) → the rows
// artist_connections stores for it.
export function connectionRows(artistMbid, via, viaLookupJson, perArtist = 4){
  const buy = buyUrlFrom(urlsFrom(viaLookupJson));
  return releaseGroupsFrom(viaLookupJson, perArtist).map(rg => ({
    artist_mbid: artistMbid, ...rg,
    via_mbid: via.mbid, via_name: String(via.name).slice(0, 300), role: via.role, buy_url: buy
  }));
}
