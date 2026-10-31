# 26 · Record sizes and mandala zoetropes

Two PRs that follow `docs/25_FROM_SCRATCH.md`, which is merged. They redraw the records themselves in the same look:
- **SZ1:** 7″, 10″ and 12″ records drawn to scale on the platter, with real label sizes.
- **SZ2:** nine mandala zoetropes replacing the eight figurative ones.

**Decisions (Ken, Oct 31):**
- **Sizes:** label sizes follow real pressing-plant standards (12″ and 10″: 100 mm). The 7″ label is drawn slightly larger than its 84 mm standard, at **90 mm**.
- **Zoetropes:** the nine mandalas are **Lotus, Sunwheel, Tidepool, Lantern, Starseed, Kaleido, Unfurl, Ember and Moonwheel**. Moonwheel carries the old moon-phase design into a mandala. **Nobody has earned a zoetrope yet**, so the old set is replaced outright, with no id mapping.

**Designs:**
- `docs/design/sizes-zoetropes/`: frames plus the 27 zoetrope art files in `zoetropes/`, and the `gen.py` that made them.
- The live, spinning zoetropes are on the "Miziki Mandala Zoetropes" canvas.

**Order:** SZ1 then SZ2, one PR each, with the usual routine (preview, merge, after-merge check). SZ2 depends on SZ1's size attribute.

**Replace, don't layer** (`docs/25_FROM_SCRATCH.md`'s rules apply):
- Delete what you replace in the same PR, with no aliases, shims or leftover classes.
- Rewrite tests instead of stacking them.
- Every PR description has a **Removed** section with greps showing zero hits.
- CLAUDE.md describes only the current app; history goes to `docs/CHANGELOG.md`.

---

## SZ1: record sizes on the platter (7″, 10″, 12″)

> Read CLAUDE.md, docs/16 §5 (AU10) and `docs/design/sizes-zoetropes/README.md` (frames `01`–`04`). Files: `src/styles/02-stage-platter.css`, `player/transport.js` (`load()`'s format toggle), `record-art/format.js`. Today a 7″ is drawn at 58% with a 45 adapter, and a **10″ is drawn the same size as a 12″**. This PR draws all three to scale with real label sizes.
>
> 1. **One size attribute, not a class per size:** `load()` sets `#platterStage`'s `data-size` to `7`, `10` or `12` from `S.recordFormat.size`. This replaces the `format-7in` class toggle. It applies wherever the platter is drawn: the full player, the desktop player panel and Focus.
> 2. **Record diameter, as a share of the 12″ platter:** 12″ is 100%; 10″ is 82.8% (`.platter-box` inset 8.6%); 7″ is 57.9% (inset 21.05%).
> 3. **Label diameter, as a share of the record:**
>    - 12″: 100 mm label, 33% of the record (label inset 33.5%).
>    - 10″: 100 mm, 40% (inset 30%).
>    - 7″: 90 mm, 51.5% (inset 24.25%).
>
>    Label text keeps its sizes and moves in to suit. The 7″ label's text sits in the band above and below the centre hole.
> 4. **Centre hole:** 12″ and 10″ use the true small spindle hole, 2.4% of the 12″ platter (8 px at 342 px). The 7″ keeps its large hole, 21.7% of the 7″ record, with the three-spoke **45 adapter** (`.disc45-adapter`) drawn in warm dark grey (`#3A3236` spokes and ring over the mat colour). The adapter turns with the record, as it does today.
> 5. **The platter around a smaller record:** `.platter-mat` becomes a warm felt mat (`radial-gradient(circle, #241F20, #1E191A 62%, #181415)`). Its edge has a ring of strobe dots: `repeating-conic-gradient` at 16% cream every 5°, masked to the outer 5 px with `radial-gradient(closest-side, …)`. The mat shows under 7″ and 10″ records only; a 12″ covers it.
> 6. **Format chips:** "7″ · 45", "10″ · 45", "12″ · 45", "12″ · 33⅓" (`formatChipText()`, unchanged).
> 7. **Dead-wax etchings and the run-out band** (AU10) keep their radius rules, now relative to each record's own size.
> 8. **Tests:** the size attribute for each format cell (7-45, 10-45, 12-45, 12-33); the 7″ adapter is present only at size 7.
>
> **Removed:**
> - The `format-7in` class, its `classList.toggle` in `transport.js`, and every `.platter-stage.format-7in` rule. Each is rewritten as a `[data-size]` rule in place.
> - `.label`'s single fixed inset, replaced by the three per-size insets.
> - The old `.platter-mat` background.
>
> Grep for `format-7in`: zero hits. Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** play a single (7″), a short EP (10″) and an album (12″). Each matches frames `01`–`03`, and the mat shows only around the 7″ and 10″.

---

## SZ2: mandala zoetropes (replaces the eight figurative zoetropes)

> Read CLAUDE.md, `docs/PRESSINGS_110.md` §5 and the README (frames `05`–`10`). Depends on SZ1. Files: `record-art/tiers.js`, `record-art/zoetropes/`, `src/styles/02-stage-platter.css`, `record-art/looks.js`.
>
> 1. **The nine** (ids, names and inks; in `zoetropes[]` the `colors` stay the existing positional `F(ink, body, accent)`):
>
>    | id | Name | ink | body | accent | note |
>    |---|---|---|---|---|---|
>    | `lotus` | Lotus | `#C2566F` | `#E8DCC4` | `#3F8C7E` | Rose and verdigris on isabelline — three rings of petals open and close. |
>    | `sunwheel` | Sunwheel | `#E6DCC8` | `#6E2925` | `#D9A441` | Bone and ochre on oxblood — the rays turn one way, the chevrons the other. |
>    | `tidepool` | Tidepool | `#8FD3CC` | `#1F4A55` | `#EFE9DF` | Aquamarine and chalk on petrol — scalloped rings swell like ripples. |
>    | `lantern` | Lantern | `#D19A5B` | `#2B2A2E` | `#B9D9EB` | Caramel and powder blue on graphite — lights stream out along spiral arms. |
>    | `starseed` | Starseed | `#EFE9DF` | `#262B5C` | `#D2493A` | Chalk and vermilion on indigo — the star breathes; the stars twinkle. |
>    | `kaleido` | Kaleido | `#2B5586` | `#E6DCC8` | `#C4302B` | Prussian and vermilion on bone — triangles and diamonds twist in place. |
>    | `unfurl` | Unfurl | `#CFE3B5` | `#23463F` | `#E07A5F` | Sage and coral on deep verdigris — fronds sway and curl. |
>    | `ember` | Ember | `#E0563F` | `#1C1A1E` | `#E3B04B` | Vermilion and ochre on jet — flames flicker; sparks drift off the edge. |
>    | `moonwheel` | Moonwheel | `#DED7C7` | `#3B4080` | `#E6E2DA` | Bone moons and chalk stars on indigo — one full lunation; the tide rises toward full. |
>
> 2. **Art:** copy `docs/design/sizes-zoetropes/zoetropes/<id>_disc_lp.svg`, `<id>_disc_45.svg` and `<id>_disc_7in.svg` into `src/record-art/zoetropes/`. The three versions:
>    - LP: 12 frames, art from the 12″ label edge outward.
>    - 45: 16 frames, fitted outside the 10″ label. It's used for 10″ and 12″ records at 45.
>    - 7″: 16 frames, fitted outside the 7″ label.
>
>    In `tiers.js`, each def gets `discLp`, `disc45` and `disc7in` (`new URL(…, import.meta.url)`, the same pattern as today), `framesLp: 12` and `frames45: 16`. The art picker chooses `disc7in` when `format.size === '7"'`, `disc45` for any other 45, and `discLp` otherwise. It extends today's `format.speed === RPM_45 ? def.disc45 : def.discLp` line rather than adding a second picker. Don't copy `gen.py` into `src/`; it stays in the design folder.
> 3. **The animated ring covers the whole mandala:** `.disc-zoetrope-ring`'s fixed band (radius 54–91) becomes one band per size, from the label edge to the record edge: 34–99% of the radius on a 33⅓ 12″, 41–99% on a 10″ or 12″ at 45, and 52–99% on a 7″. Use `radial-gradient(closest-side, …)` so the percentages are fractions of the radius. The current `circle` keyword measures to the corner, not the edge. Key the bands off SZ1's `data-size` and the speed.
> 4. **Unchanged:**
>    - The strobe model in `record-art/zoetrope-motion.js`: quantised steps of one slot, the Sundown drift below full speed, stillness below 0.7×, and Pure always animating.
>    - Earning: every side on 10 different days, with the album hash choosing which design.
>    - Precedence over pressings and metals, and the reduced-motion rule.
>
>    `ZOETROPE_IDS` simply holds the nine new ids.
> 5. **The chart grows to 111** (40 solids, 54 effects, 8 rare, 9 zoetropes). Nothing shows a count (docs/24), so this only changes docs and tests.
> 6. **Docs:** in `docs/PRESSINGS_110.md` §5, mark the figurative set as "**Superseded by docs/26_SIZES_AND_ZOETROPES.md SZ2**" and point to this table.
> 7. **Tests:** update `tests/unit/tiers.test.js` for the nine ids, their colours and `disc7in`. Add the art-picker case for each format cell and `selectZoetropeVariant` over nine. `zoetrope-motion.test.js` stays unchanged.
>
> **Removed:**
> - The eight old defs (`wingbeat`, `breaker`, `bloom`, `orbit`, `breach`, `pulse`, `rainfall`, `moth`) and their 16 `new URL` constants.
> - All 32 old files in `src/record-art/zoetropes/`, both disc art and the `_12f`/`_16f`/`_24f`/`_32f` sprite strips.
> - The `spriteLp`, `sprite45` and `motif` fields, which nothing in `src/` reads.
> - Rainfall's 24/32-frame special case.
>
> Grep for each old id and for `sprite`: zero hits in `src/` and `tests/`. Lint and unit tests pass; both builds preview with no console errors. Open the PR with the preview link at the top. Do not merge.

**Preview focus (Ken, iPhone):** earn a zoetrope on a test library (or force `S.zoetropeUnlocked` in a preview build) on a 12″ at 33⅓, a 10″ and a 7″. Each one blooms in place at full speed and fills from the label to the edge. Turn the Sundown dial to dusk and then past 0.7×: it drifts, then just turns. In Pure it always animates.
