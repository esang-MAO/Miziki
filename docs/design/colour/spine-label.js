// Reference implementation only — not shipped code. CO5 ports this logic into
// src/profile/spine-label.js, measured against real budgets (canvas
// measureText with the Antonio woff2, after document.fonts.ready), never the
// char-count estimate used here. See docs/37_COLOUR.md, recommendation 6.
//
// Produces "ARTIST · ALBUM" (title case; the spine face applies small caps via
// CSS text-transform, same as elsewhere in the app). `budget` here is a plain
// character count, a stand-in for the real pixel budget CO5 measures.

'use strict';

const EDITION_TAG_RE = new RegExp(
  '\\s*[\\(\\[]\\s*(?:' +
    'remaster(?:ed)?(?:\\s+\\d{4})?' +
    '|deluxe(?:\\s+edition)?' +
    '|expanded(?:\\s+edition)?' +
    '|anniversary(?:\\s+edition)?' +
    '|bonus(?:\\s+track)?(?:s)?(?:\\s+edition)?' +
    '|mono|stereo' +
    '|live' +
    '|e\\.?p\\.?' +
    '|single' +
  ')\\s*[\\)\\]]\\s*',
  'gi'
);

const FEAT_RE = /\s*[\(\[]?\s*feat\.?\s+[^)\]]*[\)\]]?\s*$/i;
const LEADING_THE_RE = /^the\s+/i;
const LEADING_ARTICLE_RE = /^(the|a|an)\s+/i;
const SUBTITLE_RE = /\s*[:–-]\s*.+$/; // colon or dash, to end

const BAND_ABBREVIATIONS = [
  [/\borchestra\b/gi, 'Orch.'],
  [/\bbrothers\b/gi, 'Bros.'],
  [/\bensemble\b/gi, 'Ens.'],
  [/\bcollective\b/gi, 'Coll.'],
  [/\bquartet\b/gi, 'Qrt.'],
];

const DJ_MC_PREFIX_RE = /^(DJ|MC)\s+/i;

function clean({ artist, album }) {
  let a = (album || '').replace(EDITION_TAG_RE, ' ').trim();
  let r = (artist || '').replace(FEAT_RE, '').trim();
  r = r.replace(LEADING_THE_RE, '');
  return { artist: r, album: a };
}

function isSelfTitled(artist, album) {
  if (!album) return true;
  const norm = (s) => s.replace(LEADING_THE_RE, '').trim().toLowerCase();
  return norm(artist) === norm(album);
}

// "W. Okafor" -> "Okafor"; "DJ Sola" stays; a band name gets its standard
// abbreviations, not cut down to initials.
function shortenArtist(artist) {
  if (DJ_MC_PREFIX_RE.test(artist)) return artist;

  let name = artist;
  for (const [re, abbr] of BAND_ABBREVIATIONS) {
    if (re.test(name)) return name.replace(re, abbr);
  }

  const words = name.trim().split(/\s+/);
  if (words.length <= 1) return name;

  // A person: drop every leading initial/first name, keep the surname.
  const surname = words[words.length - 1];
  if (/^[A-Z]\.?$/.test(words[0]) || words.length >= 2) {
    return surname;
  }
  return name;
}

function initials(artist) {
  if (DJ_MC_PREFIX_RE.test(artist)) return artist;
  const words = artist.replace(LEADING_ARTICLE_RE, '').trim().split(/\s+/);
  if (words.length === 1) {
    // A band/one-word name: use it as-is (e.g. "NLO" already an acronym) or
    // derive initials from capitals if it reads as multiple words run together.
    return words[0];
  }
  if (/&/.test(artist)) {
    // "Marlow & Finch" -> "M&F"
    return words
      .filter((w) => w !== '&')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .split('')
      .join('')
      .replace(/^(.)(.*)$/, (_, a, b) => a + '&' + b);
  }
  return words.map((w) => w[0].toUpperCase() + '.').join('');
}

function cutAtWord(text, maxChars) {
  if (text.length <= maxChars) return text;
  const words = text.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? out + ' ' + w : w;
    if (next.length > maxChars - 1) break;
    out = next;
  }
  if (!out) return text.slice(0, Math.max(0, maxChars - 1)) + '…';
  return out + '…';
}

function join(artist, album) {
  return album ? `${artist} · ${album}` : artist;
}

/**
 * @param {{artist: string, album: string}} tags
 * @param {number} budget character budget (stand-in for a measured pixel width)
 * @returns {string} "ARTIST · ALBUM", title case
 */
function abbreviateSpineLabel(tags, budget) {
  const { artist, album } = clean(tags);

  // Step 2: self-titled, or no album — show the name once.
  if (isSelfTitled(artist, album)) {
    const full = artist;
    return full.length <= budget ? full : cutAtWord(full, budget);
  }

  // Step 3: keep the album whole, shorten the artist.
  let candidate = join(shortenArtist(artist), album);
  if (candidate.length <= budget) return candidate;

  // Step 4: album too long — drop a leading article, then any subtitle.
  let shortAlbum = album.replace(LEADING_ARTICLE_RE, '');
  candidate = join(shortenArtist(artist), shortAlbum);
  if (candidate.length <= budget) return candidate;

  shortAlbum = shortAlbum.replace(SUBTITLE_RE, '');
  candidate = join(shortenArtist(artist), shortAlbum);
  if (candidate.length <= budget) return candidate;

  // Step 5: surname plus the album cut at a word, if at least two words survive.
  const surname = shortenArtist(artist);
  const sep = ` · `;
  const albumBudget = budget - surname.length - sep.length;
  if (albumBudget >= 2) {
    const cut = cutAtWord(shortAlbum, albumBudget);
    const wordsLeft = cut.replace(/…$/, '').trim().split(/\s+/).filter(Boolean).length;
    if (wordsLeft >= 2 || cut.length === shortAlbum.length) {
      return join(surname, cut);
    }
  }

  // Step 6: initials with the album whole; last resort, the album cut with an ellipsis.
  const abbr = initials(artist);
  candidate = join(abbr, shortAlbum);
  if (candidate.length <= budget) return candidate;

  const albumBudget2 = Math.max(1, budget - abbr.length - sep.length);
  return join(abbr, cutAtWord(shortAlbum, albumBudget2));
}

module.exports = { abbreviateSpineLabel, clean, isSelfTitled, shortenArtist, initials };
