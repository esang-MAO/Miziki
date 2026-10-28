/* ================= connected crate (docs/20_CONNECTED.md) =================
   The artist page's "Connected" shelf: records by artists related to this
   one — its members' own records, bands this artist was in, named
   collaborations — from MusicBrainz, via the shared server-side cache
   (migration 023, read through MizikiSocial.artistConnections()). Phones
   never call MusicBrainz themselves.

   Calm by default: with social not configured, the cache empty, or the
   mb-connections edge function still switched off, nothing renders — the
   shelf only appears once there's something real to show. Every name and
   title here comes from MusicBrainz, so it's built with textContent only,
   same rule as tag text (CLAUDE.md, Security). */
import { el } from '../util/dom.js';
import { normKey } from '../util/text.js';
import { isLibraryArtist, openPersonOrArtist } from './credits.js';

export const PREVIEW_COUNT = 4;
const ROLE_LABEL = { member: 'Member', band: 'Band', collab: 'Collab' };

// The preview shows one record per related artist before it shows a
// second from any of them, so four rows read as "four people" rather
// than one prolific member's first four albums. Order within an artist
// is kept as the server sent it (oldest first). Pure — tested.
export function connectedPreview(items, limit = PREVIEW_COUNT){
  const byVia = new Map();
  (items || []).forEach(it => {
    if(!byVia.has(it.via_mbid)) byVia.set(it.via_mbid, []);
    byVia.get(it.via_mbid).push(it);
  });
  const queues = [...byVia.values()];
  const out = [];
  for(let round = 0; out.length < limit && queues.some(q => q.length > round); round++){
    for(const q of queues){
      if(out.length >= limit) break;
      if(q[round]) out.push(q[round]);
    }
  }
  return out;
}

// Only ever an https:// link from the server; anything else is dropped
// rather than rendered as a clickable href.
export function safeBuyUrl(u){
  return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
}

function sleeve(title){
  const s = el('span','connected-sleeve');
  s.setAttribute('aria-hidden','true');
  s.appendChild(el('span','connected-sleeve-title', title));
  return s;
}

function connectedRow(it){
  const row = el('li','connected-row');
  row.appendChild(sleeve(it.title));

  const text = el('span','connected-text');
  text.appendChild(el('b', null, it.title));
  const sub = el('span','connected-sub');
  // the related artist's name links to their own artist page when they're
  // already in this library — otherwise it's plain text
  if(isLibraryArtist(it.via_name)){
    const who = el('button','link-btn connected-who', it.via_name);
    who.addEventListener('click', () => openPersonOrArtist(it.via_name));
    sub.appendChild(who);
  } else sub.appendChild(el('span','connected-who', it.via_name));
  if(it.year) sub.appendChild(document.createTextNode(' · ' + it.year));
  text.appendChild(sub);
  row.appendChild(text);

  row.appendChild(el('span','connected-role', ROLE_LABEL[it.role] || 'Related'));

  const buy = safeBuyUrl(it.buy_url);
  if(buy){
    const a = el('a','connected-buy','Buy ↗');
    a.href = buy; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', 'Buy from ' + it.via_name + ' (opens in a new tab)');
    row.appendChild(a);
  }
  return row;
}

function renderConnected(section, items){
  const head = el('div','connected-head');
  head.appendChild(el('h3','connected-eyebrow','Connected'));
  section.appendChild(head);

  const list = el('ul','connected-list');
  const preview = connectedPreview(items);
  preview.forEach(it => list.appendChild(connectedRow(it)));
  section.appendChild(list);

  if(items.length > preview.length){
    const all = el('button','link-btn connected-all','See all ' + items.length);
    all.setAttribute('aria-expanded','false');
    all.addEventListener('click', () => {
      const open = all.getAttribute('aria-expanded') !== 'true';
      list.textContent = '';
      (open ? items : preview).forEach(it => list.appendChild(connectedRow(it)));
      all.setAttribute('aria-expanded', String(open));
      all.textContent = open ? 'Show fewer' : 'See all ' + items.length;
    });
    head.appendChild(all);
  }
}

// Appends the (initially hidden) shelf to `host` and fills it when the
// cache answers. renderTracks() rebuilds the whole library host on every
// render, so a late answer for a page that's since moved on lands in a
// detached node and is dropped.
export function appendConnectedShelf(host, artist){
  if(typeof MizikiSocial === 'undefined' || !MizikiSocial.status || !MizikiSocial.status().enabled) return;
  if(!MizikiSocial.artistConnections) return;
  const section = el('section','connected');
  section.hidden = true;
  host.appendChild(section);
  MizikiSocial.artistConnections(artist, normKey(artist)).then(res => {
    if(!section.isConnected || !res || !res.ok || !res.items || !res.items.length) return;
    renderConnected(section, res.items);
    section.hidden = false;
  }).catch(() => {});
}
