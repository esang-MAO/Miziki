# Grooves & home shelf — design frames

Canvas: "Miziki Grooves & Home Shelf". Plan: `docs/30_GROOVES_AND_SHELF.md`. Built from the repo's own tokens (`src/styles/00-base.css`): Antonio / Archivo / IBM Plex Mono / Caveat, `--amber` only on the label and sun, stock-card paper for the sign, stickers and notes. Phone frames 390 wide. Album, artist and user names are invented.

| Frame | Step | What it shows |
|---|---|---|
| `Main` | GS3, GS6 | Grooves drawn from the side's tracks (5 bands, gaps, tighter grooves on louder tracks), needle ring + dot, sky-tinted light band, numberless side map + "2 · Night Ferry" in place of the times, Dusk button with the `slowed` chip (Tweak: `showSlowed`). |
| `DropNeedle` | GS4 | Rim held: platter stopped, gaps lit, needle on the gap before track 4, Caveat tag "4 · Lanterns", transport dimmed. |
| `RunOut` | GS5 | Needle in the run-out, long-press loupe on the dead wax: matrix line, hand message, new third line "FLAC 24/96 · PRESSED AT DUSK · 14 NOV"; "Turn to side B" / "Put away". |
| `NightDepth` | GS6 | Sundown › Day. Interactive: depth (Gentle–Deepest) and "At night, the music: Slowed / Keep pitch"; the mono line and the player chip label update. |
| `HomeShelf` | GS7, GS8 | Paper sign "kenspins’s crate"; On the wall (3 framed, "in rotation", "must hear" sticker); last three found (2 pressings + a metal) + "All found ›"; On the turntable; Listening ›; cube shelving with pins 4–5 face-out; "room to grow". Tweak: `username`. |
| `FriendShelf` | GS7, GS8, GS11, GS12 | A friend's sign; Held for you (3 sleeves + note, Look through, hand back); friend-count sticker on a face-out; a sleeve note pinned to "SIDE B · 4". |
| `Listening` | GS9, GS10 | Interactive: ‹ › through Spring / Summer / Autumn. Ring + verdict, Most spun + rows, Played through (found / from), then a record for each part of the day and Kept for a time of day, Share buttons. |

Not drawn: desktop layouts (follow the existing side-panel and two-column patterns), light theme (tokens already cover it; the sign/notes stay paper in both).

**Snapshots:** `png/` holds a 2× render of every frame (what the canvas shows), plus two alternate states: `NightDepth-KeepPitch.png` and `Listening-Summer.png`. Read these when the `.dc.html` sources aren't being opened in the canvas.
