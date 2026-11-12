// CO5 (docs/37_COLOUR.md, recommendation 6): ports docs/design/colour/
// spine-label.js's reference abbreviation algorithm into real shipped
// code -- "ARTIST · ALBUM" (title case; `.sp-label`'s own CSS applies the
// caps transform), shortened by steps (shorten the artist, drop a leading
// article, drop a subtitle, cut the album at a word, fall back to
// initials) until it fits. The one real change from the reference: a
// budget here is a measured pixel width, not a character-count stand-in.
//
// The budget itself is a *typical* width, not a live DOM measurement --
// shelf-unit.js's own layout is built the same way (SHELF_TOP_ZONE_PX,
// SHELF_ROW_PX, etc. are literal pixel reads of the 342x640 design mock,
// even though the unit itself renders at a fluid, percentage-based size
// via its aspect-ratio). A spine's rendered height in mock-px terms is
// derivable the same way: shelf-cell-recs' own vertical inset (6.667%
// top, 3.333% bottom of 18-storefront.css) leaves 90% of a row's
// SHELF_ROW_PX (150) for the recs track, and SPINE_HEIGHT_PCT then takes
// its own format-specific share of that -- see RECS_HEIGHT_PX below.
// This is why CO5's own instruction is "cache per album and format" and
// not "per album and live layout": the budget only ever depends on
// format, never on the viewport.
const SHELF_ROW_PX = 150; // shelf-unit.js's own SHELF_ROW_PX
const RECS_TOP_PCT = 6.667, RECS_BOTTOM_PCT = 3.333; // .shelf-cell-recs, 18-storefront.css
const RECS_HEIGHT_PX = SHELF_ROW_PX * (1 - (RECS_TOP_PCT + RECS_BOTTOM_PCT) / 100);
// shelf-unit.js's own SPINE_HEIGHT_PCT/SPINE_HEIGHT_DEFAULT, duplicated
// rather than imported -- a one-way read of two numbers beats a new
// import edge back from this pure-logic module.
const SPINE_HEIGHT_PCT = { '7"': 70, '10"': 80, '12"': 92 };
const SPINE_HEIGHT_DEFAULT = 88;
const SPINE_LABEL_TOP_BAND_PX = 7; // the darker top band .shelf-cell .sp paints
const SPINE_LABEL_PADDING_PX = 6; // 3px top + 3px bottom clearance for the label text

export function spineLabelBudgetPx(format){
  const pct = SPINE_HEIGHT_PCT[format] || SPINE_HEIGHT_DEFAULT;
  const spineHeightPx = RECS_HEIGHT_PX * (pct / 100);
  return Math.max(0, spineHeightPx - SPINE_LABEL_TOP_BAND_PX - SPINE_LABEL_PADDING_PX);
}

// The spine label's own font -- the same Antonio/--fs-caption/--track-caps
// combination record-art's own .label-title gives a record's printed
// title (02-stage-platter.css), since a spine's printed text is the same
// kind of physical-object detail.
const SPINE_FONT_WEIGHT = 700;
const SPINE_FONT_SIZE_PX = 12; // --fs-caption
const SPINE_FONT_FAMILY = 'Antonio';
// Used only until document.fonts.ready resolves (in practice already
// true by the time a profile screen first renders, since other screens
// load first) -- a rough per-uppercase-character estimate that slightly
// overshoots, so an early render abbreviates one step too far rather
// than risking overflow.
const FALLBACK_PX_PER_CHAR = 7.5;

let measureCtx = null;
let fontsReady = false;
if(typeof document !== 'undefined' && document.fonts){
  document.fonts.ready.then(() => { fontsReady = true; });
}

function getMeasureCtx(){
  if(measureCtx) return measureCtx;
  if(!fontsReady || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext && canvas.getContext('2d');
  if(!ctx) return null;
  ctx.font = SPINE_FONT_WEIGHT + ' ' + SPINE_FONT_SIZE_PX + 'px ' + SPINE_FONT_FAMILY;
  measureCtx = ctx;
  return measureCtx;
}

// Measures `text` as the spine will actually show it -- uppercase, via
// the same CSS text-transform `.sp-label` carries.
function measureTextWidth(text){
  const upper = text.toUpperCase();
  const ctx = getMeasureCtx();
  if(ctx) return ctx.measureText(upper).width;
  return upper.length * FALLBACK_PX_PER_CHAR;
}

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

const FEAT_RE = /\s*[([]?\s*feat\.?\s+[^)\]]*[)\]]?\s*$/i;
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

function clean({ artist, album }){
  const a = (album || '').replace(EDITION_TAG_RE, ' ').trim();
  let r = (artist || '').replace(FEAT_RE, '').trim();
  r = r.replace(LEADING_THE_RE, '');
  return { artist: r, album: a };
}

function isSelfTitled(artist, album){
  if(!album) return true;
  const norm = s => s.replace(LEADING_THE_RE, '').trim().toLowerCase();
  return norm(artist) === norm(album);
}

// "W. Okafor" -> "Okafor"; "DJ Sola" stays; a band name gets its standard
// abbreviations, not cut down to initials.
function shortenArtist(artist){
  if(DJ_MC_PREFIX_RE.test(artist)) return artist;
  for(const [re, abbr] of BAND_ABBREVIATIONS){
    if(re.test(artist)) return artist.replace(re, abbr);
  }
  const words = artist.trim().split(/\s+/);
  if(words.length <= 1) return artist;
  const surname = words[words.length - 1];
  if(/^[A-Z]\.?$/.test(words[0]) || words.length >= 2) return surname;
  return artist;
}

function initials(artist){
  if(DJ_MC_PREFIX_RE.test(artist)) return artist;
  const words = artist.replace(LEADING_ARTICLE_RE, '').trim().split(/\s+/);
  if(words.length === 1) return words[0];
  if(/&/.test(artist)){
    // "Marlow & Finch" -> "M&F"
    return words.filter(w => w !== '&').map(w => w[0]).join('')
      .toUpperCase().split('').join('').replace(/^(.)(.*)$/, (_, a, b) => a + '&' + b);
  }
  return words.map(w => w[0].toUpperCase() + '.').join('');
}

function cutAtWord(text, budgetPx){
  if(measureTextWidth(text) <= budgetPx) return text;
  const words = text.split(' ');
  let out = '';
  for(const w of words){
    const next = out ? out + ' ' + w : w;
    if(measureTextWidth(next + '…') > budgetPx) break;
    out = next;
  }
  if(!out) return ellipsizeToWidth(text, budgetPx);
  return out + '…';
}

// last-resort character trim for a single word too wide on its own
// (initials() always collapses to something short, but a one-word album
// title could still overflow a very narrow 7in spine).
function ellipsizeToWidth(text, budgetPx){
  let out = text;
  while(out.length > 1 && measureTextWidth(out + '…') > budgetPx) out = out.slice(0, -1);
  return out + '…';
}

function join(artist, album){ return album ? `${artist} · ${album}` : artist; }

/**
 * @param {{artist: string, album: string}} tags
 * @param {number} budgetPx measured pixel width available along the spine
 * @returns {string} "Artist · Album", title case
 */
export function abbreviateSpineLabel(tags, budgetPx){
  const { artist, album } = clean(tags);

  if(isSelfTitled(artist, album)){
    return measureTextWidth(artist) <= budgetPx ? artist : cutAtWord(artist, budgetPx);
  }

  let candidate = join(shortenArtist(artist), album);
  if(measureTextWidth(candidate) <= budgetPx) return candidate;

  let shortAlbum = album.replace(LEADING_ARTICLE_RE, '');
  candidate = join(shortenArtist(artist), shortAlbum);
  if(measureTextWidth(candidate) <= budgetPx) return candidate;

  shortAlbum = shortAlbum.replace(SUBTITLE_RE, '');
  candidate = join(shortenArtist(artist), shortAlbum);
  if(measureTextWidth(candidate) <= budgetPx) return candidate;

  const surname = shortenArtist(artist);
  const sepWidth = measureTextWidth(' · ');
  const albumBudget = budgetPx - measureTextWidth(surname) - sepWidth;
  if(albumBudget >= measureTextWidth('a')){
    const cut = cutAtWord(shortAlbum, albumBudget);
    const wordsLeft = cut.replace(/…$/, '').trim().split(/\s+/).filter(Boolean).length;
    if(wordsLeft >= 2 || cut.length === shortAlbum.length) return join(surname, cut);
  }

  const abbr = initials(artist);
  candidate = join(abbr, shortAlbum);
  if(measureTextWidth(candidate) <= budgetPx) return candidate;

  const albumBudget2 = Math.max(measureTextWidth('a'), budgetPx - measureTextWidth(abbr) - sepWidth);
  return join(abbr, cutAtWord(shortAlbum, albumBudget2));
}

// exported purely for tests -- never imported for real rendering.
export const _internal = { clean, isSelfTitled, shortenArtist, initials, measureTextWidth };
