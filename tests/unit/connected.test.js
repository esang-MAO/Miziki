import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { normKey } from '../../src/util/text.js';
import {
  normName, pickArtist, roleFor, relatedFrom, urlsFrom, releaseGroupsFrom, connectionRows,
} from '../../supabase/functions/_shared/mb-connections.js';

// connected.js's only wide import is credits.js (DOM, queue, routes...);
// the pure helpers under test never touch it, so it's stubbed outright.
mock.module('../../src/library/credits.js', { namedExports: {
  isLibraryArtist: () => false, openPersonOrArtist: () => {},
} });
const { connectedPreview, safeBuyUrl } = await import('../../src/library/connected.js');

const ATCQ = '5fe65a8e-4f6b-4dc1-9d26-3a2e7ef3b8e5';
const QTIP = '11111111-1111-4111-8111-111111111111';
const PHIFE = '22222222-2222-4222-8222-222222222222';
const LUCY = '33333333-3333-4333-8333-333333333333';

test('normName matches the client normKey exactly (it is the shared cache key)', () => {
  ['A Tribe Called Quest', 'Beyoncé', '  Sigur Rós ', 'AC/DC', 'MF DOOM', 'Björk & Friends', '', null, 'Ünïcødé — ‘quotes’']
    .forEach(s => assert.equal(normName(s), normKey(s), JSON.stringify(s)));
});

test('pickArtist trusts only an exact, high-score name or alias match', () => {
  const search = { artists: [
    { id: 'x', name: 'A Tribe Called Quest Tribute', score: 100 },
    { id: ATCQ, name: 'A Tribe Called Quest', score: 100 },
  ] };
  assert.deepEqual(pickArtist(search, 'a tribe called quest'), { mbid: ATCQ, name: 'A Tribe Called Quest' });
  assert.equal(pickArtist({ artists: [{ id: ATCQ, name: 'A Tribe Called Quest', score: 80 }] }, 'A Tribe Called Quest'), null);
  assert.deepEqual(pickArtist({ artists: [{ id: ATCQ, name: 'A Tribe Called Quest', score: 99, aliases: [{ name: 'ATCQ' }] }] }, 'ATCQ'),
    { mbid: ATCQ, name: 'A Tribe Called Quest' });
  assert.equal(pickArtist({}, 'anything'), null);
  assert.equal(pickArtist({ artists: [] }, ''), null);
});

test('roleFor reads member-of-band direction from the page artist’s side', () => {
  const a = { id: QTIP, name: 'Q-Tip' };
  assert.equal(roleFor({ type: 'member of band', direction: 'backward', artist: a }), 'member');
  assert.equal(roleFor({ type: 'member of band', direction: 'forward', artist: a }), 'band');
  assert.equal(roleFor({ type: 'collaboration', direction: 'forward', artist: a }), 'collab');
  assert.equal(roleFor({ type: 'teacher', direction: 'forward', artist: a }), null);
  assert.equal(roleFor({ type: 'member of band', direction: 'backward' }), null);
});

test('relatedFrom dedupes, keeps the closer role, puts members first, and caps', () => {
  const lookup = { relations: [
    { type: 'collaboration', direction: 'forward', artist: { id: LUCY, name: 'Lucy Pearl' } },
    { type: 'member of band', direction: 'backward', artist: { id: PHIFE, name: 'Phife Dawg' } },
    { type: 'member of band', direction: 'backward', artist: { id: QTIP, name: 'Q-Tip' } },
    { type: 'collaboration', direction: 'forward', artist: { id: QTIP, name: 'Q-Tip' } },
    { type: 'bandcamp', url: { resource: 'https://x.bandcamp.com' } },
  ] };
  assert.deepEqual(relatedFrom(lookup).map(r => [r.name, r.role]),
    [['Phife Dawg', 'member'], ['Q-Tip', 'member'], ['Lucy Pearl', 'collab']]);
  assert.equal(relatedFrom(lookup, 2).length, 2);
  assert.deepEqual(relatedFrom({}), []);
});

test('urlsFrom keeps https Bandcamp/official links, Bandcamp first', () => {
  const urls = urlsFrom({ relations: [
    { type: 'official homepage', url: { resource: 'https://qtip.example' } },
    { type: 'bandcamp', url: { resource: 'https://qtip.bandcamp.com' } },
    { type: 'official homepage', url: { resource: 'http://insecure.example' } },
    { type: 'wikidata', url: { resource: 'https://www.wikidata.org/x' } },
    { type: 'bandcamp', url: { resource: 'javascript:alert(1)' } },
  ] });
  assert.deepEqual(urls, [
    { kind: 'bandcamp', url: 'https://qtip.bandcamp.com' },
    { kind: 'official', url: 'https://qtip.example' },
  ]);
});

test('releaseGroupsFrom keeps studio albums/EPs only, oldest first, capped', () => {
  const rgs = releaseGroupsFrom({ 'release-groups': [
    { id: 'c', title: 'The Renaissance', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '2008-11-04' },
    { id: 'a', title: 'Amplified', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1999-11-30' },
    { id: 'l', title: 'Live at Somewhere', 'primary-type': 'Album', 'secondary-types': ['Live'], 'first-release-date': '2001' },
    { id: 's', title: 'Vivrant Thing', 'primary-type': 'Single', 'secondary-types': [], 'first-release-date': '1999' },
    { id: 'k', title: 'Kamaal the Abstract', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '2009-09-15' },
    { id: 'u', title: 'Undated EP', 'primary-type': 'EP', 'secondary-types': [] },
  ] }, 3);
  assert.deepEqual(rgs.map(r => [r.title, r.year]), [['Amplified', 1999], ['The Renaissance', 2008], ['Kamaal the Abstract', 2009]]);
});

test('connectionRows ties each release group to the artist, via and buy link', () => {
  const rows = connectionRows(ATCQ, { mbid: QTIP, name: 'Q-Tip', role: 'member' }, {
    'release-groups': [{ id: 'a', title: 'Amplified', 'primary-type': 'Album', 'first-release-date': '1999' }],
    relations: [{ type: 'bandcamp', url: { resource: 'https://qtip.bandcamp.com' } }],
  });
  assert.deepEqual(rows, [{ artist_mbid: ATCQ, release_group_mbid: 'a', title: 'Amplified', year: 1999,
    via_mbid: QTIP, via_name: 'Q-Tip', role: 'member', buy_url: 'https://qtip.bandcamp.com' }]);
});

test('connectedPreview shows one record per related artist before a second', () => {
  const it = (via, title) => ({ via_mbid: via, title });
  const items = [it('q', 'Q1'), it('q', 'Q2'), it('q', 'Q3'), it('p', 'P1'), it('l', 'L1')];
  assert.deepEqual(connectedPreview(items).map(x => x.title), ['Q1', 'P1', 'L1', 'Q2']);
  assert.deepEqual(connectedPreview(items, 2).map(x => x.title), ['Q1', 'P1']);
  assert.deepEqual(connectedPreview([]), []);
  assert.deepEqual(connectedPreview(undefined), []);
});

test('safeBuyUrl only passes plain https links', () => {
  assert.equal(safeBuyUrl('https://qtip.bandcamp.com/album/x'), 'https://qtip.bandcamp.com/album/x');
  assert.equal(safeBuyUrl('http://x.example'), null);
  assert.equal(safeBuyUrl('javascript:alert(1)'), null);
  assert.equal(safeBuyUrl('https://x.example/"onmouseover=1'), null);
  assert.equal(safeBuyUrl(null), null);
});
