// BD9 (docs/38_BEFORE_THE_DOMAIN.md): moved out of the now-removed booklet
// feature's tests/unit/booklet.test.js -- these two pure functions outlive
// the booklet viewer itself, kept for BD10's back-cover auto-detection.
// isBackCoverName is BD10's own addition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPageImageName, isBackCoverName, groupSidecarCandidatesByAlbumFolder } from '../../src/library/sidecar.js';

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

test('isBackCoverName: matches the known back-cover names, case/separator/leading-number insensitive', () => {
  assert.equal(isBackCoverName('back.jpg'), true);
  assert.equal(isBackCoverName('BACK.PNG'), true);
  assert.equal(isBackCoverName('Back Cover.jpg'), true);
  assert.equal(isBackCoverName('backcover.jpg'), true);
  assert.equal(isBackCoverName('back_cover.jpg'), true);
  assert.equal(isBackCoverName('back-cover.jpg'), true);
  assert.equal(isBackCoverName('rear.jpg'), true);
  assert.equal(isBackCoverName('rear cover.jpg'), true);
  assert.equal(isBackCoverName('tray.jpg'), true);
  assert.equal(isBackCoverName('inlay.jpg'), true);
  assert.equal(isBackCoverName('02 - Back Cover.jpg'), true);
  assert.equal(isBackCoverName('02-back-cover.jpg'), true);
});

test('isBackCoverName: a word that merely contains a known name is not a match', () => {
  assert.equal(isBackCoverName('backstage.jpg'), false);
  assert.equal(isBackCoverName('feedback.png'), false);
  assert.equal(isBackCoverName('front.jpg'), false);
  assert.equal(isBackCoverName('booklet-01.jpg'), false);
  assert.equal(isBackCoverName('noext'), false);
});
