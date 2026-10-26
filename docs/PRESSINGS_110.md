# PRESSINGS_110 — grow the pressing chart from 76 to 110, add zoetropes, redo metals

Build spec for Claude Code in the Miziki repo (`esang-MAO/Miziki`).
Design source: the "Profile records + pressings" canvas, artboard 4 ("Pressing chart: the 110").
Everything in this folder is meant to be dropped into the repo as reference:

```
PRESSINGS_110.md            ← this file
data/pressings.json         ← every pressing, with colours, rarity, technique, CSS reference layers
zoetropes/*_disc_lp.svg     ← full zoetrope disc art, LP frame count
zoetropes/*_disc_45.svg     ← same, 45 frame count
zoetropes/*_lp_12f.svg      ← unrolled frame strip (sprite sheet), 120 px per frame
zoetropes/*_45_16f.svg      ← same at 45 frame count (Rainfall: 24 / 32)
frames/                     ← PNG renders of the chart, by section, plus close-ups
```

**Before writing code:** find the existing pressing system in the app (the variant hash, the
40 solids / 32 effects / 4 rare chart, the metal unlock, the pressing-chart card on the profile).
Extend it; don't build a parallel one. Keep existing ids and names — every pressing from the old
chart is still in the new one under the same name.

---

## 1. What changes

| Tier | Before | After | Earned by |
|---|---|---|---|
| 1 · Jet | Jet | Jet (unchanged, optional paper label off by default) | lossy file |
| 2 · Solids | 40 | 40 (unchanged) | lossless / hi-res file |
| 3 · Effects | 32 | **54** across 11 techniques | hi-res file |
| 4 · Rare | 4 | **8** | sessions (existing rare unlock), never the file |
| 5 · Zoetropes | — | **8 new** | sessions, never the file |
| Metals | 3–4 finishes | 4 finishes, **new lighting model** | sessions; a finish over any of the 110 |

Total: 40 + 54 + 8 + 8 = **110 pressings**. Metals are not counted; they're a finish.

Shaped / RSD-style pressings are **out of scope** (saved for artist pages later).

## 2. Data

`data/pressings.json` is the source of truth. Port it into the app's pressing table as-is.

- `solids[]`: `id, name, family, ring, body, rim, translucent, rarity`
- `effects[]`: same colour keys plus `technique`, `detail`, `inks`, and `css_layers` — the exact CSS
  the mockup uses to paint each one. Treat `css_layers` as a visual reference; port to whatever the
  disc renderer uses (CSS, canvas or SVG), matching the frames.
- `rare[]`, `zoetropes[]`, `metals[]` as described below.
- `draw`: tier weights and rarity banding (unchanged from today):
  - lossy → Jet 100%
  - lossless → solid 85%, Jet 15%
  - hi-res → effect 70%, solid 25%, Jet 5%
  - inside a tier, band first: common 60%, uncommon 30%, scarce 10%; then a pressing inside the band

### Determinism (unchanged rule)
The album hash alone picks the pressing, so the same album has the same pressing in everyone's
crate. Only file quality changes which shelf is drawn from. No per-user salt.

**Heads-up:** growing the effects shelf from 32 → 54 changes `hash % shelfSize`, so hi-res albums
will re-draw once. See Open decisions.

## 3. Effects — 11 techniques

New techniques are marked ★. Each is two inks (tri-split is three) on the body colour.

| Technique | Count | Notes |
|---|---|---|
| Swirl | 8 | feathered streaks, never a wheel |
| Split | 6 | hard vertical seam |
| ★ Tri-split | 3 | three vertical bands |
| ★ Pinwheel | 4 | six hard wedges from the label — distinct from swirl |
| Marble | 6 | veins of the second ink; Malachite is banded |
| Splatter | 5 | small dense dots, one ink |
| Smoke (T) | 4 | soft blurred clouds, translucent |
| Ring & core | 6 | Heliotrope / Teal / Oxblood Ring, ★Tyrian Target (3 bands), ★Ochre in Jet, ★Coral in Prussian (core + rim) |
| ★ Galaxy | 4 | swirl + small specks of a third ink |
| ★ Burst | 4 | starburst rays fanning from the label, fading out |
| ★ Cloud (T) | 4 | soft islands of a second colour, translucent |

Translucent (T) pressings let the sky behind the platter show through, so they react to the day arc.

## 4. Rare — 8 (session-earned)

Original four, unchanged: **Ultra Clear, Picture Disc** (the album cover printed on the disc),
**Glow** (phosphor, lit in the dark), **Liquid Filled** (colour that moves inside).

New four, all clear- or sky-driven:
- **Moonstone** — chalk marble veins in a clear body
- **Aurora** — aquamarine + heliotrope swirl in clear
- **Black Ice** — Jet core, clear outer band
- **Nychthemeron** — Powder Blue by day, Indigo after sundown; follows the day-arc clock

## 5. Zoetropes — 8 (session-earned)

`Wingbeat, Breaker, Bloom, Orbit, Breach, Pulse, Rainfall, Moth`. All nature/animal motifs.
Colours, accent ink and frame counts are in `zoetropes[]`; art is in `zoetropes/`.

**Placement:** on the platter view the zoetrope disc **replaces the album artwork**. Everywhere
else (crate peek, profile chart, records grid) it renders like any pressing.

**Frame counts:** LP 12 frames (Rainfall 24). A 45 uses its own count: 16 (Rainfall 32).
Use `disc_lp` / `disc_45` and `sprite_lp` / `sprite_45` by the record's format.

**How it animates (strobe model):**
1. Split the disc into two layers.
   - *Frame ring* — the band of figures.
   - *Everything else* — label, grooves, body. Spins smoothly at platter speed as today.
2. The frame ring rotates in **quantised steps of exactly one frame slot** (360° / N), one step per
   strobe tick, with the strobe rate = nominal rps × N
   (33⅓: 0.556 rps × 12 = 6.7 ticks/s · 45: 0.75 rps × 16 = 12 ticks/s).
   Because each slot moves into the previous slot's position on every tick, every figure appears
   to animate in place. One full animation loop = one revolution, so a 45 loops faster than an LP;
   the extra frames keep it smooth.
3. **Sundown:** keep the strobe rate at the *nominal* speed while the platter slows. The ring then
   advances less than one slot per tick, so the figures drift and stutter. Below ~70% speed, stop
   quantising: the ring spins continuously with the rest of the disc and the motion stills.
   Rising back at dawn reverses this.
4. **Pure mode:** always full speed, so zoetropes always animate.
5. Reduced-motion setting: no stepping; show the ring spinning continuously.

## 6. Metals — new lighting model

Four finishes: Bronze, Silver, Gold, Platinum (`metals[]`: shadow / mid / highlight).
Gold and Platinum **invert the label** (dark label, orange spindle ring).

Two layers (see `frames/06_metals.png` and the `metal_*.png` close-ups):

- **Fixed to the screen — never rotates:** a soft "bow tie" of light. A bright wedge toward the
  upper-left with a narrow, brighter specular core; a weaker reflection directly opposite; shadow
  in the two gaps. All edges feathered, no hard quarters. The mockup uses one `conic-gradient`:
  `mid 0°, shadow 45°, mid 95°, weak-highlight 135°, mid 175°, shadow 225°, mid 272°,
  highlight 302°, specular-core 313°, highlight 324°, mid 360°`
  (weak-highlight = mid→highlight 45%; shadow = mid→shadow 75%; core = highlight→white 35%).
- **Spins with the platter:** fine brushed rings, grooves, label, any wear.

**The pressing still shows:** a 3 px rim in the underlying pressing's rim colour plus a soft
underglow in its body colour. A gold Verdigris has a green edge; two gold records differ.

## 7. Profile chart card

Update the pressing-chart card counts to the new shelves, e.g.
`COLORS [n] OF 40 · EFFECTS [n] OF 54 · RARE [n] OF 8 · ZOETROPES [n] OF 8`.
Chip strip grows to match; tapping a chip still jumps the crate to that pressing.
Friends' cards show chips without numbers (unchanged).

## 8. Decisions (settled)

1. **Re-draw on chart growth — accepted.** Hi-res albums re-draw once against the new 54-effect
   shelf. Add `chartVersion: 2` to the pressing table and to any cached/synced pressing, and
   recompute anything stored under version 1 on first launch. Lossy and lossless draws don't
   change (Jet and the 40 solids are untouched). No migration UI, no notice needed.
2. **Zoetropes get their own session milestones** — separate from the existing rare unlock, with
   their own counter and their own pool.

### Zoetrope milestone (defaults — keep the numbers in one config block so they're easy to tune)

**Ken, 2026-10-26: raised from 3 to 10 different days** ("I want the zoetrope to be a bit more
challenging to earn than the metals... I like the idea of having to listen to it on different
days from start to finish" — keeping the mechanic, just raising the bar, since the top metal
(platinum) needs 40 qualifying sessions with no day-spread at all and could in principle be
cleared in one binge sitting; a zoetrope's day-gate can't be rushed that way regardless of the
exact number, since each calendar day only ever contributes one credit no matter how many
play-throughs happen on it — the number below is the already-raised one, not the original spec
value.

- **Per album, per user.** An album earns its zoetrope when you've played **every side start to
  finish, on 10 different days**. "Start to finish" = needle-drop to run-out with no skips or
  scrubs past a track; pausing is fine. Shuffle and single-track plays don't count.
- **Which zoetrope** comes from the album hash, so everyone who earns it on that album gets the same
  motif (same rule as pressings). Only *whether* you've earned it is per user.
- **Format:** a 45 uses the 45 art; a one-track single (no flip) counts its one side.
- **Progress** is quiet: a small frame-tick on the record's sleeve or detail sheet
  (ticks filled as days are completed). No pop-ups mid-listen.
- **The reveal:** when the tenth day completes at run-out, the record is put away and the next
  pull shows the zoetrope via the existing pressing peek. Optional soft haptic on the catch.
- **Precedence:** an earned zoetrope replaces that album's pressing everywhere for that user. If the
  album also has a rare unlock, the zoetrope wins on display; the rare stays counted in the chart.
- **Metals** can still lay over a zoetrope (lighting fixed, frame ring steps underneath).
- **Friends:** a friend sees your earned zoetrope on your crate; it doesn't change their copy.
- **Sync:** store earned zoetropes and day-progress with the account backup.

## 9. Acceptance

- [ ] 110 pressings in the table; counts by tier 40 / 54 / 8 / 8; all old names still present
- [ ] Same album → same pressing on two different accounts
- [ ] Version-1 hi-res pressings recompute once on first launch (`chartVersion: 2`)
- [ ] Zoetrope earned after every side played start to finish on 10 different days; progress ticks show; reveal via pressing peek
- [ ] Each new technique matches its frame in `frames/03_effects.png`
- [ ] Translucent pressings show the sky through the disc
- [ ] Zoetrope replaces artwork on the platter; figures animate in place at full speed
- [ ] 45s use the 16 / 32-frame art
- [ ] Sundown: zoetrope stutters, then stills, then recovers toward dawn; Pure mode always animates
- [ ] Metals: lighting stays still while grooves and label spin; rim + underglow show the pressing
- [ ] Gold / Platinum labels inverted
- [ ] Profile chart card shows the new counts
- [ ] Works in Safari, Chrome on iOS, and Android Chrome
