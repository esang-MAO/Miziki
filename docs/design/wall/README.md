# The wall, paper labels & share-card fixes — design frames

Canvas: "Miziki Wall Shelving". Plan: `docs/33_WALL_AND_LABELS.md`. Same tokens and wood as `docs/design/shelf-turntables/` (finish table `F` in `WallCombo.dc.html` matches `ShelfUnit.dc.html`). All wood is CSS gradients. Names are invented.

**Start with the PNGs in `png/`** (2× renders):

| PNG | Frame | Step | What it shows |
|---|---|---|---|
| `01-profile-wall-walnut` | `Main` | WS1, WS2 | Full profile: in rotation on the picture ledge, pressings in the wall cubby with paper labels, then Listening and the shelf unit — all Walnut. |
| `02-profile-wall-ash` | `Main` | WS1 | Same in Ash. |
| `03-wall-detail` | `WallCombo` | WS1, WS2 | The wall alone (no page background). |
| `04-wall-five-finishes` | `WallFinishes` | WS1 | The wall in Walnut, Oak, Teak, Ash, Black ash. |
| `05-paper-labels` | `PaperLabels` | WS2, WS3 | Share-card disc with the printed paper label (title above the hole, artist and side below), the Pressings card grid as labelled discs, and the wall size. |

**`share-audit/`** (WS4): `fixes.diff` (apply with `git apply -p0`; verified against all 339 renders — no overlaps, nothing off-canvas or below the safe line), `before/` and `after/` renders of each flagged case, named `card__case__style__format.png`.

The `.dc.html` files are the canvas sources (`Main` imports `WallCombo`, `ShelfUnit`, `Turntable`).
