# 24 · Quiet counts

Pressings, metals and the rest of Miziki's collectables become things you **find**, not totals you work toward. You see what you've found, and it grows as you listen. You never see what's missing, how many there are, or how close you are. Someone who wants every pressing will find them on their own; nobody else feels the pull of an unfinished chart.

The same pass removes the other nudges and score-like numbers the audit found: the rhythm card's "keep listening", staff picks' "N of 8", the follower count on your crate, metal tallies, and "progress" wording.

Follows CLAUDE.md's **How Miziki behaves** rules (PR #269). The reasons stay off screen: copy is plain and standard and never explains itself.

**Decisions (Ken, Oct 30):**
- **Grow, don't reveal:** the pressing chart shows only what's been found. No blank or dimmed placeholders, no counts, no "Missing:" list. A family appears when its first pressing is found. Metals show only tiers reached.
- **Counts live nowhere else:** the Records count line is just "N records"; the Pressings share card has no "N of 110".
- **Season card:** metals out; the cover art of the top 3 records from the card's window in. The play total stays.
- **Rhythm card:** hidden until it's ready, no locked state.
- **Staff picks:** no "N of 8", no empty slot (one line when there are none).
- **Followers/Following:** off the crate, onto Profile › Settings › Account. "In common" stays on a friend's crate, without the accent.
- **Wear (follow-up to RW7):** no play counts on the gatefold or side bars.

**Designs:** `docs/design/quiet-counts/` (frames plus README).

**Order:** QC0 → QC5, one PR each, the usual routine (preview, merge, after-merge check). **QC4 waits until RW7 (docs/23) has merged.** QC0–QC3 and QC5 don't touch anything RW1–RW7 changes, so they can run alongside the RW work.

**One in, one out:** every step here only removes or simplifies.

**Tests:** existing tests in `tests/unit/pressings.test.js`, `tests/unit/records.test.js` (and any others asserting the old wording) check the counts and count line this plan removes. Update them in the same PR as the change; a failure there is expected, not a regression.

---

## QC0: mark the old specs superseded (docs only)

> Read CLAUDE.md first. Docs-only PR. Several older plan docs and design READMEs specify counts this plan removes, and a future session reading them could rebuild one. Add a short note at the top of each affected section — "**Superseded by docs/24_QUIET_COUNTS.md:** pressings and metals are shown as found, never counted (no 'N of M', blanks or missing lists)." — in: `docs/PRESSINGS_110.md`, `docs/12_REFINE.md`, `docs/13_CRATE.md`, `docs/18_SHARE.md`, `docs/design/crate/README.md`, `docs/design/share/README.md`, `docs/design/profile-records/README.md`. Grep for `of 110`, `OF 40`, `of 8`, `Missing:` and `keep listening` to find every spot. Don't rewrite the history; just mark it.
>
> Also add the `docs/design/quiet-counts/` folder and this plan doc if they aren't in the repo yet.
>
> No code. Open the PR. Do not merge.

**Preview focus:** none (docs only).

---

## QC1: the pressing chart grows as you find things

> Read CLAUDE.md, this plan and `docs/design/quiet-counts/README.md` first (frames `Main`, `Counts`; `Now` is today's for comparison).
>
> 1. `renderPressingCard()` (`src/profile/storefront.js`): draw **only owned chips**, grouped by family in family order, one row per family **that has at least one owned pressing**, with a mono caps family name above its chips. Remove the "COLORS N OF 40 · …" count line, the dimmed missing chips and the "Missing: …" line. Add the hand-lettered "found while listening" beside the heading (`var(--hand)`; it's on the paper card). Owned chips stay tappable on your own card (jump to the record), as today.
> 2. Same card on a **friend's crate** (`src/social/screens/friend-store.js`): the same owned-only rule. Their unfound pressings are never drawn.
> 3. Metals on the card (below a dashed divider): one disc per tier **reached** (from `achievementsList()`), named underneath, highest tier last. Nothing for tiers not reached. With no metals, no Metals row at all.
> 4. `recordsCountLine()` (`src/profile/records.js`) returns just "N records". The Records empty state reads "Pressings and metals show up here as you listen."
> 5. **Tests:** owned-only chips; families with nothing found omitted; a friend's card draws no unowned chips; metal discs only for reached tiers; count line; empty-state copy. Update the existing pressings/records tests that assert the old counts.
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** Profile › Records › Pressings: only your pressings show, no numbers, no blanks, no missing list; Zoetropes doesn't appear unless you have one. Open a friend's crate (or `?social=demo`): same rule. The Records header says only "N records".

**After-merge check:** next time a new pressing turns up, see it join its row.

---

## QC2: share cards without totals

> Read CLAUDE.md and the README (frame `ShareCards`).
>
> 1. **Pressings card** (`src/share/pressings-card.js`): remove the "N of M" figure and the family-counts line. Draw the owned chips (same grouping as QC1) under the "PRESSINGS" kicker, then the existing record grid.
> 2. **Season card** (`src/share/season-card.js`): remove the METALS section and the "N RECORDS PLAYED THROUGH" line. In their place, "MOST PLAYED THIS SEASON" with the cover art of the **top 3 albums by plays within the card's own 90-day window**, album name under each (fit, never truncate mid-word; the existing `shareFitText`). Use the same windowed per-day data the rhythm verdict already uses; if per-album data isn't windowed yet, add a windowed per-album play count (written only from `src/history/`, device-only like `S.phasePlayCountsByDay`, and add it to CLAUDE.md's backup table). Fewer than 3 albums in the window: show what there is. The play ring and its total stay.
> 3. The data gatherer on the profile's Listening screen stops passing metals/playedThrough to the Season composer.
> 4. **Tests:** pressings card draws no total; Season card's top-3 selection (window edges, ties, fewer than 3), and no metals section.
>
> Lint and unit tests pass; both builds preview with no console errors. Saved share images for both cards in each style go in the PR. Do not merge.

**Preview focus (Ken, iPhone):** share a Pressings card (no "of 110") and a Season card (three covers you recognise as this season's most played, no metals). Save both.

**After-merge check:** share a Season card at the end of a week of listening.

---

## QC3: profile and crate without scores

> Read CLAUDE.md and the README (frames `Rhythm`, `CrateOwn`, `CrateFriend`).
>
> 1. **Rhythm card** (`src/profile/rhythm-card.js`): remove the locked state. Below `RHYTHM_MIN_PLAYS`, render nothing at all. The card appears, complete, once there's enough data.
> 2. **Staff picks** (`src/profile/storefront.js`): heading "Staff picks" with no "— N of 8"; show only pinned records, no empty "Pin a record" slot. With zero picks, one line: "Pin a record to put it here." The cap of 8 stays as a rule (pinning a 9th is still refused as today), just not displayed.
> 3. **Your crate stats:** Records and Staff picks only, neither in the accent colour. Remove the Followers stat (and its accent).
> 4. **A friend's crate stats** (`src/social/screens/friend-store.js`): Records, Staff picks, In common, none in the accent colour.
> 5. **Profile › Settings › Account** (`src/profile/settings.js`): add two rows, "Followers N ›" and "Following N ›", each opening the existing follower/following list (or a simple list sheet if there isn't one yet). Signed out: hidden.
> 6. **Tests:** rhythm card renders nothing below the threshold; staff-picks heading and zero-state copy; stats rows (own: 2, no accent; friend: 3, no accent); Account rows present only when signed in.
>
> Lint and both test suites pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone, test account):** your crate shows Records and Staff picks only; staff picks has no "of 8" and no empty slot; the Listening screen has no rhythm card on a fresh account; Settings › Account shows Followers and Following. A friend's crate: no amber numbers.

**After-merge check:** none needed.

---

## QC4: wear without play counts (after RW7 merges)

> Read CLAUDE.md, this plan and `docs/23_RHYTHM_AND_WEAR.md` (RW7). Only start once RW7 is merged.
>
> 1. Gatefold wear line: "Worn · since March 2025" / "Well loved · since March 2025" — the stage word and the first-played month, **no play count**. Nothing for new/light, as RW7 already does.
> 2. Per-side rows: keep "SIDE A" / "SIDE B" and the thin bar, but the bar shows each side's **share** of the record's plays, with **no number**.
> 3. **Tests:** the wear line contains no digits other than the year; side bars sum to the record's plays proportionally; no numeric label.
>
> Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** open a favourite record: "Well loved · since …" with no number; the side bars still show which side you play more.

---

## QC5: plain wording in the privacy text

> Read CLAUDE.md (the legal screen is synced with `docs/PRIVACY_POLICY.md`). Change "achievements and Collection progress" to "achievements and your Collection" in **both** `docs/PRIVACY_POLICY.md` and `src/profile/legal.js`, in the same PR, and keep any existing legal-sync test passing. No other wording changes.
>
> Lint and unit tests pass. Open the PR. Do not merge.

**Preview focus:** Profile › Privacy › the backup line reads "…achievements and your Collection…".
