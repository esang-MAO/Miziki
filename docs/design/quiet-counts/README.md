# Quiet counts: design handoff

Frames for `docs/24_QUIET_COUNTS.md`. The `.dc.html` files are design-canvas source: read them as text (layout, sizes, colours and copy are all in the markup). The live canvas is "Miziki Records & Pressings" (claude.ai). Each board pairs **Today** with **Proposed**. Build with Miziki's real tokens and components, not this markup. `[Bracketed]` text is a placeholder.

**The rule behind all of it:** pressings, metals and other collectables are found, never counted toward a total. What you've found is shown; what you haven't is never shown — no blanks, no "N of M", no missing list, no locked slots, no progress. Plain wording; the reason is never explained on screen.

| Frame | File | Step |
|---|---|---|
| Records › Pressings, today | `Now.dc.html` | reference |
| Records › Pressings, proposed | `Main.dc.html` | QC1 |
| Records count line and empty state | `Counts.dc.html` | QC1 |
| Listening rhythm before it's ready | `Rhythm.dc.html` | QC3 |
| Your crate: stats and staff picks | `CrateOwn.dc.html` | QC3 |
| A friend's crate, and where followers go | `CrateFriend.dc.html` | QC3 |
| Pressings and Season share cards | `ShareCards.dc.html` | QC2 |

## QC1 · Records › Pressings

- The cream catalog card (`.pressing-card`) keeps its look. Heading "Pressings", with a hand-lettered "found while listening" (Caveat, allowed on paper).
- One row per family, **only for families with at least one pressing found**: a mono caps family name, then that family's found chips only (20px, 4px radius, 5px gap). No count, no blanks, no "Missing:" line. A family row appears the first time one of its pressings is found.
- Metals, below a dashed divider on the card: one disc (34px) per tier **reached**, named under it (Bronze, Silver, Gold…). No discs for tiers not reached.
- The shelves below (Colors, Effects, Metals: records peeking from sleeves in their pressing) are unchanged.
- Records header count line: "40 records" only.
- Empty state: "Pressings and metals show up here as you listen."
- A friend's crate uses the same card, same rule: only their found pressings.

## QC2 · share cards

- **Pressings card:** kicker "PRESSINGS", then the found chips, then the record grid. No "N of 110", no family counts.
- **Season card:** kicker, verdict, the play ring (the total plays stays), then **"MOST PLAYED THIS SEASON"** with the cover art of the top 3 records in the card's 90-day window, album name under each. No metals, no "records played through".

## QC3 · profile and crate

- **Listening rhythm:** no card at all until it's ready; it then appears complete. No locked state.
- **Your crate stats:** Records, Staff picks. No accent on either.
- **Staff picks:** heading "Staff picks" (no "N of 8"), only the pinned records, no empty slot. With zero picks: one line, "Pin a record to put it here."
- **A friend's crate stats:** Records, Staff picks, In common, none in the accent colour.
- **Followers and Following:** two rows on Profile › Settings › Account ("Followers 48 ›", "Following 31 ›"), not on the crate.
