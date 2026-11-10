# Uniformity: design handoff

The mockups behind **`docs/36_UNIFORMITY.md`** (UN0–UN18). Two Claude Design canvases, both approved by Ken on 2026-11-09:

- **"Miziki Gatefold Polish"** — https://claude.ai/artifact/MdVvbhs3muWF4s6GxvEYUy
- **"Miziki Uniformity"** — https://claude.ai/artifact/5qbTo7wfy18WqF4X4ohq6k

The PNGs in `png/` are 2× renders of each artboard, exported from Ken's standalone HTML exports of both canvases (self-contained bundles with every artboard inlined as an iframe — no claude.ai session needed to render them). **Build with Miziki's real CSS and components, not by copying this markup** — same rule as every other design-handoff folder in `docs/design/`.

## Miziki Uniformity canvas — 27 frames

| Row | Frame | PNG | Caption (from the canvas) | Used by |
|---|---|---|---|---|
| 1 | `Main` | `png/1-main.png` | Shared parts · dark and light | UN2 |
| 2 | `PlayerLight` | `png/2-player-light.png` | Player · light theme text fixed | UN11 |
| 2 | `PlayerMenu` | `png/2-player-menu.png` | Player ⋯ · fits, grouped | UN3 |
| 2 | `Sundown` | `png/2-sundown.png` | Sundown · nothing cut off | UN4, UN11 |
| 2 | `Artist` | `png/2-artist.png` | Artist · remove in ⋯, labelled pressings | UN3, UN13 |
| 2 | `Settings` | `png/2-settings.png` | Settings · one row style | UN4 |
| 3 | `Profile` | `png/3-profile.png` | Profile · one header | UN12 |
| 3 | `Listening` | `png/3-listening.png` | Profile › Listening | UN13 |
| 3 | `Playlists` | `png/3-playlists.png` | Playlists · empty | UN5 |
| 3 | `LibraryEmpty` | `png/3-library-empty.png` | Library · empty | UN5 |
| 4 | `DesktopProfile` | `png/4-desktop-profile.png` | Desktop profile · sidebar stays, two columns | UN17 |
| 5 | `ProfileWall` | `png/5-wall.png` | Wall · one heading style, one cubby | UN14 |
| 5 | `ProfileShelf` | `png/5-shelf.png` | Shelves · one spine per record, colour spines | UN15 |
| 5 | `ProfileWallLight` | `png/5-wall-light.png` | Wall · light theme | UN14 |
| 5 | `TurntablePicker` | `png/5-turntable-picker.png` | Turntable picker · name up top | UN15 |
| 5 | `DesktopWall` | `png/5-desktop-wall.png` | Desktop · wall and shelves in proportion | UN17 |
| 6 | `PlayerNight` | `png/6-player-night.png` | Player · one bar, two spec lines | UN11 |
| 6 | `SoundView` | `png/6-sound-view.png` | Sundown Sound · same parts as Day | UN4 |
| 6 | `ListeningData` | `png/6-listening-data.png` | Listening · one header, plain captions | UN13 |
| 6 | `Records` | `png/6-records.png` | Records · three across, no counts | UN13 |
| 6 | `WallOne` | `png/6-wall-one.png` | Wall · cubby sized to what's found | UN14 |
| 6 | `DesktopGatefold` | `png/6-desktop-gatefold.png` | Desktop gatefold · centred spread | UN17 |
| 6 | `DesktopSettings` | `png/6-desktop-settings.png` | Desktop settings · readable width | UN17 |
| 7 | `TrackMenu` | `png/7-track-menu.png` | Track long-press · full menu above the mini-player | UN3 |
| 7 | `RowMenu` | `png/7-row-menu.png` | Song ⋯ · same list menu as everywhere | UN3 |
| 7 | `Resting` | `png/7-resting.png` | End of record · card that keeps the controls on screen | UN11 |
| 7 | `FriendCrate` | `png/7-friend-crate.png` | Friend's crate · same wall and shelf as yours | UN16 |

## Miziki Gatefold Polish canvas — 7 frames (folded into UN6–UN10)

| Frame | PNG | Caption (from the canvas) | Used by |
|---|---|---|---|
| `Main` | `png/gf-1-ep.png` | 1 · 10″ EP, on the platter | UN6, UN7, UN8, UN9 |
| `LP` | `png/gf-2-lp.png` | 2 · 12″ LP, in its sleeve | UN6, UN7, UN8 |
| `BackCover` | `png/gf-3-back.png` | 3 · Back cover | UN10 |
| `Light` | `png/gf-4-light.png` | 4 · Light theme | UN1, UN6 |
| `TodayFront` | `png/gf-today-ep.png` | Today · 10″ EP, for comparison | — |
| `TodayBack` | `png/gf-today-back.png` | Today · Back cover, for comparison | — |
| `TodayLight` | `png/gf-today-light.png` | Today · Light theme, for comparison | — |

Frame-to-filename mapping above is `{Frame}.dc.html` in each canvas's `project/` folder. Reading a `.dc.html` file (via the Artifact tool's `read` action) shows the artboard's own source, which needs the canvas runtime and won't render correctly opened directly in a browser.
