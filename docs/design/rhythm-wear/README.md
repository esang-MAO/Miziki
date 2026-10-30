# Rhythm and wear: design handoff

Frames for `docs/23_RHYTHM_AND_WEAR.md`. The `.dc.html` files are the design canvas's source and need the canvas runtime to display, so read them as text: layout, sizes, colours and copy are all in the markup. The live canvas is "Miziki Four Hinges" (claude.ai). Build with Miziki's real tokens and components (`src/styles/`), not by copying this markup.

Sample data: Columbia, MD on Oct 30 (dawn 7:06, sunrise 7:34, solar noon 12:52 PM, sunset 6:10 PM, dusk 6:38, solar midnight 12:52 AM). `[Bracketed]` text is a placeholder.

**On-screen wording stays plain.** The ideas behind these features (CLAUDE.md, "How Miziki behaves") never appear as copy. No new names for times of day: use the existing phase words (Night, Twilight, …) and trend words (Easing down, Slowest, Rising, Full speed).

| Frame | File | Step |
|---|---|---|
| Sundown · Day · night, live | `Main.dc.html` | RW1, RW3 |
| Sundown · Day · previewing 3:30 AM, rising | `Stirring.dc.html` | RW1 |
| Home · after sunset | `HomeEvening.dc.html` | RW2 |
| Home · morning | `HomeMorning.dc.html` | RW2 |
| This record only · playing | `OneRecord.dc.html` | RW3 |
| Paused after a record at sunset | `RestAtHinge.dc.html` | RW3, RW4 |
| Evening glance · first layer | `GlanceFirst.dc.html` | RW5 |
| Evening glance · deepest layer | `GlanceDeep.dc.html` | RW5 |
| Seasonal sky tint | `Seasons.dc.html` | RW6 |
| Wear · one record over its life | `WearStages.dc.html` | RW7 |
| Wear · a well-loved record opened | `WearGatefold.dc.html` | RW7 |

## RW1 · the return from midnight

- The dial is unchanged except for one addition while the platter is rising: a thin amber arc on the ring, from solar midnight to the current position (`Stirring.dc.html`). No new ticks or labels on the dial.
- The event row stays as today: `SUNRISE 7:34 · Sunrise in 4h 4m · SUNSET 6:10`.
- Reading card: phase word + trend + rate, e.g. "Night · Rising · 0.805×", with the line "Rising slowly since midnight. Back to full speed at sunrise, 7:34." Live at night before midnight: "Night · Slowest · 0.80×", "Settled for the night. After midnight the platter starts rising, slowly enough that you won't notice until near sunrise."

## RW2 · Home once a day

- Section heading **Activity** (as today), with a right-aligned mono "Today".
- Morning banner (raised card): mono kicker "Updated this morning · 7:34" in the morning phase colour, body "Everything your friends added since yesterday. Home updates once a day."
- After sunset, a dashed card closes the list: Antonio 20px caps "You're all caught up", body "New activity shows up tomorrow morning."
- Now spinning stays live at all hours, labelled "· live".

## RW3 · This record only, and stopping at sunset and midnight

- Player: a raised card under the title with a real switch: "This record only" / "Your queue waits. When this side ends, playback stops." The queue button is hidden while it's on, and only the current side's tracks are listed.
- Sundown › Day, under the depth control: switch row "Stop between records at sunset and midnight" / "For an hour around sunset and around midnight, playback stops when a record ends instead of moving on to your queue." Off by default.
- Paused state (`RestAtHinge.dc.html`): the record rests half out of its sleeve; header mono "Side A · ended 6:31 PM"; raised card with mono kicker "Paused after this record" in the current phase colour, then "Around sunset, playback stops between records." and "Your queue is still there. Press play to continue." Play (primary) continues the queue; a borderless "FLIP TO B" plays the other side when there is one.

## RW5 · evening glance (phones)

- First layer (idle 10 s, playing, twilight or night): everything but the side line, platter, title, artist and a progress line at 35% fades out.
- Deep layer (idle 25 s, night only): only the platter and the title at 70%.
- Fade out slow (1.6 s, then 2.4 s), return quick (0.25 s). Any touch returns everything, and that first touch doesn't press whatever was under it.

## RW6 · seasonal sky tint

Colour only. Speed, depth and sound never change by season. Dark-theme anchors drawn in `Seasons.dc.html` (sky1 / sky2):

| Season (peak) | Midday | Twilight |
|---|---|---|
| Spring (Apr 20) | `#1B3236` / `#0F1C1E` (a touch greener) | `#33262C` / `#1A1216` (rose) |
| Summer (Jul 20) | `#1F3340` / `#111C24` (clearer blue) | `#3A2629` / `#1C1214` (warm red) |
| Autumn (Oct 20) | `#262F33` / `#141A1C` (greyer, warmer) | `#36261F` / `#1B1310` (rust) |
| Winter (Jan 20) | `#1C2B38` / `#0F1822` (cold blue) | `#2C2333` / `#16101C` (violet) |

The other six day anchors take the same small shift as their nearest drawn anchor. Light theme gets the equivalent gentle shift. Every blended value must still pass the existing contrast checks. Setting: "Sky follows the seasons", Profile › Settings › Appearance, **on by default**.

## RW7 · wear

Wear sits **alongside** metals (it doesn't replace them) and can be switched off. Sleeves stay square at every stage: no rounded corners, and no circular ring wear on the sleeve (it reads wrong).

| Stage | Sleeve | Vinyl and label |
|---|---|---|
| New | Crisp | Clean, full-colour label |
| Light | Faint edge scuff (inset 1px warm-cream line at 12%), one small corner ding | Label 5% faded |
| Worn | Sun-fade from one side (cream `rgba(214,196,160,.2)` gradient), a straight crease across one corner, scuffed edges (2px inset at 18% + soft inner glow), bottom seam starting to open (a short dark gap) | A few straight hairlines; label losing ink |
| Well loved | Yellowed toward cream (gradient to 30%), a folded corner (triangle), a faint old-sticker rectangle (14%), tape over the split seam | More hairlines; pale label. Sound unchanged |

Gatefold (`WearGatefold.dc.html`): under the artist, "Well loved · 412 plays since March 2025" (the first word follows the stage: no word for New and Light, "Worn" or "Well loved" after); per-side mono rows "SIDE A · 260 PLAYS" with a thin 4px bar. No restore control anywhere. Sealed records never show wear.
