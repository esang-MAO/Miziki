# colors.json — source and licence

Fetched from https://sanzo-wada.dmbk.io/assets/colors.json (checked 2026-11-12).

A digital translation of Sanzo Wada's *A Dictionary of Color Combinations*
(配色事典, 1933–34, Seigensha edition), published by sanzo-wada.dmbk.io.
Site colophon credits: Design & Development, Dain Blodorn Kim; Biography, Ian
Lynam; Open Source Contributions, Paolo Tremadio, Matt DesLauriers, Takayosi
Amagi. Source repository: https://github.com/dblodorn/sanzo-wada, MIT
licensed.

The site publishes no separate licence statement for `colors.json` itself;
the repository it ships from is MIT. Per `docs/37_COLOUR.md`'s rights note
(recommendation 10), this file is kept here for reference/attribution and is
**not shipped whole**. `src/ui/palette-ref.js` ships only:

- colour names (Ridgway's — public) and hex values, corrected to Ridgway's
  spelling where the site has a typo (e.g. "Sulpher Yellow" → "Sulphur
  Yellow").
- a `PARTNERS` table of **derived partner counts per colour** (how often two
  colours co-occur in a Wada combination), built offline by
  `scripts/build-palette-ref.mjs` from this file's `combinations` id lists.

Wada's combination table itself — which named colours form which numbered
combination — is **not shipped** in any form, per the plan's rights note.
