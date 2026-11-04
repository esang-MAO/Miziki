// GF5 (docs/29_GATEFOLD.md §GF5): the default back cover's pure data
// builder -- sides/totals, label/year omission, the catalogue line, and
// the 10″/7″ overflow rule.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
// TY4 (docs/22_TYPE.md): the drawn wordmark SVG — a ?raw asset import
// node:test can't resolve, and buildBackCoverData (what this file tests)
// never reads it anyway; back-cover.js imports it only for buildBackCoverEl.
mock.module(new URL('../../src/ui/wordmark.js', import.meta.url).href, {
  namedExports: { wordmarkEl(){ return { classList: { add(){} } }; } },
});
const { buildBackCoverData } = await import('../../src/gatefold/back-cover.js');
const { matrixTail } = await import('../../src/record-art/etchings.js');
const { S } = await import('../../src/state.js');

function track(title, duration, overrides){
  return { tags: { title, artist: 'Test Artist', album: 'Test Album', disc: 1, ...overrides }, duration, meta: { ch: 2 } };
}

test('buildBackCoverData: sides and totals from splitSides, two tracks are A/B', () => {
  S.tracks = [track('One', 180), track('Two', 120)];
  const item = { albumId: 'rel-1', artist: 'Test Artist', album: 'Test Album', year: null };
  const data = buildBackCoverData(item, [0,1], { size: '12"', speed: 33.333 });
  assert.deepEqual(data.sides.map(s => s.label), ['SIDE A','SIDE B']);
  assert.equal(data.sides[0].total, 180);
  assert.equal(data.sides[1].total, 120);
  assert.deepEqual(data.sides[0].tracks.map(t => t.title), ['One']);
});

test('buildBackCoverData: a single track still gets one side, no split', () => {
  S.tracks = [track('Solo', 200)];
  const item = { albumId: 'rel-solo', artist: 'A', album: 'B', year: null };
  const data = buildBackCoverData(item, [0], { size: '7"', speed: 45 });
  assert.equal(data.sides.length, 1);
  assert.equal(data.sides[0].label, 'SIDE A');
  assert.equal(data.sides[0].tracks.length, 1);
});

test('buildBackCoverData: catalogue line matches matrixTail(releaseId), MZK- prefixed', () => {
  S.tracks = [track('One', 100), track('Two', 100)];
  const item = { albumId: 'some-release-id', artist: 'A', album: 'B', year: null };
  const data = buildBackCoverData(item, [0,1], { size: '12"', speed: 33.333 });
  assert.equal(data.catalogLine, 'MZK-' + matrixTail('some-release-id'));
});

test('buildBackCoverData: label/year omitted when absent, included when the tags carry them', () => {
  S.tracks = [track('One', 100)];
  const bare = buildBackCoverData({ albumId: 'r', artist: 'A', album: 'B', year: null }, [0], { size: '12"', speed: 33.333 });
  assert.equal(bare.label, null);
  assert.equal(bare.year, null);

  S.tracks = [track('One', 100, { label: 'Tidewater Records', year: 2024 })];
  const withMeta = buildBackCoverData({ albumId: 'r', artist: 'A', album: 'B', year: null }, [0], { size: '12"', speed: 33.333 });
  assert.equal(withMeta.label, 'Tidewater Records');
  assert.equal(withMeta.year, 2024);
});

test('buildBackCoverData: the format/speed/channel/total-time line', () => {
  S.tracks = [track('One', 150, { }), track('Two', 150)];
  S.tracks[0].meta = { ch: 2 };
  const data = buildBackCoverData({ albumId: 'r', artist: 'A', album: 'B', year: null }, [0,1], { size: '12"', speed: 33.333 });
  assert.equal(data.formatLine, '12″ · 33⅓ RPM · STEREO · 5:00');
});

test('buildBackCoverData: mono reads MONO off the first track\'s own channel count', () => {
  S.tracks = [track('One', 60, {})];
  S.tracks[0].meta = { ch: 1 };
  const data = buildBackCoverData({ albumId: 'r', artist: 'A', album: 'B', year: null }, [0], { size: '7"', speed: 45 });
  assert.ok(data.formatLine.includes('MONO'));
});

test('buildBackCoverData: an oversized 7″ side caps at 4 tracks and folds the rest into "and N more"', () => {
  // one very long track pulls bestSideCut()'s balance point to put every
  // other (short, equal) track on the opposite side -- side A ends up
  // with 5 tracks, side B with just the one long one (same "very uneven
  // track" shape ceremony-timing.test.js's own splitSides tests use).
  S.tracks = [...Array.from({length: 5}, (_, i) => track('Track ' + i, 60)), track('The Long One', 6000)];
  const item = { albumId: 'r', artist: 'A', album: 'B', year: null };
  const data = buildBackCoverData(item, [0,1,2,3,4,5], { size: '7"', speed: 45 });
  const capped = data.sides.find(s => s.overflow > 0);
  assert.ok(capped);
  assert.equal(capped.tracks.length, 4);
  assert.equal(capped.overflow, 1);
});

test('buildBackCoverData: a 12″ back never caps -- every track is shown, no overflow', () => {
  S.tracks = Array.from({length: 10}, (_, i) => track('Track ' + i, 60));
  const item = { albumId: 'r', artist: 'A', album: 'B', year: null };
  const data = buildBackCoverData(item, [0,1,2,3,4,5,6,7,8,9], { size: '12"', speed: 33.333 });
  const totalShown = data.sides.reduce((s, side) => s + side.tracks.length, 0);
  assert.equal(totalShown, 10);
  assert.ok(data.sides.every(s => s.overflow === 0));
});
