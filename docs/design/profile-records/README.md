# Profile records + pressings — design frames

Source for the Records section/screen (`src/profile/records.js`). Design-canvas
`.dc.html` files (text, not directly renderable in a browser) plus `canvas.json`;
the live canvas is https://claude.ai/artifact/DPc8E7d27pXBbgjNmxK5c3.

- `Main.dc.html` — profile home: ten records, discs peeking from sleeves with an
  unlocked pressing or metal, "Show all", and the "Pressings & metals" row.
- `AllRecords.dc.html` — expanded, All: letter heads, pressing/metal name under a record.
- `Pressings.dc.html` — expanded, Pressings: the pressing chart, then Colors, Effects, Metals.

Counts and album names in the frames are placeholders in brackets.
