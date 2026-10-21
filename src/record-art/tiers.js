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

/* ================= CR7: pressings and finishes (docs/13_CRATE.md) =================
   The catalogue: 40 solids in nine families, 32 two-ink effects, four rare
   (session-unlock only), plus the one tier-1 pressing, Jet. Three stops
   are label ring / body / rim — kept as a flat `colors` 3-tuple so every
   existing consumer that reads def.colors positionally (shareSwatchGradient,
   the plain radial fallback below) keeps working unchanged; pattern-
   specific fields (inks/veins/tones/drift/rim/etc.) carry whatever each
   richer pattern needs beyond that 3-stop summary. `band` is 'common' |
   'uncommon' | 'scarce' for the 40 solids and 32 effects (docs/design/
   crate/README.md's own counts: 20/14/6 solids, 16/11/5 effects); Jet and
   the four rares aren't banded — Jet is the only tier-1 pressing, and
   rares come from the session unlock, not the file. */

const F = (ring, body, rim) => [ring, body, rim];

export const VARIANT_DEFS = {
  // ---- tier 1: the one lossy pressing ----
  jet: {
    family: 'jet', finish: 'opaque', band: null, pattern: 'solid',
    colors: F('#2B2622', '#1A1716', '#0C0B0A'),
    name: 'Jet', sub: null,
    note: 'Plain and warm-black — a lossy file presses the same every time.',
  },

  // ---- tier 2: 40 solids, nine families ----
  oxblood:     {family:'reds', finish:'opaque', band:'common', pattern:'solid', colors:F('#8A2E2A','#6B1F1C','#3E1210'), name:'Oxblood', sub:null, note:'A deep, dried-blood red — the common red of the shelf.'},
  madder:      {family:'reds', finish:'opaque', band:'common', pattern:'solid', colors:F('#B5433A','#9A3328','#5C1A14'), name:'Madder', sub:null, note:'Warmer and brighter than Oxblood, named for the root it comes from.'},
  vermilion:   {family:'reds', finish:'opaque', band:'common', pattern:'solid', colors:F('#D94A32','#C4302B','#6E1712'), name:'Vermilion', sub:null, note:'A hot, orange-leaning red that reads loud on the shelf.'},
  terracotta:  {family:'reds', finish:'opaque', band:'uncommon', pattern:'solid', colors:F('#D3694A','#C05131','#7E3119'), name:'Terracotta', sub:null, note:'Fired-clay orange-red, a little less common than its red cousins.'},
  coral:       {family:'pinks', finish:'opaque', band:'common', pattern:'solid', colors:F('#E8806A','#D4674F','#8A3A2A'), name:'Coral', sub:null, note:'A warm, living pink-orange — the common pink of the shelf.'},
  rose:        {family:'pinks', finish:'translucent', band:'uncommon', pattern:'solid', colors:F('#C45C7A','#D97A96','#7A2E48'), name:'Rose', sub:null, note:'A see-through pink with real depth — the light moves through it.'},
  blush:       {family:'pinks', finish:'opaque', band:'common', pattern:'solid', colors:F('#F0D0C8','#E3B8AE','#B48A80'), name:'Blush', sub:null, note:'The palest pink that still reads as a colour, not a white.'},
  fuchsia:     {family:'pinks', finish:'opaque', band:'scarce', pattern:'solid', colors:F('#B03A78','#9A2B66','#5E1A3E'), name:'Fuchsia', sub:null, note:'A bright, hot pink — one of the rarer solids to turn up.'},
  ochre:       {family:'earths', finish:'opaque', band:'common', pattern:'solid', colors:F('#B8862E','#9A6E22','#5E4212'), name:'Ochre', sub:null, note:'An earthy gold-brown, as far toward yellow as this chart goes.'},
  sienna:      {family:'earths', finish:'opaque', band:'common', pattern:'solid', colors:F('#A0522D','#8B4426','#4F2412'), name:'Sienna', sub:null, note:'Burnt-orange brown, named for the earth pigment of the same name.'},
  caramel:     {family:'earths', finish:'translucent', band:'scarce', pattern:'solid', colors:F('#B07A45','#C99458','#6B4522'), name:'Caramel', sub:null, note:'A honeyed, see-through brown — one of the harder solids to find.'},
  umber:       {family:'earths', finish:'translucent', band:'uncommon', pattern:'solid', colors:F('#6B4A2E','#8A6238','#3E2A18'), name:'Umber', sub:'Root beer', note:'A warm, translucent brown collectors call Root beer.'},
  sepia:       {family:'earths', finish:'opaque', band:'common', pattern:'solid', colors:F('#6A4F3A','#4E3728','#2A1D14'), name:'Sepia', sub:null, note:'Old-photograph brown, flat and even.'},
  puce:        {family:'earths', finish:'opaque', band:'common', pattern:'solid', colors:F('#9C6E72','#7E555A','#4F3337'), name:'Puce', sub:null, note:'A dusty brown-pink that sits between the earths and the pinks.'},
  isabelline:  {family:'whites', finish:'opaque', band:'common', pattern:'solid', colors:F('#EDE3CF','#DCCDB0','#B8A684'), name:'Isabelline', sub:null, note:'A warm off-white, the most common of the whites.'},
  bone:        {family:'whites', finish:'translucent', band:'uncommon', pattern:'solid', colors:F('#F1EDE3','#DED7C7','#A9A69B'), name:'Bone', sub:null, note:'A pale, see-through white with a cool edge at the rim.'},
  chalk:       {family:'whites', finish:'opaque', band:'common', pattern:'solid', colors:F('#F4F1EA','#E6E2DA','#B9B5AC'), name:'Chalk', sub:null, note:'The flattest, chalkiest white on the shelf.'},
  celadon:     {family:'whites', finish:'opaque', band:'uncommon', pattern:'solid', colors:F('#9FB8A4','#86A28C','#5D7564'), name:'Celadon', sub:null, note:'A pale glaze-green, named for the old Chinese pottery colour.'},
  olive:       {family:'greens', finish:'opaque', band:'common', pattern:'solid', colors:F('#6E7A3A','#4A5527','#2B3115'), name:'Olive', sub:null, note:'A dusty green-brown, the common green of the shelf.'},
  pine:        {family:'greens', finish:'opaque', band:'uncommon', pattern:'solid', colors:F('#1E4D3A','#2A6A4F','#102A20'), name:'Pine', sub:null, note:'A deep, cool evergreen.'},
  verdigris:   {family:'greens', finish:'translucent', band:'uncommon', pattern:'solid', colors:F('#3F8C7E','#5BAA99','#2A5E54'), name:'Verdigris', sub:'Sea glass', note:'The green that grows on copper — collectors call it Sea glass.'},
  viridian:    {family:'greens', finish:'translucent', band:'uncommon', pattern:'solid', colors:F('#1F6B5A','#2E8A74','#133F35'), name:'Viridian', sub:null, note:'A bright, see-through blue-green.'},
  emerald:     {family:'greens', finish:'translucent', band:'scarce', pattern:'solid', colors:F('#2E8B57','#3FA873','#1B5A38'), name:'Emerald', sub:null, note:'A rich, see-through jewel green — one of the rarer solids.'},
  teal:        {family:'teals', finish:'opaque', band:'common', pattern:'solid', colors:F('#1F6F73','#28868B','#123F42'), name:'Teal', sub:null, note:'An even blue-green, the common teal of the shelf.'},
  turquoise:   {family:'teals', finish:'translucent', band:'uncommon', pattern:'solid', colors:F('#2F9BA8','#49B8C4','#1E6670'), name:'Turquoise', sub:null, note:'A brighter, see-through blue-green.'},
  aquamarine:  {family:'teals', finish:'translucent', band:'scarce', pattern:'solid', colors:F('#8FD3CF','#A9E0DC','#5E9D99'), name:'Aquamarine', sub:null, note:'A pale sea-glass blue — one of the rarer solids to find.'},
  petrol:      {family:'teals', finish:'opaque', band:'common', pattern:'solid', colors:F('#204A52','#2C5E68','#13303A'), name:'Petrol', sub:null, note:'A dark, inky blue-green.'},
  prussian:    {family:'blues', finish:'translucent', band:'common', pattern:'solid', colors:F('#1F3F66','#2B5586','#122540'), name:'Prussian', sub:null, note:'A deep, see-through blue named for the old pigment.'},
  cobalt:      {family:'blues', finish:'translucent', band:'scarce', pattern:'solid', colors:F('#2A4FA0','#3660BE','#172B5C'), name:'Cobalt', sub:null, note:'A bright, see-through blue — one of the rarer solids.'},
  woad:        {family:'blues', finish:'opaque', band:'common', pattern:'solid', colors:F('#2B4A7A','#3B6192','#1A2E4A'), name:'Woad', sub:null, note:'A muted, dusty blue, named for the old dye plant.'},
  ultramarine: {family:'blues', finish:'opaque', band:'common', pattern:'solid', colors:F('#1E3A8A','#2949A6','#101F4A'), name:'Ultramarine', sub:null, note:'A rich, saturated blue.'},
  indigo:      {family:'blues', finish:'opaque', band:'common', pattern:'solid', colors:F('#2C2F5E','#3B4080','#1A1C3A'), name:'Indigo', sub:null, note:'A dark blue-violet, close to black at the rim.'},
  powderblue:  {family:'blues', finish:'opaque', band:'uncommon', pattern:'solid', colors:F('#CFE4F2','#B9D9EB','#8FB0C4'), name:'Powder blue', sub:null, note:'A pale, chalky blue.'},
  heliotrope:  {family:'purples', finish:'opaque', band:'uncommon', pattern:'solid', colors:F('#8A63A8','#6C4A8A','#44305A'), name:'Heliotrope', sub:null, note:'A soft purple named for the flower that turns toward the sun.'},
  tyrian:      {family:'purples', finish:'opaque', band:'scarce', pattern:'solid', colors:F('#6E2448','#5B1A3C','#3A0F26'), name:'Tyrian', sub:null, note:'A deep purple-red once reserved for royalty — one of the rarer solids.'},
  mauve:       {family:'purples', finish:'opaque', band:'uncommon', pattern:'solid', colors:F('#9B6B9E','#7E5280','#4E3250'), name:'Mauve', sub:null, note:'A soft, dusty purple.'},
  grape:       {family:'purples', finish:'opaque', band:'uncommon', pattern:'solid', colors:F('#6D4198','#582C83','#361A52'), name:'Grape', sub:null, note:'A deep, saturated purple.'},
  smoke:       {family:'greys', finish:'translucent', band:'uncommon', pattern:'solid', colors:F('#A9A7A4','#6E6C69','#2E2D2C'), name:'Smoke', sub:null, note:'A pale, see-through grey.'},
  paynesgrey:  {family:'greys', finish:'opaque', band:'common', pattern:'solid', colors:F('#4A5565','#3C4654','#232A33'), name:"Payne's grey", sub:null, note:'A cool, blue-leaning grey.'},
  graphite:    {family:'greys', finish:'opaque', band:'common', pattern:'solid', colors:F('#55585C','#3F4245','#222426'), name:'Graphite', sub:null, note:'A flat, even grey, the plainest of the family.'},

  // ---- tier 3: 32 two-ink effects ----
  'woad-madder':       {family:'effects', finish:'opaque', band:'common', pattern:'swirl', inks:['#2B4A7A','#B5433A'], rim:'#1A1A22', colors:F('#2B4A7A','#B5433A','#1A1A22'), name:'Woad & Madder', sub:null, note:'Two streaks of dusty blue and warm red, feathered through each other.'},
  'minium-vermilion':  {family:'effects', finish:'opaque', band:'uncommon', pattern:'swirl', inks:['#E0552A','#C4302B'], rim:'#5C1512', colors:F('#E0552A','#C4302B','#5C1512'), name:'Minium & Vermilion', sub:null, note:'Two close reds, swirled so they barely separate.'},
  'prussian-bone':     {family:'effects', finish:'opaque', band:'common', pattern:'swirl', inks:['#2B5586','#DED7C7'], rim:'#122540', colors:F('#2B5586','#DED7C7','#122540'), name:'Prussian & Bone', sub:null, note:'Deep blue streaked through pale bone.'},
  'viridian-ochre':    {family:'effects', finish:'opaque', band:'uncommon', pattern:'swirl', inks:['#2E8A74','#9A6E22'], rim:'#133F35', colors:F('#2E8A74','#9A6E22','#133F35'), name:'Viridian & Ochre', sub:null, note:'Blue-green swirled against earthy gold.'},
  'oxblood-split':     {family:'effects', finish:'opaque', band:'common', pattern:'split', inks:['#6B1F1C','#DCCDB0'], rim:'color-mix(in srgb,#6B1F1C 60%,black 40%)', colors:F('#6B1F1C','#DCCDB0','#3E1210'), name:'Oxblood split', sub:null, note:'A clean seam of deep red against pale bone.'},
  'tyrian-split':      {family:'effects', finish:'opaque', band:'uncommon', pattern:'split', inks:['#5B1A3C','#DCCDB0'], rim:'color-mix(in srgb,#5B1A3C 60%,black 40%)', colors:F('#5B1A3C','#DCCDB0','#3A0F26'), name:'Tyrian split', sub:null, note:'A seam of royal purple against pale bone.'},
  'jet-bone':          {family:'effects', finish:'opaque', band:'common', pattern:'split', inks:['#1A1716','#DED7C7'], rim:'#0C0B0A', colors:F('#1A1716','#DED7C7','#0C0B0A'), name:'Jet & Bone', sub:null, note:'Half black, half pale bone, split clean down the middle.'},
  lapis:               {family:'effects', finish:'opaque', band:'scarce', pattern:'marble', body:'#1E3A8A', veins:'#E9E4D6', flecks:'#C9A24A', rim:'#101F4A', colors:F('#1E3A8A','#E9E4D6','#101F4A'), name:'Lapis', sub:null, note:'Deep blue marbled with pale veins and small gold flecks.'},
  malachite:           {family:'effects', finish:'opaque', band:'scarce', pattern:'marble', body:'#2E8A74', veins:'#133F35', rim:'#0E2E27', colors:F('#2E8A74','#133F35','#0E2E27'), name:'Malachite', sub:null, note:'Banded green marble, like the stone it is named for.'},
  serpentine:          {family:'effects', finish:'opaque', band:'uncommon', pattern:'marble', body:'#4A5527','veins':'#9FB8A4', rim:'#2B3115', colors:F('#4A5527','#9FB8A4','#2B3115'), name:'Serpentine', sub:null, note:'Mottled olive-green marble.'},
  'mauve-measles':     {family:'effects', finish:'opaque', band:'common', pattern:'splatter', base:'#DCCDB0', ink:'#9B6B9E', rim:'#B8A684', colors:F('#DCCDB0','#9B6B9E','#B8A684'), name:'Mauve Measles', sub:null, note:'Small purple spots scattered across a pale field.'},
  soot:                {family:'effects', finish:'opaque', band:'common', pattern:'splatter', base:'#E6E2DA', ink:'#1A1716', rim:'#B9B5AC', colors:F('#E6E2DA','#1A1716','#B9B5AC'), name:'Soot', sub:null, note:'Black spots scattered across chalk.'},
  'verdigris-jet':      {family:'effects', finish:'opaque', band:'common', pattern:'splatter', base:'#1A1716', ink:'#5BAA99', rim:'#0C0B0A', colors:F('#1A1716','#5BAA99','#0C0B0A'), name:'Verdigris on Jet', sub:null, note:'A friend’s copy says “lossy” without a word.'},
  'paynes-smoke':      {family:'effects', finish:'translucent', band:'common', pattern:'smoke', tones:['#2E333D','#5A6372','#1E2229'], drift:'#8A93A0', rim:'#1E2229', colors:F('#2E333D','#5A6372','#1E2229'), name:"Payne's Smoke", sub:null, note:'A cool grey haze, always slowly drifting.'},
  'tobacco-smoke':     {family:'effects', finish:'translucent', band:'uncommon', pattern:'smoke', tones:['#4E3728','#8A6238','#2A1D14'], drift:'#B8862E', rim:'#2A1D14', colors:F('#4E3728','#8A6238','#2A1D14'), name:'Tobacco Smoke', sub:null, note:'A warm brown haze, like smoke in a lit room.'},
  'heliotrope-ring':   {family:'effects', finish:'opaque', band:'uncommon', pattern:'ring', inner:'#6C4A8A', outer:'#9A6E22', rim:'#5E4212', colors:F('#6C4A8A','#9A6E22','#5E4212'), name:'Heliotrope ring', sub:null, note:'A purple ring set inside earthy gold.'},
  'teal-coral':        {family:'effects', finish:'opaque', band:'common', pattern:'swirl', inks:['#28868B','#D4674F'], rim:'#123F42', colors:F('#28868B','#D4674F','#123F42'), name:'Teal & Coral', sub:null, note:'Blue-green streaked through warm coral.'},
  'grape-chalk':       {family:'effects', finish:'opaque', band:'common', pattern:'swirl', inks:['#582C83','#E6E2DA'], rim:'#361A52', colors:F('#582C83','#E6E2DA','#361A52'), name:'Grape & Chalk', sub:null, note:'Deep purple swirled through flat white.'},
  'olive-terracotta':  {family:'effects', finish:'opaque', band:'common', pattern:'swirl', inks:['#4A5527','#C05131'], rim:'#2B3115', colors:F('#4A5527','#C05131','#2B3115'), name:'Olive & Terracotta', sub:null, note:'Dusty green streaked through fired clay.'},
  'ultramarine-verdigris':{family:'effects', finish:'opaque', band:'common', pattern:'swirl', inks:['#2949A6','#5BAA99'], rim:'#101F4A', colors:F('#2949A6','#5BAA99','#101F4A'), name:'Ultramarine & Verdigris', sub:null, note:'Rich blue swirled with sea-glass green.'},
  'pine-split':        {family:'effects', finish:'opaque', band:'common', pattern:'split', inks:['#2A6A4F','#DED7C7'], rim:'color-mix(in srgb,#2A6A4F 60%,black 40%)', colors:F('#2A6A4F','#DED7C7','#102A20'), name:'Pine split', sub:null, note:'A seam of deep evergreen against pale bone.'},
  'rose-split':        {family:'effects', finish:'opaque', band:'common', pattern:'split', inks:['#D97A96','#E6E2DA'], rim:'color-mix(in srgb,#D97A96 60%,black 40%)', colors:F('#D97A96','#E6E2DA','#7A2E48'), name:'Rose split', sub:null, note:'A seam of soft pink against chalk.'},
  'prussian-ochre':    {family:'effects', finish:'opaque', band:'common', pattern:'split', inks:['#2B5586','#9A6E22'], rim:'color-mix(in srgb,#2B5586 60%,black 40%)', colors:F('#2B5586','#9A6E22','#122540'), name:'Prussian & Ochre', sub:null, note:'A seam of deep blue against earthy gold.'},
  rhodonite:           {family:'effects', finish:'opaque', band:'scarce', pattern:'marble', body:'#D97A96', veins:'#3C4654', rim:'#7A2E48', colors:F('#D97A96','#3C4654','#7A2E48'), name:'Rhodonite', sub:null, note:'Pink marble veined with cool grey, named for the stone.'},
  jasper:              {family:'effects', finish:'opaque', band:'uncommon', pattern:'marble', body:'#8B4426', veins:'#B8862E', rim:'#4F2412', colors:F('#8B4426','#B8862E','#4F2412'), name:'Jasper', sub:null, note:'Brown marble veined with gold.'},
  sodalite:            {family:'effects', finish:'opaque', band:'uncommon', pattern:'marble', body:'#3B6192', veins:'#E6E2DA', rim:'#1A2E4A', colors:F('#3B6192','#E6E2DA','#1A2E4A'), name:'Sodalite', sub:null, note:'Blue marble veined with chalk, named for the stone.'},
  'coral-teal':        {family:'effects', finish:'opaque', band:'uncommon', pattern:'splatter', base:'#28868B', ink:'#E8806A', rim:'#123F42', colors:F('#28868B','#E8806A','#123F42'), name:'Coral on Teal', sub:null, note:'Warm coral spots scattered across blue-green.'},
  ember:               {family:'effects', finish:'opaque', band:'scarce', pattern:'splatter', base:'#6B1F1C', ink:'#B8862E', rim:'#3E1210', colors:F('#6B1F1C','#B8862E','#3E1210'), name:'Ember', sub:null, note:'Gold spots scattered across deep red, like embers in coal.'},
  'rose-smoke':        {family:'effects', finish:'translucent', band:'uncommon', pattern:'smoke', tones:['#8A4A60','#B8678A','#5A2E40'], drift:'#E3B8AE', rim:'#5A2E40', colors:F('#8A4A60','#B8678A','#5A2E40'), name:'Rose Smoke', sub:null, note:'A warm pink haze, drifting slowly.'},
  'sea-smoke':         {family:'effects', finish:'translucent', band:'scarce', pattern:'smoke', tones:['#1F5A62','#3A8A94','#123F42'], drift:'#A9E0DC', rim:'#123F42', colors:F('#1F5A62','#3A8A94','#123F42'), name:'Sea Smoke', sub:null, note:'A cool sea-green haze — one of the rarer effects.'},
  'teal-ring':         {family:'effects', finish:'opaque', band:'uncommon', pattern:'ring', inner:'#28868B', outer:'#D4674F', rim:'#8A3A2A', colors:F('#28868B','#D4674F','#8A3A2A'), name:'Teal ring', sub:null, note:'A blue-green ring set inside warm coral.'},
  'oxblood-ring':      {family:'effects', finish:'opaque', band:'common', pattern:'ring', inner:'#6B1F1C', outer:'#DED7C7', rim:'#A9A69B', colors:F('#6B1F1C','#DED7C7','#A9A69B'), name:'Oxblood ring', sub:null, note:'A deep red ring set inside pale bone.'},

  // ---- rare: session unlock only, never from the file ----
  'ultra-clear': {family:'rare', finish:'translucent', band:null, pattern:'clear',
    colors:F('rgba(244,241,234,.9)','rgba(230,226,218,.55)','rgba(169,164,154,.9)'),
    name:'Ultra clear', sub:null, note:'Continuous material, no paper seam — the art extends across the whole disc.'},
  'picture-disc': {family:'rare', finish:'opaque', band:null, pattern:'picture',
    colors:F('#1A1716','#1A1716','#0C0B0A'),
    name:'Picture disc', sub:null, note:'The cover art itself, pressed onto the disc with real grooves.'},
  glow: {family:'rare', finish:'translucent', band:null, pattern:'glow',
    colors:F('#D6F2D0','#B8E8B0','#7FAE78'),
    name:'Glow', sub:null, note:'Phosphor green-white that reads brightest in the dark.'},
  'liquid-filled': {family:'rare', finish:'translucent', band:null, pattern:'liquid',
    colors:F('rgba(244,241,234,.9)','rgba(91,170,153,.9)','rgba(169,164,154,.9)'),
    drift:['rgba(63,140,126,.85)','rgba(91,170,153,.9)'],
    name:'Liquid filled', sub:null, note:'A band of green liquid that slides as the disc spins.'},
};

// Old ids (pre-CR7) mapped onto the new catalogue, so a saved Collection
// record (the one place an old variant id is actually persisted —
// S.collection[albumId].variant, see history/achievements.js) keeps
// resolving instead of throwing once the old entries are gone. The hash
// itself is unchanged, so this is a lookup fix, not a re-draw: an album
// that drew a solid before CR7 may land on a different solid (or even
// Jet) the next time selectVariant() actually runs for it, per the
// README's own "it may change colour once, on upgrade" note — this map
// only keeps *already-persisted* ids readable, it doesn't try to
// reproduce the exact old draw.
export const OLD_VARIANT_ID_MAP = {
  'classic-black': 'jet',
  'solid-white': 'bone',
  'solid-red': 'oxblood',
  'solid-blue': 'prussian',
  'solid-yellow': 'ochre',
  'solid-green': 'olive',
  'solid-purple': 'grape',
  'effect-swirl-a': 'woad-madder',
  'effect-swirl-b': 'teal-coral',
  'effect-split-ab': 'oxblood-split',
  'effect-splatter-a': 'mauve-measles',
  'effect-splatter-b': 'soot',
};

// Resolves a variant id through the migration map when it isn't (or isn't
// any more) a key of VARIANT_DEFS — the one thing every call site that
// might read a *persisted* id (rather than one just produced by
// selectVariant() below) needs, instead of indexing VARIANT_DEFS raw.
// Falls back to 'jet' for a truly unrecognized id, so a corrupted or
// future-schema id can never throw.
export function resolveVariantId(id){
  if(VARIANT_DEFS[id]) return id;
  const mapped = OLD_VARIANT_ID_MAP[id];
  if(mapped && VARIANT_DEFS[mapped]) return mapped;
  return 'jet';
}
export function getVariantDef(id){ return VARIANT_DEFS[resolveVariantId(id)]; }

// Exported (CR11, docs/13_CRATE.md point 3) so the profile's pressing
// chart can lay out its paint-chip strip "in family order" without a
// second copy of this filter — catalogue literal order already groups
// the 40 solids by pigment family (reds, pinks, earths, …) and the 32
// effects by their own neighbouring pattern, since VARIANT_DEFS itself
// is written in that order.
export const SOLID_IDS = Object.keys(VARIANT_DEFS).filter(id => VARIANT_DEFS[id].family !== 'effects' && VARIANT_DEFS[id].family !== 'rare' && id !== 'jet');
export const EFFECT_IDS = Object.keys(VARIANT_DEFS).filter(id => VARIANT_DEFS[id].family === 'effects');
const RARE_IDS = Object.keys(VARIANT_DEFS).filter(id => VARIANT_DEFS[id].family === 'rare');

const BAND_NAMES = ['common', 'uncommon', 'scarce'];
function poolByBand(ids, band){ return ids.filter(id => VARIANT_DEFS[id].band === band); }
const SOLID_BY_BAND = {common: poolByBand(SOLID_IDS, 'common'), uncommon: poolByBand(SOLID_IDS, 'uncommon'), scarce: poolByBand(SOLID_IDS, 'scarce')};
const EFFECT_BY_BAND = {common: poolByBand(EFFECT_IDS, 'common'), uncommon: poolByBand(EFFECT_IDS, 'uncommon'), scarce: poolByBand(EFFECT_IDS, 'scarce')};

// 60/30/10 light banding (README's own split) — two independent 32-bit
// hash slices, one for the band, one for the colour inside it, so adding
// a colour to one band never reshuffles another (and the same album
// always draws the same band+colour, since both slices are pure
// functions of the album's own identity key).
function pickBand(frac){
  if(frac < 0.6) return 'common';
  if(frac < 0.9) return 'uncommon';
  return 'scarce';
}
function pickFromPool(pool, frac){ return pool[Math.min(pool.length - 1, Math.floor(frac * pool.length))]; }
function frac32(key, salt){ return hash32(key + salt) / 4294967296; }

function drawFromCatalogue(key, byBand){
  const band = pickBand(frac32(key, '\u0001'));
  const pool = byBand[band];
  return pickFromPool(pool, frac32(key, '\u0002'));
}

// Tier mixes (README): lossy = Jet only; lossless = 85% solid / 15% Jet;
// hi-res = 70% effect / 25% solid / 5% Jet. A third, independent hash
// slice decides the mix so it never correlates with the band/colour draw.
//
// Split out of selectVariant() (CR11, docs/13_CRATE.md point 1) so a
// pressing can be drawn from a bare tier + identity key, not just from a
// real track object — exactly what's needed to show a *friend's* own
// copy of a shared album: the server knows their quality_tier
// (crate_items.quality_tier, already synced), but there's no file to
// call trackTier()/variantHashKey() on. selectVariant(t) below is now a
// thin wrapper that keeps its exact prior behavior byte-for-byte.
function selectVariantForTierKey(tier, key){
  if(tier === 1) return {tier, variant: 'jet'};
  const mixFrac = frac32(key, '\u0000');
  if(tier === 2){
    if(mixFrac < 0.15) return {tier, variant: 'jet'};
    return {tier, variant: drawFromCatalogue(key, SOLID_BY_BAND)};
  }
  // tier 3
  if(mixFrac < 0.05) return {tier, variant: 'jet'};
  if(mixFrac < 0.30) return {tier, variant: drawFromCatalogue(key, SOLID_BY_BAND)};
  return {tier, variant: drawFromCatalogue(key, EFFECT_BY_BAND)};
}
export function selectVariant(t){
  return selectVariantForTierKey(trackTier(t), variantHashKey(t));
}
// CR11 point 1: "the pressing is derived locally from the shared album
// key, so no new column" — albumTitle is the same string both sides'
// clients already agree on (what sync_crate stores as releases.title,
// itself a local track's own t.tags.album), normalized the same way
// albumKey()/variantHashKey() always have been, so a friend's own copy
// of an album a viewer also owns draws from the identical pool their own
// local selectVariant() would, differing only when the two quality_tier
// values actually differ.
export function selectVariantForAlbum(albumTitle, tier){
  return selectVariantForTierKey(tier, normKey(albumTitle));
}

// Rare pressings draw among the four session-unlock-only kinds, same
// deterministic-per-album hashing as the file-driven tiers above — "a
// record presses the same in every crate that holds it" per the README,
// now true of a rare pressing too, not just a solid/effect one.
export function selectRareVariant(t){
  return pickFromPool(RARE_IDS, frac32(variantHashKey(t), '\u0003'));
}

export function variantBackground(def){
  if(!def) return '';
  const [a, b, c] = def.colors;
  switch(def.pattern){
    case 'split': {
      const [i1, i2] = def.inks || [a, b];
      const rim = def.rim || c;
      return 'conic-gradient(from 0deg,' + i1 + ' 0deg 179deg,' + rim + ' 179deg 180deg,'
        + i2 + ' 180deg 359deg,' + rim + ' 359deg 360deg)';
    }
    case 'swirl': {
      // feathered streaks, not a conic wheel: two or three soft bands of
      // each ink laid across the disc at a shallow angle
      const [i1, i2] = def.inks || [a, b];
      const rim = def.rim || c;
      return 'repeating-linear-gradient(118deg,' + i1 + ' 0 18%,' + i2 + ' 18% 36%,' + i1 + ' 36% 54%,' + i2 + ' 54% 72%),'
        + 'radial-gradient(circle at 50% 50%,transparent 0 78%,' + rim + ' 92% 100%)';
    }
    case 'splatter': {
      const base = def.base || a, ink = def.ink || b, rim = def.rim || c;
      // small, dense, one-ink spots over a flat base — denser and smaller
      // than the old splatter's eight big dots
      const spots = [[18,22],[42,14],[66,20],[84,36],[30,44],[54,52],[78,58],[12,62],[36,72],[60,80],[82,78],[20,88],[46,30],[70,68],[8,40],[90,50]];
      const layers = spots.map(([x,y]) =>
        'radial-gradient(circle at ' + x + '% ' + y + '%,' + ink + ' 0 3%,transparent 4%)');
      layers.push('radial-gradient(circle at 50% 50%,' + base + ' 0 90%,' + rim + ' 90% 100%)');
      return layers.join(',');
    }
    case 'marble': {
      const body = def.body || a, veins = def.veins || b, rim = def.rim || c;
      const flecks = def.flecks;
      const veinLayer = 'repeating-linear-gradient(62deg,transparent 0 9%,' + veins + ' 9% 10.5%,transparent 10.5% 22%)';
      const layers = [veinLayer, 'radial-gradient(circle at 50% 50%,' + body + ' 0 82%,' + rim + ' 92% 100%)'];
      if(flecks) layers.unshift('radial-gradient(circle at 28% 64%,' + flecks + ' 0 2%,transparent 3%),'
        + 'radial-gradient(circle at 70% 30%,' + flecks + ' 0 2%,transparent 3%)');
      return layers.join(',');
    }
    case 'ring': {
      const inner = def.inner || a, outer = def.outer || b, rim = def.rim || c;
      return 'radial-gradient(circle at 50% 50%,' + inner + ' 0 34%,' + outer + ' 34% 90%,' + rim + ' 90% 100%)';
    }
    case 'smoke': {
      const [t1, t2, t3] = def.tones || [a, b, c];
      const drift = def.drift || t2;
      // soft drifting bands, translucent throughout
      return 'repeating-linear-gradient(140deg,' + t1 + ' 0 20%,' + drift + ' 20% 40%,' + t2 + ' 40% 60%,' + t3 + ' 60% 80%),'
        + 'radial-gradient(circle at 50% 50%,transparent 0 80%,' + t3 + ' 95% 100%)';
    }
    case 'clear':
      // ultra clear's own flat translucent body — the art-backed render
      // (continuous cover art across the disc) lives in looks.js, since
      // it needs the track's own art; this is the fallback with none.
      return 'radial-gradient(circle at 50% 50%,' + a + ' 0 60%,' + b + ' 60% 92%,' + c + ' 92% 100%)';
    case 'picture':
      return 'repeating-radial-gradient(circle at 50% 50%,' + b + ' 0 1px,' + a + ' 1px 3px),'
        + 'radial-gradient(circle at 50% 50%,transparent 0 94%,' + c + ' 94% 100%)';
    case 'glow':
      return 'radial-gradient(circle at 50% 50%,' + a + ' 0 40%,' + b + ' 40% 85%,' + c + ' 85% 100%)';
    case 'liquid': {
      const drift = def.drift || [a, b];
      // the tinted band's own angle is baked into the disc's background,
      // so it rotates with the platter rather than tracking the light —
      // the "angle follows the platter" rule from the README
      return 'conic-gradient(from 40deg,' + a + ' 0deg 150deg,' + drift[0] + ' 150deg 175deg,' + drift[1] + ' 175deg 200deg,' + a + ' 200deg 360deg),'
        + 'radial-gradient(circle at 50% 50%,transparent 0 88%,' + c + ' 94% 100%)';
    }
    default: // 'solid'
      return 'radial-gradient(circle at 50% 50%,' + a + ' 0 27%,' + b + ' 27% 90%,' + c + ' 90% 100%)';
  }
}

export { BAND_NAMES };
