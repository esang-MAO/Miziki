# 21 · Artist page shelves

The artist page used to end at its record shelf, leaving the rest of the screen empty above the mini-player. It now fills that space with shelves built from what's already on the device, plus the Connected shelf (docs/20_CONNECTED.md) once MusicBrainz is switched on. Design: the "Miziki Artist View" canvas.

## Order, top to bottom

1. **Play all · Shuffle · Credits** (unchanged)
2. **Record shelf**, now captioned (title, and year when the files carry one) and ordered by release year, oldest first, undated last, like the crate's own per-artist order.
3. **Your most spun**: the artist's five most-played tracks (`S.trackPlayCounts`, one row per track identity so a duplicate file never lists twice), with spin counts. Tapping a row queues those five starting there.
4. **You & [artist]**: a taped index card with total spins, **last spun** (`albumLastPlayed`/`trackLastPlayed`, the crate's own weekday-or-date label), and **mostly spun** (the top Sundown phase from `albumPhaseCounts`, shown only after 5 phase-counted plays).
5. **Your pressings**: the disc each album presses as, read through `discLook()`, so a saved look, an earned metal, a rare or a zoetrope carries through, the same as the platter and the crate's pressing peek.
6. **Connected** (docs/20_CONNECTED.md): hidden until the shared MusicBrainz cache has data.

Shelves 3–5 are left out entirely until they have something real to show, so an artist you've never played shows only the record shelf, as before.

## Decisions

- **Last spun, not first spun.** The app keeps last-played times but not first-played. Showing a first spin would need a new saved counter (`src/history/`, the backup table, a merge rule). Last spun uses what's already there.
- **Read-only.** Nothing here writes a listening counter; `src/history/` stays the only writer.
- **No network.** Everything on these three shelves comes from `S`; they work signed out, with social unconfigured, and offline.

## Code

- `src/library/artist-shelves.js`: the pure model (`topTracksFor`, `topPhase`, `historyFor`, `pressingLabel`, tested in `tests/unit/artist-shelves.test.js`) and the three `append…` renderers.
- `src/library/view.js`: captions, year order, and the calls, in the order above.
- Exports opened for reuse: `PHASE_LABEL` (profile/rhythm-card.js), `lastSpunLabel` and `albumYearFor` (crate/model.js).
- Styles: `src/styles/27-library-sleeves.css`.

## Still to come (need MusicBrainz)

- **Not in your crate**: the albums by this artist you don't own, as shrink-wrapped sleeves with a buy link and friend stickers. Needs the artist's full discography from MusicBrainz, so it follows the Connected rollout.
