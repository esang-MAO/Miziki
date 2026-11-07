# 32 · The shelf, its finishes and the turntables

The profile's shelving becomes a real piece of furniture: a solid-wood cube unit drawn with grain, depth and shadow, standing against the wall on a floor line. A turntable sits on top of it with the record that's on, and that record **spins while you're playing and stops when you pause**. Owners choose the shelf's **finish** and the **turntable**; friends who visit see both exactly as the owner set them.

Builds on docs/30_GROOVES_AND_SHELF.md (the sign, the wall, the cube shelving, "in rotation" with 5 pins). **Do GS7–GS8 of plan 30 first**; this plan replaces GS8's flat CSS cubes with the rendered unit.

**Decisions (Ken, Nov 7):**
- **Rendered shelving:** a 2 × 3 cube unit in solid wood — grained posts and rails, a lit top surface, darker grained back panels, inner shadow from the shelf above, a shelf-top strip each record stands on, a plinth and a floor contact shadow. Records spine-out; pins 4–5 face-out (plan 30); sleeves at the end of a short row lean; a partly empty last cube carries a taped "room to grow" note.
- **The top of the unit:** the turntable (left) with the record that's on, and a sleeve stand (right) showing that record's cover. This **absorbs plan 30's "On the turntable" row**: one caption line above the shelves remains — "Now spinning: [album] · [track]" while playing, "On the turntable: [album] · paused" when paused.
- **Finishes (5):** Walnut (default), Oak, Teak, Ash, Black ash. **Walnut and Oak come with Miziki; Teak, Ash and Black ash come with Deluxe.** The picker shows all five; the three Deluxe ones carry a small `DELUXE` tag.
- **Turntables (12):** Standard, Console, Linear, Deck, Clear, Suitcase, Broadcast, Upright, Radiogram, Slate, Lathe, Horn. Generic styles, never a real brand's model or name.
- **How turntables are had:** Standard for everyone. **Every other turntable can be earned by listening. Deluxe also includes two right away: Console and Linear.** The picker shows only turntables you have — no locked tiles, no placeholders, no counts (same rule as pressings, docs/24_QUIET_COUNTS.md). The earning rules are never shown in the app.
- **Friends see your shelf in your finish and your turntable.**
- **The record spins** at its real speed while you're playing (33⅓ → one turn per 1.8 s, 45 → 1.33 s, 78 → 0.77 s once 78s exist); with Sundown **Slowed** it slows with the music. Paused, it stops where it is (no snap back). Reduce Motion: it stays still, the caption still says what's on.

**Designs:** `docs/design/shelf-turntables/` — canvas "Miziki Shelf Finishes": `Main` (the profile, interactive play/pause), `ShelfUnit` (the unit; props `finish`, `model`, `spinning`), `Turntable` (12 models; props `model`, `spinning`), `ShelfFinish` (picker), `FinishLineup`, `TurntableLineup` (with the earning rules as a spec note), `TurntablePick` (picker). PNG snapshots in `png/`. Album, artist and user names are invented.

**Order:** ST0 → ST6, one PR each, the usual routine (preview, merge, after-merge check). ST1 first (Deluxe flag), then ST2 (the unit), then ST3/ST4/ST5 in any order, ST6 last (needs the social migration).

**Every new saved key** goes into `serializePrefs`/`parsePrefs` with a default in `S` and a round-trip test, and into CLAUDE.md's backup table (CLAUDE.md, Persistence).

---

## ST0: docs only

> Read CLAUDE.md first. Docs-only PR: add this plan and `docs/design/shelf-turntables/`. In docs/30_GROOVES_AND_SHELF.md, add a one-line note at the top of GS8: "**The cube shelving's look is superseded by docs/32_SHELF_AND_TURNTABLES.md** (rendered unit, turntable on top)". No code. Open the PR. Do not merge.

---

## ST1: the Deluxe flag

> Read CLAUDE.md first. There is no purchase yet; this step only adds the entitlement the next steps read.
>
> 1. `S.deluxe` (boolean, default false), saved and **backed up** (last write wins; it follows the account). Add the backup-table row.
> 2. Until App Store purchase exists (Capacitor/StoreKit, later), it can only be turned on by a dev-only switch: `?deluxe=1` in the URL sets it, `?deluxe=0` clears it. No visible UI.
> 3. One helper, `hasDeluxe()` in a new `src/deluxe.js`, is the only place anything checks it.
> 4. **Tests:** prefs round-trip; URL switch; backup merge.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

---

## ST2: the rendered shelf unit

> Read CLAUDE.md, this plan and the design README (frames `Main`, `ShelfUnit`; `png/01–03`) first. Profile: `src/profile/storefront.js` (the plan-30 shelves), styles in the storefront CSS file.
>
> 1. Replace the plan-30 CSS cube grid with the rendered unit, matching `ShelfUnit`: 342 wide on phone (scale with the column on desktop), 2 × 3 cubes; grained posts/rails, top surface, back panels, inner shadows, shelf-top strips, plinth, floor shadow. All wood drawn with CSS gradients (no images), driven by one set of custom properties per finish (`--wood-base`, `--wood-hi`, `--wood-lo`, `--wood-line`, `--wood-line2`, `--wood-back`, `--wood-top`, `--wood-plinth`) — exact values in `ShelfUnit.dc.html`'s `F` table. Walnut until ST3.
> 2. Records: spines from the crate's order; each spine's color is the album's existing crate spine/edge color, with the same cylinder shading as the frame. Pins 4–5 face-out with their covers. The last row of the last filled cube leans. An unfilled last cube gets "room to grow" (`var(--hand)` on a paper note).
> 3. Top of the unit: the turntable (Standard until ST4) with the record that's on, and the sleeve stand with its cover. Nothing on (empty library): the turntable stands empty, no stand.
> 4. **Removes:** plan 30's "On the turntable" row; replaced by the one caption line above the shelves (wording above).
> 5. Wall and floor: a baseboard line and a darker floor band behind the unit's foot, as in `Main`.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus (iPhone):** the unit reads as wood, not stripes; spines match the crate; nothing overlaps at the narrowest phone width.

---

## ST3: shelf finishes

> Read CLAUDE.md and the README (`ShelfFinish`, `FinishLineup`; `png/04–06`) first. Needs ST1, ST2.
>
> 1. `S.shelfFinish`: `'walnut' | 'oak' | 'teak' | 'ash' | 'black'`, default `'walnut'`, saved, backed up (last write wins).
> 2. Edit crate › **Shelf finish** sheet, as drawn: a live preview of the unit above, five wood swatches (selected = cream ring, not amber), each finish's one-line description, and the caption "Walnut and Oak come with Miziki; Teak, Ash and Black ash come with Deluxe. Friends who visit your crate see it in your finish."
> 3. Without Deluxe, tapping Teak/Ash/Black ash previews it on the unit but doesn't save; leaving the sheet returns to the saved finish. No upsell copy beyond the tag and caption.
> 4. If Deluxe is later turned off, a saved Deluxe finish falls back to Walnut on display (the saved value stays).
> 5. **Tests:** prefs round-trip; gating; fallback.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

---

## ST4: turntables and how they're found

> Read CLAUDE.md and the README (`Turntable`, `TurntableLineup`, `TurntablePick`; `png/07–09`) first. Needs ST1, ST2. **`src/history/` stays the only place that writes listening-derived records**; the found-turntables list lives with achievements.
>
> 1. **Drawings:** the 12 models as in `Turntable.dc.html` — one small component, CSS only, front view, 200 × 112 at phone scale. Names and one-line descriptions as in `TurntableLineup`.
> 2. **Found list:** `S.turntablesFound` `{ id: { foundAt, phase } }` (Standard always present), saved in the achievements store, backed up (**union; earliest date wins**). `S.turntable` (selected id, default `'standard'`), saved, backed up (last write wins).
> 3. **Deluxe** (`hasDeluxe()`): Console and Linear count as had without being in the found list. If they're also earned, they're recorded as found.
> 4. **Earning rules** — checked in `src/history/achievements.js` at the same point metals are; thresholds are internal constants, never shown:
>    - **Console:** plays in all three months of one season (plan 30 GS1 seasons).
>    - **Linear:** 10 sides played straight through with no skip, lift or seek (plan 30 GS2 log; add a `clean` flag per entry).
>    - **Deck:** scratching used on 3 different days.
>    - **Clear:** 5 whole records played from hi-res files (tier per `record-art/tiers.js`).
>    - **Suitcase:** a record from a friend's held-for-you stack played through (plan 30 GS11).
>    - **Broadcast:** 7 whole records finished between solar midnight and first light.
>    - **Upright:** one record kept in rotation (pinned) for 90 days and played in each of those three months.
>    - **Radiogram:** plays in every phase of the day within one season.
>    - **Slate:** 365 days since your first play, with plays in every season.
>    - **Lathe:** your first rare pressing (rare unlock).
>    - **Horn:** 5 whole pre-1955 records played (dormant until the 78 format exists; check release year).
> 5. **Found quietly:** a new turntable simply appears in the picker — no toast, badge, dot or feed event (CLAUDE.md, How Miziki behaves). The found date and phase are kept for a future year-end wrap.
> 6. Edit crate › **Turntable** sheet, as drawn: a live preview of the unit's top, a 2-column grid of the turntables you have (selected = cream ring), the selected one's description.
> 7. **Tests:** each rule (pure functions over the history data); union merge; Deluxe grants; picker lists only what's had.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

---

## ST5: the record spins

> Read CLAUDE.md and the README (`Main` is interactive: play/pause in its mini-player) first. Needs ST2.
>
> 1. The record on the shelf's turntable is a full disc tilted into perspective (`scaleY(.11)`, Upright: face-on) with label print marks, so a turn is visible at shelf size. While playing it rotates continuously; paused, the animation pauses in place.
> 2. Speed: one turn per `60 / rpm` seconds from the record's format (`record-art/format.js`), multiplied by the current Sundown audio rate when night pitch is **Slowed** (plan 30 GS6); with **Keep pitch**, the platter rate. Changes ease, never jump.
> 3. Your own profile follows the player (playing/paused). A friend's profile follows their `now_spinning` row (already realtime): spinning while they're playing, still otherwise. Stopped or ended: still, the caption says "On the turntable".
> 4. `prefers-reduced-motion`: no rotation.
> 5. Cost: one CSS animation; it stops when the profile isn't on screen.
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** play, pause, play: the record stops where it was and carries on from there. A 45 turns visibly faster.

---

## ST6: friends see your finish and turntable

> Read CLAUDE.md and `supabase/migrations/` first. New migration (logs itself).
>
> 1. `profiles.shelf_finish text` and `profiles.turntable text`, both nullable, check-constrained to the known ids; written by the owner only (existing profile RLS), read under the same visibility rules as the profile.
> 2. The client writes them when `S.shelfFinish`/`S.turntable` change (signed in only). A friend's crate renders the unit in their finish with their turntable; null → Walnut/Standard.
> 3. The server never decides Deluxe or earning; it stores the choice. (A modified client could show a Deluxe finish — acceptable: it's cosmetic.)
> 4. Update CLAUDE.md's server-side table and the privacy policy (two cosmetic choices, visible like the profile).
>
> Lint/tests/previews as usual. Open the PR. Do not merge.

**Preview focus:** `?social=demo`: a friend's crate in Oak with the Console.
