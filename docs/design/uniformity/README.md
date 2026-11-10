# Uniformity: design handoff

The mockups behind **`docs/36_UNIFORMITY.md`** (UN0–UN18). Two Claude Design canvases, both approved by Ken on 2026-11-09:

- **"Miziki Gatefold Polish"** — https://claude.ai/artifact/MdVvbhs3muWF4s6GxvEYUy
- **"Miziki Uniformity"** — https://claude.ai/artifact/5qbTo7wfy18WqF4X4ohq6k

**No PNG renders in this folder.** UN0's instructions ask for a 2× PNG export of every frame, matching the convention in `docs/design/audio/png/`, `docs/design/wall/png/`, etc. This session had no tool that can rasterize a Design canvas's artboards (no headless-browser/export access to the canvas runtime) — only the canvas's own `.dc.html` source and the plan doc's own description of each frame. The frame table below stands in for the PNGs until someone with canvas export access (Ken, or a future session with that tool) adds them; read the `.dc.html` source as text, or open the live canvas link above, in the meantime. **Build with Miziki's real CSS and components, not by copying this markup** — same rule as every other design-handoff folder in `docs/design/`.

## Miziki Uniformity canvas — 27 frames

| Row | Frame | Shows | Used by |
|---|---|---|---|
| 1 | `Main` | The shared parts (UN2's table), dark and light side by side | UN2 |
| 2 | `PlayerLight` | The full player in light theme | UN11 |
| 2 | `PlayerMenu` | The player ⋯ menu, rebuilt as a list menu with the Private session switch | UN3 |
| 2 | `Sundown` | The Sundown sheet, Day view, rebuilt with the parts | UN4, UN11 |
| 2 | `Artist` | The artist page header/menu/action row | UN3, UN13 |
| 2 | `Settings` | The Settings screen, full order | UN4 |
| 3 | `Profile` | The profile home with one header | UN12 |
| 3 | `Listening` | The Listening screen (season header, Most spun, Top albums/songs links) | UN13 |
| 3 | `Playlists` | The Playlists empty state | UN5 |
| 3 | `LibraryEmpty` | The library empty state | UN5 |
| 4 | `DesktopProfile` | Desktop profile: wall left, shelf right | UN17 |
| 5 | `ProfileWall` | The wall: in-rotation ledge + pressing cubby (dark) | UN14 |
| 5 | `ProfileShelf` | The shelf unit, rows that grow, colour spines | UN15 |
| 5 | `ProfileWallLight` | The wall in light theme | UN14 |
| 5 | `TurntablePicker` | The turntable picker sheet | UN15 |
| 5 | `DesktopWall` | The wall at desktop scale | UN17 |
| 6 | `PlayerNight` | The full player at night (two spec lines, amber ink) | UN11 |
| 6 | `SoundView` | Sundown's Sound view (Vinyl toggle, starting point, surface noise) | UN4 |
| 6 | `ListeningData` | Listening screen detail pass | UN13 |
| 6 | `Records` | The Records screen (segmented All records/Pressings filter) | UN13 |
| 6 | `WallOne` | The wall with exactly one pressing found (single cubby section) | UN14 |
| 6 | `DesktopGatefold` | The gatefold centred at full desktop size | UN17 |
| 6 | `DesktopSettings` | Settings in a centred 640px desktop column | UN17 |
| 7 | `TrackMenu` | The gatefold track long-press sheet, raised above mini-player/tab bar | UN3 |
| 7 | `RowMenu` | The song ⋯ sheet | UN3 |
| 7 | `Resting` | The end-of-record card in place of the spec lines | UN11 |
| 7 | `FriendCrate` | A friend's crate using the same plate/wall/shelf as yours | UN16 |

## Miziki Gatefold Polish canvas — 7 frames (folded into UN6–UN10)

| Frame | Shows | Used by |
|---|---|---|
| `Main` | A 10″ EP gatefold spread, tinted from its cover | UN6, UN7, UN8, UN9 |
| `LP` | A 12″ LP gatefold spread | UN6, UN7, UN8 |
| `BackCover` | The back cover: Archivo titles, two columns per side, footer above the line | UN10 |
| `Light` | The gatefold in light theme | UN1, UN6 |
| `TodayFront` | Today's build, front, for comparison | — |
| `TodayBack` | Today's build, back, for comparison | — |
| `TodayLight` | Today's build, light theme, for comparison | — |

Frame-to-filename mapping above is `{Frame}.dc.html` in each canvas's `project/` folder. Reading a `.dc.html` file (via the Artifact tool's `read` action) shows the artboard's own source, which needs the canvas runtime and won't render correctly opened directly in a browser.
