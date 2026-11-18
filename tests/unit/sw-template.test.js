import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldServeFromCache } from '../../src/sw-template.js';

const ORIGIN = 'https://esang-mao.github.io';
const PRECACHE_LIST = ['/Miziki/miziki.html', '/Miziki/assets/app.js'];

test('shouldServeFromCache: a same-origin GET for a listed file is cached', () => {
  assert.equal(shouldServeFromCache({
    url: ORIGIN + '/Miziki/miziki.html', method: 'GET', origin: ORIGIN, hasRange: false, precacheList: PRECACHE_LIST,
  }), true);
});

test('shouldServeFromCache: a same-origin GET for a file not in the list goes to the network', () => {
  assert.equal(shouldServeFromCache({
    url: ORIGIN + '/Miziki/not-listed.js', method: 'GET', origin: ORIGIN, hasRange: false, precacheList: PRECACHE_LIST,
  }), false);
});

test('shouldServeFromCache: a cross-origin request (Supabase) goes to the network', () => {
  assert.equal(shouldServeFromCache({
    url: 'https://yeyeprzdlbyacisfftjp.supabase.co/rest/v1/profiles', method: 'GET', origin: ORIGIN, hasRange: false,
    precacheList: PRECACHE_LIST,
  }), false);
});

test('shouldServeFromCache: a non-GET request goes to the network, even for a listed file', () => {
  assert.equal(shouldServeFromCache({
    url: ORIGIN + '/Miziki/miziki.html', method: 'POST', origin: ORIGIN, hasRange: false, precacheList: PRECACHE_LIST,
  }), false);
});

test('shouldServeFromCache: a Range request goes to the network, even for a listed file', () => {
  assert.equal(shouldServeFromCache({
    url: ORIGIN + '/Miziki/miziki.html', method: 'GET', origin: ORIGIN, hasRange: true, precacheList: PRECACHE_LIST,
  }), false);
});

test('shouldServeFromCache: an unparseable url goes to the network rather than throwing', () => {
  assert.equal(shouldServeFromCache({
    url: 'not a url', method: 'GET', origin: ORIGIN, hasRange: false, precacheList: PRECACHE_LIST,
  }), false);
});
