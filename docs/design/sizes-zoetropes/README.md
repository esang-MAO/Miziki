# Record sizes and mandala zoetropes — design frames

Frames for `docs/26_SIZES_AND_ZOETROPES.md`. Rendered at 2× in the app's own bundled fonts. Phone frames are 390×844 CSS px. The names Harbor Lights, Tidewater, Low Water and Ines Okafor are stand-ins, not copy to ship.

## Sizes, at a glance

| Record | Share of the 12″ platter | Label | Label share of the record | Centre |
|---|---|---|---|---|
| 12″ | 100% | 100 mm | 33% | small spindle hole |
| 10″ | 82.8% | 100 mm | 40% | small spindle hole |
| 7″ | 57.9% | 90 mm | 51.5% | large hole with the 45 adapter |

## Frames

| Frame | What it shows | PR |
|---|---|---|
| `01-size-7in-single.png` | A 7″ single on the platter: felt mat, strobe dots, 90 mm label, 45 adapter | SZ1 |
| `02-size-10in-ep.png` | A 10″ EP: 100 mm label on a smaller record | SZ1 |
| `03-size-12in-lp.png` | A 12″ LP at true label and spindle-hole size | SZ1 |
| `04-sizes-side-by-side.png` | The three sizes on identical platters, the 7″ centre close up, and the format table | SZ1 |
| `05-zoetropes-lp.png` | The nine mandala zoetropes, 33⅓ art (12 frames) | SZ2 |
| `06-zoetropes-45.png` | The same at 45 (16 frames), fitted outside the 10″ label | SZ2 |
| `07-zoetropes-7in.png` | The same for a 7″, fitted outside its larger label | SZ2 |
| `08-zoetrope-strobe-steps.png` | Four strobe steps of Lotus and Moonwheel: each element shows its next frame in place | SZ2 |
| `09-zoetrope-on-12in-lotus.png` | Lotus on the platter, 12″ at 33⅓ | SZ2 |
| `10-zoetrope-on-7in-ember.png` | Ember on a 7″ at 45 | SZ2 |

## Zoetrope art

`zoetropes/` holds the 27 disc files SZ2 copies into `src/record-art/zoetropes/` (`<id>_disc_lp.svg`, `<id>_disc_45.svg`, `<id>_disc_7in.svg`), plus `gen.py`, which regenerates them. Run `python3 -I gen.py <out_dir>`, then rename `_lp`/`_45`/`_7in_45` to the `_disc_*` names.

How the art animates: each ring of N elements (or a multiple of N) holds one frame per slot. When the strobe steps the ring one slot, the element now at each position shows the next frame, so every ring animates in place. Static decoration only uses counts that are multiples of N, so the steps never show on it. Sunwheel uses N+1, N−1 and 2N−1 evenly spaced elements instead, so the wheel appears to turn slowly with no seam.

Frames are stills. The live, spinning versions are on the "Miziki Mandala Zoetropes" canvas.
