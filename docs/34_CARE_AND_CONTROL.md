# 34 · Care and control

Findings from a reading pass over seven books, checked against the repo as of `4f1d1e1` (Nov 7, after plan 33). The title is from Seaver's *Computing Taste*, which ends on the tension between caring for listeners and steering them. Much of what the books recommend is **already in Miziki**, so this plan covers only the gaps. It has four parts:

- one copy fix;
- the friends sticker, designed but never connected to real data;
- house rules that keep Deluxe and earning fair;
- double LPs, and an artist + album pressing key with rebalanced odds.

**Sources:**
- Seaver, *Computing Taste* (2022).
- Bar-Gill & Sunstein, *Algorithmic Harm* (2025).
- Kleinberg & Tardos, *Algorithm Design*.
- Zingaro, *Algorithmic Thinking* (2nd ed.).
- Heitzinger, *Algorithms with Julia*.
- Edet, *Procedural Programming*.
- Jagan Mohan (ed.), *Algorithms in Advanced AI*.

The last two had nothing Miziki needs.

---

## What the reading confirms is already right (no work)

| Finding | Where Miziki already does it |
|---|---|
| Engagement metrics tend to corrupt recommender teams, whatever their intentions (Seaver ch. 2, epilogue) | No analytics, telemetry or retention tracking anywhere in `src/` or `supabase/`; "How Miziki behaves" bans streaks, push and come-back prompts |
| The original "collaborative filtering" meant people knowingly annotating for people they knew (Seaver ch. 1) | `fresh_for_you` (migration 015) draws only from a friend's pins and sleeve notes, with no rating filter |
| Readable, rule-based picks are the transparent kind (Bar-Gill & Sunstein ch. 9) | `storeRuleCaption()` states the rule under Fresh for you; feed tiles say "added by / pinned by" |
| Ratings are noisy and act as self-presentation (Seaver ch. 2) | The rating is decoration only and never sorts |
| "Now spinning" can reveal sensitive things about a person (Seaver epilogue) | Friends-only default, the "Share what you're spinning" switch, and the per-session "Don't share this session" (RF21) |
| Random reward drops are the slot-machine mechanism (Seaver ch. 2) | Pressings are deterministic per album; turntable rules are fixed thresholds; no toasts (ST4 point 5) |
| Completion compulsion and scarcity cues (Bar-Gill & Sunstein ch. 4) | No counts, placeholders or locked tiles (docs/24_QUIET_COUNTS.md) |
| One friend's big import can flood the feed | Adds collapse into one counted row (migration 020) |
| Weak hash with salt appended at the end skewed pressing draws | Fixed in plan 31 (salt in front, `fmix32`) |
| Smooth Sundown rate changes | `smooth()` easing in `sundown/solar.js` |
| Two-side split balanced by time, track order kept | `bestSideCut()` in `record-art/format.js` (optimal for two sides) |

---

## Decisions (Ken, Nov 7)

1. **Broadcast turntable stays as it is** (7 whole records finished between solar midnight and first light). No change.
2. **Double LPs: yes.** Step CC5.
3. **Pressings keyed on artist + album: yes.** Step CC6.
4. **The full pressing chart may take a long time; that's fine.** CC0 records the real numbers in `docs/PRESSINGS_110.md`. The earlier estimate of about 350 albums in this plan was wrong. I've since measured the shipped draw code (`selectVariantForTierKey()`) over thousands of simulated hi-res libraries. Completing all 94 file-drawn pressings (40 solids, 54 effects) from hi-res albums alone takes:
   - a median of about **730 albums** (most libraries 520–1,110);
   - 170 albums show about 73 of the 94;
   - 300 albums show about 85.

   The bottleneck is the scarce band: 10% of draws, spread over 14 items. That hits solids hardest, since solids are only 25% of hi-res draws.

5. **No reissue. Rebalance the one pressing per album instead** (decided Nov 7). CC6 already redraws every album once, so the new odds ride along in that PR:
   - **hi-res:** 5% Jet / **40% solid / 55% effect** (was 25 / 70);
   - **bands:** **50 / 35 / 15** common / uncommon / scarce (was 60 / 30 / 10);
   - the bands are shared, so lossless solids get the gentler bands too; the lossless and lossy mixes themselves are unchanged.

   Simulated, hi-res-only library, all 94 file-drawn pressings:

   | | Albums to complete (median) | Most libraries | Seen at 170 | Seen at 300 |
   |---|---|---|---|---|
   | Current odds | about 730 | 500–1,110 | about 73 | about 86 |
   | **New odds** | **about 500** | 390–700 | about 77 | about 89 |

   About 500 is close to the floor for one pressing per album: even perfectly even odds land around 490. Scarce pressings stay rarer than common ones, just less extreme (each scarce pressing is about three-quarters as likely as each common one, down from about a quarter).

---

## Order

CC0 → CC6, one PR each, the usual routine (preview, merge, after-merge check). CC2 needs migration `028` (`027` is plan 32's shelf and turntable). Do CC3 after plan 33's WS3 and WS4, since all three touch the share cards. CC2 is the only step with a migration. CC6 needs none: pressings are drawn on the device (migration 019's own note), and `releases.artist` is already synced.

**UI changes:**
- **CC1:** one line of copy.
- **CC3:** the friends sticker appears on records, plus a new Privacy switch.
- **CC5:** long albums show sides C and D.
- **CC6:** every album's file-drawn pressing changes once, under the new odds (earned rare pressings and zoetropes don't).

CC0, CC2 and CC4 change nothing on screen.

---

## CC0: docs only (no UI)

> Read CLAUDE.md first. Docs-only PR: add this plan. Then:
>
> 1. **CLAUDE.md › How Miziki behaves**, add two bullets:
>    - **Miziki keeps no engagement numbers.** No analytics, telemetry, dwell time, daily-active or retention tracking, on the device or the server. Listening stats exist only for the listener's own screens and for what they choose to share.
>    - **Deluxe is a fair trade.**
>      - One price, the same for everyone.
>      - Never an offer, discount or prompt triggered by what someone did or didn't do (no "you're close", no lapsed-listener deals).
>      - Deluxe grants only what it lists. It never speeds up earning anything else, and earning thresholds are never tightened after release.
>      - The purchase lives in one fixed place (Settings) and is never shown at a moment of frustration.
>      - Every turntable stays earnable without Deluxe.
> 2. **docs/30_GROOVES_AND_SHELF.md**, under the "year-end wrap" later item, add:
>    - The yearly pressing book is built from the listener's own words and choices: sleeve notes, pins, liner notes, kept-for, pressings and turntables found (with `foundAt`/`phase`), and played-through sides.
>    - Never from inferred genre labels or a "your listening personality" verdict.
>    - It's a flip-through booklet, not a story sequence.
> 3. **docs/PRESSINGS_110.md**: add the expectation numbers for the new odds (decision 5), measured by simulating the draw code. Keep the old-odds row for comparison.
>
> No code. Open the PR. Do not merge.

---

## CC1: Fresh for you says what it does (UI: one line of copy)

> Read CLAUDE.md first. `fresh_for_you` (migration 015) orders **pins first (by pin rank), then sleeve-noted records, newest first**. The caption in `friendFreshSection()` (`src/social/screens/friend-store.js`) says only "newest first".
>
> 1. Caption: "Records [handle] pinned or wrote about that you don't have — pins first, then newest."
> 2. Each row gets a small muted reason under the artist: "pinned" or "sleeve note".
> 3. **Tests:** caption text; the reason line matches `pin_rank`/`sleeve_note`.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

---

## CC2: friends sticker, server side (no UI)

> Read CLAUDE.md, docs/18_SHARE.md (RF20 rules) and docs/12_REFINE.md first. The sticker drawing already exists:
> - `friendsStickerText()` in `src/share/record-card.js`;
> - the `friends` kind in `src/crate/model.js`.
>
> Nothing feeds it real data. New migration `028_friends_sticker.sql`:
>
> 1. `profiles.count_in_stickers boolean not null default true`. It is readable only by the owner. **Never expose it to anyone else**: if opting out is visible, the choice itself reveals something.
> 2. RPC `friends_sticker(p_release_ids uuid[])` returns `(release_id, owners integer)`:
>    - **owners** = mutual follows (both directions `accepted`) who have the release in their crate at a visibility the caller can see, and have `count_in_stickers = true`;
>    - only for releases **the caller doesn't own**;
>    - blocked users excluded (`private.is_blocked_between`).
> 3. RPC `friends_sticker_detail(p_release_id uuid)` returns the same owners as handles, plus mutual friends who have it on a **visible** digging list (respecting the digging-list visibility switch), as `wants`.
> 4. Security invoker. Helpers stay in `private`. No feed events.
> 5. **Tests** (`tests/client.test.js`): mutual-only; opt-out excluded and not detectable; own-copy excluded; blocked excluded; private items excluded.
>
> Open the PR. Do not merge.

---

## CC3: friends sticker on records, plus the switch (UI)

> Read CLAUDE.md and docs/25_FROM_SCRATCH.md (CR3 sticker palette) first. Needs CC2.
>
> 1. **Where it shows:** only on records you don't own, wherever they appear:
>    - a friend's crate shelves and face-out pins;
>    - the record sheet;
>    - Fresh for you rows;
>    - Home feed tiles;
>    - the artist view's "not in your crate" shelf;
>    - the Connected shelf.
>
>    One `friends_sticker` call per screen, batched by the visible release ids.
> 2. **Look and wording:** the existing round butter sticker, "3 friends" / "1 friend". Nothing at 0. No total anywhere of how many friends' records you lack, and no "missing" or "you don't have" wording. Tapping opens a small sheet: "In [a], [b]'s crates" and "On [c]'s digging list", each handle opening that friend's crate.
> 3. **Privacy screen:** a new switch, **"Count me in friends' stickers"**, on by default. Under it: "Friends see a count of who has a record — never what you play."
> 4. The Record share card's `friendsCount` reads from the same RPC (it's always null today).
> 5. **One in, one out:** the record sheet's current plain owner line, if any, is absorbed into the sticker sheet.
> 6. **Tests:** sticker never on owned records; hidden at 0; switch round-trip (server column, not prefs); share-card gating.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** stickers sit on the sleeve without covering titles; the tap target is at least 44 px; night (after sunset) still shows them dimmed, consistent with GF11.

---

## CC4: guard the fair-trade rules in code (no UI)

> Read CLAUDE.md first.
>
> 1. Unit test: every turntable in `TURNTABLE_LINEUP` except `standard`, including the two marked `deluxe: true`, has an earning rule in `achievements.js`, so nothing is purchase-only. The Deluxe grants already live in one place (the `deluxe: true` flags in `turntable.js` and `shelf-finish.js`), so there's no refactor here.
> 2. Unit test: the earning thresholds match a frozen snapshot (`tests/unit/earning-thresholds.snap.json`). Changing a threshold fails CI until the snapshot is updated on purpose, so tightening one is a deliberate act.
>
> Open the PR. Do not merge.

---

## CC5: double LPs (UI: sides C/D)

> Read CLAUDE.md, docs/16_AUDIO.md §5 and docs/CEREMONY.md first. `record-art/format.js` and `shell/ceremony-timing.js`.
>
> 1. New pure `bestSideCuts(durations, sides)`: a dynamic program over cut points, keeping track order. Cost = Σ(side − mean)², with no side over 22 min where avoidable. It runs in O(sides·n²), which is trivial for 30 tracks.
> 2. A single-disc album whose two-side split puts either side over 22 min becomes a **double LP**: 4 sides (A–D), two discs in the gatefold ("DISC 1 / DISC 2" eyebrows, as GF4 does for real multi-disc albums), flips A→B→C→D.
> 3. Same for everyone, computed from the track lengths. The personal format override is unchanged. Real multi-disc albums still split by disc.
> 4. **A computed double LP is two real discs everywhere.**
>    - `discGroupsFor()`, `sideLengthsFor()` and `splitSides()` in `shell/ceremony-timing.js` return it as disc 1 (sides A/B) and disc 2 (sides C/D), with virtual disc numbers. Untagged tracks currently all read as disc 0, so without this the gatefold would build only one pocket.
>    - `gatefoldDiscOf()` uses the same mapping, so the right pocket reads "on the platter".
> 5. **Both discs on screen at once in the gatefold.** Today `.gf-multi-disc` (11-gatefold.css) is a horizontally scrolling row, padded so one disc sits centered and the second is off screen. That changes for **exactly two discs**, whether computed or tagged:
>    - **Layout:** both pockets sit side by side and fully visible, centered in the sleeve, with no scroll. Discs stay at the full `--gf-disc-size` (156 px) with a `--sp-4` (16 px) gap: 2 × 156 + 16 = 328 px inside the 350 px sleeve. Add `.gf-two-disc` beside `.gf-multi-disc` in `gatefoldBuildSleevePockets()`; drop the centering padding and `overflow-x` for it.
>    - **Thumb cuts:** the sleeve paper's mask gets **two** thumb cuts, one centered over each pocket, instead of the single one at 50%.
>    - **Labels:** each disc's own label stays readable (side letters A/B and C/D), and the "DISC 1 / DISC 2" eyebrows in the track list still line up with them.
>    - **The disc that's playing** shows its pocket empty ("on the platter"), and the other disc stays in its pocket. The pull flourish lifts only the disc being played.
>    - **Wide (desktop) mode:** same side-by-side layout.
>    - **Three or more discs** (box sets) keep today's scrolling row.
> 6. **Tests:**
>    - two-side results identical to `bestSideCut()`;
>    - 4-side balance, and track order kept;
>    - a 70-min album becomes 4 sides on 2 discs; a 40-min album stays at 2 sides;
>    - `discGroupsFor()` returns two groups for a computed double LP;
>    - in the gatefold, two pockets are both inside the sleeve's bounds (no scroll) at the 390 px reference width.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.
>
> **Preview focus (iPhone):** open a computed double LP and a tagged 2-disc album. Check that both discs and both labels are fully visible without scrolling, the thumb cuts sit over each disc, and playing a side-C track empties disc 2's pocket only.

---

## CC6: artist + album key and rebalanced odds (UI: every album's file-drawn pressing changes once)

> Read CLAUDE.md and docs/PRESSINGS_110.md first.
>
> 1. New `pressingKey(t)` = `normKey(artist) + '|' + albumKey(t)`. Use the album artist if present, otherwise the track artist. `selectVariant()` draws from it.
> 2. **Friends' copies too:** `selectVariantForAlbum(albumTitle, tier)` (CR11) draws a friend's pressing from the title alone. It becomes `selectVariantForAlbum(artist, albumTitle, tier)`, using `releases.artist`, which is already synced. That way a friend's copy draws exactly what their own device draws.
> 3. **New odds** (decision 5): in `selectVariantForTierKey()`, the tier-3 mix becomes 5% Jet / 40% solid / 55% effect, and `pickBand()` becomes 50 / 35 / 15. `pickBand()` is shared, so lossless albums get the gentler bands too; the lossless mix (85% solid / 15% Jet) and lossy (Jet only) are unchanged. Update the README tables in `docs/PRESSINGS_110.md`.
> 4. **Earned looks don't move.** `selectRareVariant()` and `selectZoetropeVariant()` keep drawing from the old title-only `variantHashKey()`, so nobody's earned rare pressing or zoetrope changes kind. Only the file-drawn pressing (solid, effect or Jet) changes.
> 5. **The redraw is one-time and covers every album**, because the key changes for all of them. Fine, since no one else has the app yet. Look picks (`albumLookPref`) stay valid if the look is still earned; otherwise fall back to the drawn pressing. Note it in docs/CHANGELOG.md.
> 6. **Tests:**
>    - two same-titled albums by different artists draw independently;
>    - a local copy and a friend's copy of the same album draw the same pressing;
>    - rare and zoetrope draws are unchanged from before the PR;
>    - over 100,000 synthetic hi-res keys, the tier-3 mix and bands land within ±1 point of 5/40/55 and 50/35/15.
>
> Open the PR. Do not merge.

---

## Later (not in this plan)

- **MusicBrainz file matching**, once the MetaBrainz account is live: align your local track list against each candidate release's track list using title edit distance plus duration difference, where a gap means a missing or bonus track (Kleinberg §6.6). Pick the lowest-cost release.
- **Talk to two or three casual listeners** before launch. Seaver finds that recommender teams are almost always expert listeners designing for themselves.
