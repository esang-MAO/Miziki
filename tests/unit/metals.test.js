import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// resolveLook (record-art/looks.js) has a real circular import with
// history/sessions.js (persistAlbumLookPref) and a real import of
// library/thumbs.js's restoreThumbs — loading thumbs.js for real would
// reach library/edit.js and, through that, library/sealed.js/credits.js,
// each circularly importing main.js (rule 8 in CLAUDE.md). Mocking just
// thumbs.js's one export stops that chain at the door, the same approach
// tags.test.js/credits.test.js/search.test.js use.
mock.module(new URL('../../src/library/thumbs.js', import.meta.url).href, {
  namedExports: { restoreThumbs: async () => {}, persistable: rec => rec, thumbURL: {}, pruneThumbs: async () => {} },
});

const {
  albumMetalFor, trackMetalFor, ALBUM_METAL_THRESHOLDS, TRACK_METAL_THRESHOLDS,
  METAL_COLORS, metalLabelKind, metalBackground, metalPlatterBackground, metalLightOverlay,
} = await import('../../src/record-art/metals.js');
const { resolveLook, discLook } = await import('../../src/record-art/looks.js');
const { albumKey } = await import('../../src/record-art/tiers.js');
const { S } = await import('../../src/state.js');

function resetState(overrides){
  Object.assign(S, {
    metalEligibleSessions: {}, trackMetalEligiblePlays: {}, rareUnlocked: {}, albumLookPref: {},
    mergedStats: null, zoetropeUnlocked: {}, zoetropesEnabled: true,
  }, overrides);
}

const albumBronze = ALBUM_METAL_THRESHOLDS.find(l => l.name === 'bronze').sessions;
const albumSilver = ALBUM_METAL_THRESHOLDS.find(l => l.name === 'silver').sessions;
const albumGold = ALBUM_METAL_THRESHOLDS.find(l => l.name === 'gold').sessions;
const albumPlatinum = ALBUM_METAL_THRESHOLDS.find(l => l.name === 'platinum').sessions;
const trackGold = TRACK_METAL_THRESHOLDS.find(l => l.name === 'gold').plays;
const trackPlatinum = TRACK_METAL_THRESHOLDS.find(l => l.name === 'platinum').plays;

test('albumMetalFor: below the bronze threshold is no metal at all', () => {
  resetState({ metalEligibleSessions: { a1: albumBronze - 1 } });
  assert.equal(albumMetalFor('a1'), null);
});

test('albumMetalFor: exactly at each threshold earns that tier', () => {
  resetState({ metalEligibleSessions: { a1: albumBronze } });
  assert.equal(albumMetalFor('a1'), 'bronze');
  resetState({ metalEligibleSessions: { a1: albumSilver } });
  assert.equal(albumMetalFor('a1'), 'silver');
  resetState({ metalEligibleSessions: { a1: albumGold } });
  assert.equal(albumMetalFor('a1'), 'gold');
  resetState({ metalEligibleSessions: { a1: albumPlatinum } });
  assert.equal(albumMetalFor('a1'), 'platinum');
});

test('albumMetalFor: just below silver/gold/platinum stays at the rung below', () => {
  resetState({ metalEligibleSessions: { a1: albumSilver - 1 } });
  assert.equal(albumMetalFor('a1'), 'bronze');
  resetState({ metalEligibleSessions: { a1: albumGold - 1 } });
  assert.equal(albumMetalFor('a1'), 'silver');
  resetState({ metalEligibleSessions: { a1: albumPlatinum - 1 } });
  assert.equal(albumMetalFor('a1'), 'gold');
});

test('albumMetalFor: an album with no counter at all is no metal', () => {
  resetState();
  assert.equal(albumMetalFor('unknown-album'), null);
});

test('trackMetalFor: below the gold threshold is no metal at all', () => {
  resetState({ trackMetalEligiblePlays: { t1: trackGold - 1 } });
  assert.equal(trackMetalFor('t1'), null);
});

test('trackMetalFor: exactly at gold and platinum earns that tier', () => {
  resetState({ trackMetalEligiblePlays: { t1: trackGold } });
  assert.equal(trackMetalFor('t1'), 'gold');
  resetState({ trackMetalEligiblePlays: { t1: trackPlatinum } });
  assert.equal(trackMetalFor('t1'), 'platinum');
});

test('trackMetalFor: just below platinum stays at gold', () => {
  resetState({ trackMetalEligiblePlays: { t1: trackPlatinum - 1 } });
  assert.equal(trackMetalFor('t1'), 'gold');
});

// RF4 (docs/12_REFINE.md): reads the merged cross-device shadow counter in
// place of the local one, when one exists -- see state.js's own
// S.mergedStats comment and src/sync/backup.js's applyMerged().
test('albumMetalFor: reads the merged cross-device shadow counter when one exists, not the local one', () => {
  resetState({
    metalEligibleSessions: { a1: albumBronze - 1 },   // local alone wouldn't earn bronze
    mergedStats: { metalEligibleSessions: { a1: albumGold }, trackMetalEligiblePlays: {} },
  });
  assert.equal(albumMetalFor('a1'), 'gold');
});
test('trackMetalFor: reads the merged cross-device shadow counter when one exists, not the local one', () => {
  resetState({
    trackMetalEligiblePlays: { t1: trackGold - 1 },
    mergedStats: { metalEligibleSessions: {}, trackMetalEligiblePlays: { t1: trackPlatinum } },
  });
  assert.equal(trackMetalFor('t1'), 'platinum');
});

function fakeTrack(overrides){
  return Object.assign({
    tags: { album: 'Al', artist: 'Ar', albumArtist: 'Ar', title: 'T' },
    meta: { lossless: false }, art: 'blob:fake',
  }, overrides);
}
const album = fakeTrack();
const albumId = albumKey(album);   // normalized 'album', not artist+album — see tiers.js

test('resolveLook: rareUnlocked overrides an earned metal and the plain variant', () => {
  resetState({
    rareUnlocked: { [albumId]: true },
    metalEligibleSessions: { [albumId]: albumPlatinum },
  });
  assert.equal(resolveLook(album), 'rare');
});

test('resolveLook: with no rare unlock, an earned metal wins over the plain variant', () => {
  resetState({ metalEligibleSessions: { [albumId]: albumGold } });
  assert.equal(resolveLook(album), 'metal');
});

test('resolveLook: a saved look preference wins when it is still available', () => {
  resetState({
    rareUnlocked: { [albumId]: true },
    metalEligibleSessions: { [albumId]: albumGold },
    albumLookPref: { [albumId]: 'metal' },
  });
  assert.equal(resolveLook(album), 'metal');
});

test('resolveLook: a saved preference for a look no longer available falls back', () => {
  resetState({
    rareUnlocked: { [albumId]: true },
    albumLookPref: { [albumId]: 'metal' },   // no metal earned this time
  });
  assert.equal(resolveLook(album), 'rare');
});

test('resolveLook: nothing earned on a tier-1 track falls back to the plain variant', () => {
  resetState();
  assert.equal(resolveLook(album), 'variant');
});

/* ================= PRESSINGS_110 PR7 follow-up: the "Zoetropes earned"
   settings switch (Ken, 2026-10-26) ================= */

test('resolveLook: an earned zoetrope wins on display over a rare unlock (PR7 §8)', () => {
  resetState({
    zoetropeUnlocked: { [albumId]: true },
    rareUnlocked: { [albumId]: true },
  });
  assert.equal(resolveLook(album), 'zoetrope');
});

test('resolveLook: with zoetropesEnabled off, an earned zoetrope is never offered — falls through to rare', () => {
  resetState({
    zoetropeUnlocked: { [albumId]: true },
    rareUnlocked: { [albumId]: true },
    zoetropesEnabled: false,
  });
  assert.equal(resolveLook(album), 'rare');
});

test('resolveLook: with zoetropesEnabled off and nothing else earned, falls all the way through to the plain variant', () => {
  resetState({
    zoetropeUnlocked: { [albumId]: true },
    zoetropesEnabled: false,
  });
  assert.equal(resolveLook(album), 'variant');
});

test('resolveLook: a saved zoetrope preference is skipped while zoetropesEnabled is off, same as any other unavailable look', () => {
  resetState({
    zoetropeUnlocked: { [albumId]: true },
    rareUnlocked: { [albumId]: true },
    albumLookPref: { [albumId]: 'zoetrope' },
    zoetropesEnabled: false,
  });
  assert.equal(resolveLook(album), 'rare');
});

test('discLook: an earned, enabled zoetrope returns the LP frame count by default, the one live player/clock.js needs to drive the ring', () => {
  resetState({ zoetropeUnlocked: { [albumId]: true } });
  const d = discLook(album);
  assert.equal(d.look, 'zoetrope');
  assert.equal(typeof d.frameCount, 'number');
  assert.ok(d.frameCount > 0);
});

test('discLook: with zoetropesEnabled off, the look falls through to the plain variant and carries no frameCount at all', () => {
  resetState({ zoetropeUnlocked: { [albumId]: true }, zoetropesEnabled: false });
  const d = discLook(album);
  assert.equal(d.look, 'variant');
  assert.equal(d.frameCount, undefined);
});

test('discLook: a metal laid over an earned zoetrope reads the zoetrope\'s own rim/underglow colors while the switch is on', () => {
  // resolveLook's own precedence puts an earned zoetrope ahead of metal
  // (§8: "the zoetrope wins on display"), so a saved look preference of
  // 'metal' is what reaches discLook's "metal lays over a zoetrope"
  // branch — the opt-back path availableLooks()'s own comment describes,
  // the same way a user who's earned both would reach it from the picker.
  resetState({
    zoetropeUnlocked: { [albumId]: true },
    metalEligibleSessions: { [albumId]: albumGold },
    albumLookPref: { [albumId]: 'metal' },
  });
  const withZoetrope = discLook(album);
  resetState({
    zoetropeUnlocked: { [albumId]: true },
    metalEligibleSessions: { [albumId]: albumGold },
    albumLookPref: { [albumId]: 'metal' },
    zoetropesEnabled: false,
  });
  const withoutZoetrope = discLook(album);
  assert.equal(withZoetrope.look, 'metal');
  assert.equal(withoutZoetrope.look, 'metal');
  // Turning the switch off changes which def's rim/body colours the
  // metal's own underglow reads — the same "pretend the feature doesn't
  // exist" consistency the switch gives everywhere else.
  assert.notEqual(withZoetrope.bg, withoutZoetrope.bg);
});

/* ================= CR7: pressings and finishes (docs/13_CRATE.md) ================= */

test('CR7 metalLabelKind: gold and platinum invert, silver gets a ring, bronze stays amber', () => {
  assert.equal(metalLabelKind('gold'), 'invert');
  assert.equal(metalLabelKind('platinum'), 'invert');
  assert.equal(metalLabelKind('silver'), 'silver-ring');
  assert.equal(metalLabelKind('bronze'), 'amber');
  assert.equal(metalLabelKind('unknown-metal'), 'amber');
});

test('PRESSINGS_110 PR4: METAL_COLORS carries shadow/mid/highlight per metal, thresholds untouched', () => {
  for(const name of ['bronze', 'silver', 'gold', 'platinum']){
    const m = METAL_COLORS[name];
    assert.ok(m, name + ' missing from METAL_COLORS');
    for(const k of ['shadow', 'mid', 'highlight']) assert.ok(m[k], name + '.' + k + ' missing');
  }
  assert.equal(ALBUM_METAL_THRESHOLDS.find(l => l.name === 'bronze').sessions, 8);
  assert.equal(ALBUM_METAL_THRESHOLDS.find(l => l.name === 'platinum').sessions, 40);
});

/* ================= PRESSINGS_110 PR4: two-layer metal lighting
   (docs/PRESSINGS_110.md §6) — metalLightOverlay() is the screen-fixed
   "bow tie," metalPlatterBackground() is the rotating layer that reads
   the underlying pressing's own rim/body colours, and metalBackground()
   stays as the combined, no-pressing-context fallback the two profile
   chip call sites use. ================= */

test('PRESSINGS_110 PR4: metalPlatterBackground() falls back to the metal\'s own shadow/mid with no pressing given', () => {
  for(const name of ['bronze', 'silver', 'gold', 'platinum']){
    const bg = metalPlatterBackground(name);
    assert.ok(bg.includes(METAL_COLORS[name].mid), name + ' should fall back to its own mid fill');
    assert.ok(bg.includes(METAL_COLORS[name].shadow), name + ' should fall back to its own shadow as the rim');
    assert.ok(bg.startsWith('repeating-radial-gradient'), 'the fine concentric brushing should come first');
  }
  assert.equal(metalPlatterBackground('not-a-metal'), '');
});

test('PRESSINGS_110 PR4: metalPlatterBackground() reads the underlying pressing\'s own rim/body when given — "the pressing still shows"', () => {
  const bg = metalPlatterBackground('gold', '#2A5E54', 'rgba(169,224,220,.75)');
  assert.ok(bg.includes('#2A5E54'), 'a gold Verdigris should have a green rim');
  assert.ok(bg.includes('rgba(169,224,220,.75)'), 'and the pressing\'s own body colour as the underglow');
  assert.ok(!bg.includes(METAL_COLORS.gold.shadow), 'the metal\'s own fixed shadow should not appear once a real pressing rim is given');
});

test('PRESSINGS_110 PR4: metalLightOverlay() renders the exact spec stop sequence, feathered (no two stops share an angle)', () => {
  for(const name of ['bronze', 'silver', 'gold', 'platinum']){
    const bg = metalLightOverlay(name);
    assert.ok(bg.startsWith('conic-gradient(from 0deg,'));
    for(const angle of ['0deg', '45deg', '95deg', '135deg', '175deg', '225deg', '272deg', '302deg', '313deg', '324deg', '360deg']){
      assert.ok(bg.includes(angle), name + ' missing stop at ' + angle);
    }
    // the three derived blends: shadow 75% into mid, highlight 45% into
    // mid, and white 35% into highlight — color-mix, not a literal hex,
    // since each is a blend rather than one of the metal's own three colours
    const m = METAL_COLORS[name];
    assert.ok(bg.includes('color-mix(in srgb,' + m.shadow + ' 75%,' + m.mid + ' 25%)'));
    assert.ok(bg.includes('color-mix(in srgb,' + m.highlight + ' 45%,' + m.mid + ' 55%)'));
    assert.ok(bg.includes('color-mix(in srgb,#fff 35%,' + m.highlight + ' 65%)'));
  }
  assert.equal(metalLightOverlay('not-a-metal'), '');
});

test('PRESSINGS_110 PR4: metalBackground() combines both layers for the no-pressing-context call sites', () => {
  for(const name of ['bronze', 'silver', 'gold', 'platinum']){
    const bg = metalBackground(name);
    assert.ok(bg.includes('conic-gradient'), name + ' missing the fixed light layer');
    assert.ok(bg.includes('repeating-radial-gradient'), name + ' missing the rotating brushed layer');
    assert.equal(bg, metalLightOverlay(name) + ',' + metalPlatterBackground(name));
  }
  assert.equal(metalBackground('not-a-metal'), '');
});
