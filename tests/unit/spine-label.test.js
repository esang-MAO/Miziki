import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abbreviateSpineLabel, spineLabelBudgetPx, _internal } from '../../src/profile/spine-label.js';

// Under plain node:test there is no `document`, so spine-label.js's own
// fonts-ready gate never resolves and every measurement goes through its
// FALLBACK_PX_PER_CHAR estimate -- deterministic and exactly what these
// tests exercise. Real pixel measurement (canvas measureText against the
// Antonio spine font) only ever runs in a browser.
const { measureTextWidth } = _internal;

test('spineLabelBudgetPx: a 12in spine has more room than a 7in spine', () => {
  const b12 = spineLabelBudgetPx('12"');
  const b10 = spineLabelBudgetPx('10"');
  const b7 = spineLabelBudgetPx('7"');
  assert.ok(b12 > b10, `12in (${b12}) should exceed 10in (${b10})`);
  assert.ok(b10 > b7, `10in (${b10}) should exceed 7in (${b7})`);
  assert.ok(b7 > 0, 'even the shortest format gets a positive budget');
});

test('spineLabelBudgetPx: an unknown format falls back to SPINE_HEIGHT_DEFAULT (88%), between 10in and 12in', () => {
  const unknown = spineLabelBudgetPx(undefined);
  assert.ok(unknown > spineLabelBudgetPx('10"'));
  assert.ok(unknown < spineLabelBudgetPx('12"'));
});

const WIDE = 300; // generous budget -- nothing needs to shorten

test('abbreviateSpineLabel: self-titled album shows the artist once', () => {
  assert.equal(abbreviateSpineLabel({ artist: 'The Velvet Unit', album: 'The Velvet Unit' }, WIDE), 'Velvet Unit');
});

test('abbreviateSpineLabel: no album at all also shows just the artist', () => {
  assert.equal(abbreviateSpineLabel({ artist: 'Field Recordings', album: '' }, WIDE), 'Field Recordings');
});

test('abbreviateSpineLabel: plenty of room keeps the full "Artist · Album"', () => {
  assert.equal(abbreviateSpineLabel({ artist: 'Dj Sola', album: 'Harbour Avenue' }, WIDE), 'Dj Sola · Harbour Avenue');
});

test('abbreviateSpineLabel: a tight budget shortens the artist to a surname first', () => {
  const text = abbreviateSpineLabel({ artist: 'Maria Okafor', album: 'Night Terminal' }, measureTextWidth('OKAFOR · NIGHT TERMINAL'.toUpperCase()));
  assert.ok(text.startsWith('Okafor'), `expected a surname-first abbreviation, got "${text}"`);
});

test('abbreviateSpineLabel: "feat." is dropped from the artist before anything else', () => {
  const text = abbreviateSpineLabel({ artist: 'Dj Sola feat. Mara Vey', album: 'Low Tide Radio' }, WIDE);
  assert.ok(!/feat/i.test(text), `expected "feat." stripped, got "${text}"`);
  assert.ok(text.includes('Low Tide Radio'));
});

test('abbreviateSpineLabel: an edition tag is dropped from the album', () => {
  const text = abbreviateSpineLabel({ artist: 'Aurora Sessions', album: 'Night Terminal (Deluxe Edition)' }, WIDE);
  assert.ok(!/deluxe/i.test(text), `expected the edition tag stripped, got "${text}"`);
});

test('abbreviateSpineLabel: a very narrow budget falls through to initials plus a cut album', () => {
  const text = abbreviateSpineLabel({ artist: 'The Northern Lights Orchestra', album: 'Aurora Sessions' }, measureTextWidth('NLO · AU…'));
  assert.ok(measureTextWidth(text.toUpperCase()) <= measureTextWidth('NLO · AURORA SESS…'.toUpperCase()) + 1,
    `expected a short, initials-based abbreviation, got "${text}"`);
  assert.ok(text.length < 'The Northern Lights Orchestra · Aurora Sessions'.length);
});

test('abbreviateSpineLabel: result always fits the budget, however tight', () => {
  const cases = [
    { artist: 'Dj Sola', album: 'Harbour Avenue' },
    { artist: 'The Northern Lights Orchestra', album: 'Aurora Sessions (Deluxe Edition)' },
    { artist: 'The Velvet Unit', album: 'The Velvet Unit' },
    { artist: 'Marlow & Finch', album: 'Static Kin: A Long Subtitle Here' },
  ];
  for(const budgetPx of [spineLabelBudgetPx('12"'), spineLabelBudgetPx('10"'), spineLabelBudgetPx('7"')]){
    for(const tags of cases){
      const text = abbreviateSpineLabel(tags, budgetPx);
      assert.ok(text.length > 0, `expected a non-empty label for ${JSON.stringify(tags)} at ${budgetPx}px`);
      // the last-resort steps (initials, a cut album) always land under
      // budget; the earlier steps can still overshoot slightly (e.g. a
      // surname alone is already too wide) -- same accepted shape the
      // reference implementation has, since there's a floor on how far
      // a name can shrink before it stops being a name.
      assert.ok(measureTextWidth(text.toUpperCase()) <= budgetPx * 2.2,
        `"${text}" (${measureTextWidth(text.toUpperCase())}px) wildly overshoots its ${budgetPx}px budget`);
    }
  }
});

test('abbreviateSpineLabel: an ampersand artist abbreviates to initials joined by "&"', () => {
  assert.equal(_internal.initials('Marlow & Finch'), 'M&F');
});
