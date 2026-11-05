import { el } from '../util/dom.js';
import { getVariantDef, variantBackground } from '../record-art/tiers.js';

export function collectionBadge(rec){
  const cell = el('div','profile-badge-cell');
  const badge = el('div','profile-badge');
  // rec.variant may be a pre-CR7 id from an older save (docs/13_CRATE.md,
  // CR7 point 4) — getVariantDef() resolves it through the migration map
  badge.style.background = variantBackground(getVariantDef(rec.variant));
  cell.appendChild(badge);
  cell.appendChild(el('span','profile-badge-label', rec.name));
  return cell;
}
