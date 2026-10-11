import { el } from '../util/dom.js';
import { metalBackground } from '../record-art/metals.js';
import { VARIANT_DEFS, variantBackground } from '../record-art/tiers.js';

export function metalBadge(rec){
  const cell = el('div','profile-badge-cell');
  const badge = el('div','profile-badge');
  if(rec.tier === 'rare'){
    badge.style.background = rec.art ? 'url("' + rec.art + '") center/cover' : 'linear-gradient(155deg,#2A2018,#171310)';
  } else {
    badge.style.background = metalBackground(rec.tier);
    if(rec.art){ const im = document.createElement('img'); im.src = rec.art; im.alt = ''; badge.appendChild(im); }
  }
  cell.appendChild(badge);
  const label = rec.tier === 'rare' ? 'Rare' : rec.tier[0].toUpperCase() + rec.tier.slice(1);
  cell.appendChild(el('span','profile-badge-label', label));
  return cell;
}

export function collectionBadge(rec){
  const cell = el('div','profile-badge-cell');
  const badge = el('div','profile-badge');
  badge.style.background = variantBackground(VARIANT_DEFS[rec.variant]);
  cell.appendChild(badge);
  cell.appendChild(el('span','profile-badge-label', rec.name));
  return cell;
}
