import { normKey } from '../util/text.js';

/* ================= record art: quality tiers + variant selection =================
   Tier read from the decoder's own bit depth / sample rate, never file extension.
   Boundary rule: either dimension over the standard qualifies as hi-res, not both —
   ambiguous or missing metadata simply never crosses that threshold, which is the
   spec's "fall back a tier" behavior for free. */
export function trackTier(t){
  const m = t.meta || {};
  if(!m.lossless) return 1;
  if((m.bits || 0) > 16 || (m.rate || 0) > 44100) return 3;
  return 2;
}

function hash32(str){
  let h = 2166136261;
  for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// "album" here is the same grouping key the Library view already uses (t.tags.album),
// so session tracking, the rare-variant unlock, and variant selection below all
// line up with what the user sees as "the album"
export function albumKey(t){ return normKey(t.tags.album); }
// normalized artist+album+title, independent of the file itself — lets a
// track's play-count stats (and the metal ladder they drive) survive a
// delete + re-import of a different file for the same song (see LIBRARY spec §1)
export function trackIdentityKey(t){ return normKey(t.tags.artist) + '|' + albumKey(t) + '|' + normKey(t.tags.title); }
// hash input is the album identity, not the individual track — a real pressing
// is one physical disc per release, not a different one per song, so every
// track on the same body of work lands on the same index into its tier's
// array. Never the file id/path, which changes when a library is reorganized.
function variantHashKey(t){ return albumKey(t); }

const SOLID_POOL = ['solid-white','solid-red','solid-blue','solid-yellow','solid-green','solid-purple'];
const EFFECT_POOL = ['effect-swirl-a','effect-swirl-b','effect-split-ab','effect-splatter-a','effect-splatter-b'];
// palette below is a placeholder — exact tier-2 solids / tier-3 effect designs are an open item
export const VARIANT_DEFS = {
  'classic-black':     {pattern:'solid',    colors:['#26282F','#15161B','#0D0E13']},
  'solid-white':       {pattern:'solid',    colors:['#F4F1E9','#D8D3C6','#B9B29E']},
  'solid-red':         {pattern:'solid',    colors:['#D9503F','#A5321F','#6E1E12']},
  'solid-blue':        {pattern:'solid',    colors:['#3E6FA8','#294C7C','#152A4A']},
  'solid-yellow':      {pattern:'solid',    colors:['#E8C34A','#B8912A','#7A5C15']},
  'solid-green':       {pattern:'solid',    colors:['#4E9563','#317047','#1B4229']},
  'solid-purple':      {pattern:'solid',    colors:['#8B5FB0','#5F3C7E','#3A2350']},
  'effect-swirl-a':    {pattern:'swirl',    colors:['#D9503F','#3E6FA8','#0D0E13']},
  'effect-swirl-b':    {pattern:'swirl',    colors:['#E8C34A','#4E9563','#0D0E13']},
  'effect-split-ab':   {pattern:'split',    colors:['#F4F1E9','#15161B','#0D0E13']},
  'effect-splatter-a': {pattern:'splatter', colors:['#F4F1E9','#D9503F','#0D0E13']},
  'effect-splatter-b': {pattern:'splatter', colors:['#3E6FA8','#E8C34A','#0D0E13']}
};

// expand tier weights into a flat lookup array once, at script load — selection
// itself is then a single index, never a runtime probability roll
function buildWeightedArray(pool, count){
  const arr = [];
  for(let i=0;i<count;i++) arr.push(pool[i % pool.length]);
  return arr;
}
const TIER_ARRAYS = {
  1: ['classic-black'],
  2: buildWeightedArray(SOLID_POOL, 80).concat(buildWeightedArray(['classic-black'], 20)),
  3: buildWeightedArray(EFFECT_POOL, 70).concat(buildWeightedArray(SOLID_POOL, 20)).concat(buildWeightedArray(['classic-black'], 10))
};

export function selectVariant(t){
  const tier = trackTier(t);
  const arr = TIER_ARRAYS[tier];
  const h = hash32(variantHashKey(t));
  return {tier, variant: arr[h % arr.length]};
}

export function variantBackground(def){
  const [a,b,c] = def.colors;
  if(def.pattern === 'split'){
    return 'conic-gradient(from 0deg,' + a + ' 0deg 179deg,' + b + ' 179deg 180deg,'
      + c + ' 180deg 359deg,' + b + ' 359deg 360deg)';
  }
  if(def.pattern === 'swirl'){
    return 'conic-gradient(from 0deg,' + a + ',' + b + ',' + c + ',' + a + ',' + b + ',' + c + ',' + a + ')';
  }
  if(def.pattern === 'splatter'){
    const spots = [[30,25],[70,20],[50,50],[20,65],[80,60],[40,80],[65,40],[15,40]];
    const layers = spots.map(([x,y],i) =>
      'radial-gradient(circle at ' + x + '% ' + y + '%,' + (i % 2 ? b : a) + ' 0 6%,transparent 7%)');
    layers.push('radial-gradient(circle at 50% 50%,' + c + ' 0 90%,' + c + ' 90% 100%)');
    return layers.join(',');
  }
  return 'radial-gradient(circle at 50% 50%,' + a + ' 0 27%,' + b + ' 27% 90%,' + c + ' 90% 100%)';
}
