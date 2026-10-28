# 20 · Connected crate

The artist page's **Connected** shelf: records by artists related to the one you're looking at — its members' own records, bands this artist was in, named collaborations — with a link out to buy from that artist. It sits under the artist's own shelf, after Play all / Shuffle / Credits. Design: the "Miziki Artist View" canvas.

**Status: built and switched off.** Everything ships now; nothing talks to MusicBrainz until the steps under *Switching it on* are done. Until then the shelf never appears (`?social=demo` shows it with invented fixture data).

## How it fits together

```
artist page ──► MizikiSocial.artistConnections(name, normKey(name))
                   │
                   ├─► rpc artist_connections(p_name_norm)      (migration 023, anyone can read)
                   │      status: fresh | stale | nomatch | missing
                   │
                   └─► only when missing/stale AND signed in:
                       functions.invoke('mb-connections', {name})
                          │  MB_ENABLED != "true" → { status: "disabled" } (today)
                          ▼
                       musicbrainz.org (server-side only, ≤1 req/s, ~6 calls)
                          ▼
                       writes mb_artists + artist_connections (service role)
```

- **Phones never call MusicBrainz.** The client reads one Supabase RPC and, at most, calls one Supabase edge function — both on the project's own origin, already in the CSP. No CSP change, no new third-party host on the device.
- **One shared cache for everyone.** The first person to open an artist pays the ~6 MusicBrainz calls (about seven seconds, shelf fills in when done); everyone after reads the cache. Rows refresh after 30 days. A miss (`nomatch`) is cached too, so an obscure artist doesn't re-query on every open.
- **Signed out:** reads whatever's cached, never triggers a fetch.
- **Public catalog data only.** `mb_artists`/`artist_connections` have no `user_id`; nothing about who asked is stored or sent to MusicBrainz.

## What MusicBrainz is asked

Per artist (`supabase/functions/mb-connections/index.ts`):

1. `GET /ws/2/artist?query=artist:"<name>"` — accept only an exact name/alias match (after `normName`) with score ≥ 95. Anything less is `nomatch`: a wrong shelf is worse than none.
2. `GET /ws/2/artist/<mbid>?inc=artist-rels+url-rels` — relationships: *member of band* (backward = a **member**, forward = a **band** this artist was in), *collaboration* (**collab**). Deduped, members first, capped at 4 related artists.
3. For each related artist, `GET /ws/2/artist/<mbid>?inc=release-groups+url-rels` — their own Album/EP release groups with no secondary type (no live, compilations, soundtracks), oldest first, 4 each; plus their Bandcamp (preferred) or official site as the buy link.

All parsing is pure (`supabase/functions/_shared/mb-connections.js`) and unit-tested against fixture JSON (`tests/unit/connected.test.js`), including that `normName` stays identical to the client's `normKey` — the cache key both sides use.

## The shelf (`src/library/connected.js`)

- Hidden until the cache returns at least one record; no spinner, no empty state.
- Preview of 4, round-robin across related artists (one record per person before a second); **See all N** expands in place.
- Each row: a plain manila sleeve with the title lettered on, title, "related artist · year", a role chip (Member / Band / Collab), and **Buy ↗** when MusicBrainz has an https Bandcamp/official link.
- The related artist's name links to their artist page when they're already in your library.
- All MusicBrainz text goes in through `textContent` only.

## Switching it on

1. **MetaBrainz:** register Miziki for non-commercial use (the plan of record). Reads of the MusicBrainz web service need no key, but the User-Agent must carry real contact info.
2. **Apply `023_artist_connections.sql`** — staging first, then production (SUPABASE_SETUP.md §2/§8).
3. **Deploy the function:** `supabase functions deploy mb-connections` (needs the Supabase CLI linked to the project).
4. **Set its secrets:** `supabase secrets set MB_CONTACT=<email or URL> MB_ENABLED=true`. `MB_ENABLED` is the on/off switch; unset it to stop all MusicBrainz traffic without a deploy.
5. **Privacy text, same PR as flipping it on:** `docs/PRIVACY_POLICY.md` and `src/profile/legal.js` should say that artist names you open may be looked up on MusicBrainz by Miziki's server (never your identity or listening data). CLAUDE.md's "What's stored server-side" table already lists the two cache tables.
6. Open an artist page signed in; the shelf fills within about ten seconds. In Table Editor, `mb_artists` gains a row.

## Not in this step (later, in order)

- **Album matching (RF24, docs/12_REFINE.md):** today the lookup goes by artist *name*. Once local albums are pinned to release-group MBIDs, look the artist up by MBID instead and skip the name search.
- **Producer / featured / engineer credits** — release-level relationships; heavier on MusicBrainz calls, so they come after the cache has proven itself.
- **Cover art** from the Cover Art Archive — a new third-party image host on the device (CSP + privacy note), or proxied through Supabase Storage. Sleeves stay lettered until then.
- **Friend stickers** on connected records — `release_credits`/`crate_items` already hold what's needed once releases carry MBIDs.
- **Throttling across simultaneous users** — each function call spaces its own requests ≥1.1 s apart; two people opening two uncached artists at the same moment could briefly exceed MusicBrainz's rate. Fine at friends-and-family scale; a shared queue table if it ever isn't.
