// BD9 (docs/38_BEFORE_THE_DOMAIN.md): moved out of the now-removed booklet
// feature's tests/unit/booklet.test.js -- these two pure functions outlive
// the booklet viewer itself, kept for BD10's back-cover auto-detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPageImageName, groupSidecarCandidatesByAlbumFolder } from '../../src/library/sidecar.js';

test('isPageImageName: matches common image extensions, case-insensitively', () => {
  assert.equal(isPageImageName('scan1.jpg'), true);
  assert.equal(isPageImageName('COVER.PNG'), true);
  assert.equal(isPageImageName('page.webp'), true);
  assert.equal(isPageImageName('page.gif'), true);
  assert.equal(isPageImageName('track01.flac'), false);
  assert.equal(isPageImageName('noext'), false);
});

test('groupSidecarCandidatesByAlbumFolder: groups by the album folder and sorts each group by name', () => {
  const groups = groupSidecarCandidatesByAlbumFolder([
    { name: 'b.jpg', relativePath: 'Album A/booklet/b.jpg' },
    { name: 'a.jpg', relativePath: 'Album A/booklet/a.jpg' },
    { name: 'booklet-02.jpg', relativePath: 'Album B/booklet-02.jpg' },
    { name: 'booklet-01.jpg', relativePath: 'Album B/booklet-01.jpg' },
  ]);
  assert.deepEqual([...groups.keys()].sort(), ['Album A', 'Album B']);
  assert.deepEqual(groups.get('Album A').map(c => c.name), ['a.jpg', 'b.jpg']);
  assert.deepEqual(groups.get('Album B').map(c => c.name), ['booklet-01.jpg', 'booklet-02.jpg']);
});
