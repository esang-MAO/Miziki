# Shelf, finishes & turntables — design frames

Canvas: "Miziki Shelf Finishes". Plan: `docs/32_SHELF_AND_TURNTABLES.md`. Built from the repo's own tokens: Antonio / Archivo / IBM Plex Mono / Caveat, `--amber` only on record labels, stock-card paper for the sign and notes. All wood and hardware is CSS gradients — no images. Album, artist and user names are invented.

**Start with the PNGs in `png/`** (2× renders). The `.dc.html` files are the canvas sources; their `renderVals()` hold the exact values (the finish table `F` in `ShelfUnit.dc.html`, every turntable's geometry in `Turntable.dc.html`).

| PNG | Frame | Step | What it shows |
|---|---|---|---|
| `01-profile-walnut-playing` | `Main` | ST2, ST5 | Full profile: sign, wall, Listening row, caption "Now spinning…", the unit in Walnut with the Standard turntable and sleeve stand, mini-player (pause showing). |
| `02-profile-paused` | `Main` | ST5 | Same, paused: caption "On the turntable… · paused", play showing; the record has stopped where it was. |
| `03-profile-oak-console` | `Main` | ST3, ST4 | Oak finish with the Console turntable. |
| `04-shelf-finish-picker` | `ShelfFinish` | ST3 | Edit crate › Shelf finish: live preview, five swatches, DELUXE tags on Teak/Ash/Black ash, caption. |
| `05-shelf-finish-ash` | `ShelfFinish` | ST3 | Ash selected. |
| `06-five-finishes` | `FinishLineup` | ST3 | Walnut, Oak, Teak, Ash, Black ash side by side with descriptions. |
| `07-twelve-turntables` | `TurntableLineup` | ST4 | All 12 with descriptions, the two Deluxe ones tagged, and (mono, grey) how each is found — **spec only, never shown in the app**. |
| `08-turntable-picker` | `TurntablePick` | ST4 | Edit crate › Turntable for a Deluxe listener who has found Deck, Clear and Suitcase: only had turntables appear. |
| `09-turntable-picker-deck` | `TurntablePick` | ST4 | Deck selected. |

**Spinning (ST5):** in `Turntable.dc.html`, `.rec::before` is the disc (`translateY(-50%) scaleY(.11) rotate(θ)`, keyframes `mz-spin`, 1.8 s per turn at 33⅓), `.uplab` turns the Upright's label face-on, and a `.paused` class on the root pauses both; `prefers-reduced-motion` removes the animation. The PNGs are stills.

Not drawn: desktop (scale the unit with the profile column), light theme (wall/floor take the light tokens; wood and paper stay as they are).
