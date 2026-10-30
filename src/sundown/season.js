/* RW6 (docs/23_RHYTHM_AND_WEAR.md): the sky follows the seasons. Pure —
   no S, no DOM — so src/player/clock.js's skyGradientStops() can ask it
   for blend weights without any of this module caring where "now" or
   "here" comes from. The four seasons peak Apr 20 / Jul 20 / Oct 20 /
   Jan 20 and blend smoothly through the rest of the year; southern
   latitudes get the same four peaks with spring/autumn and summer/
   winter swapped, since a Southern Hemisphere spring falls when a
   Northern one is in autumn. No location (lat null/undefined): northern,
   per the plan. */

const MS_PER_DAY = 86400000;
const YEAR_DAYS = 365;

// Fixed day-of-year constants for the four peak dates, computed once
// against a non-leap reference year (2001) so a real Feb 29 in the
// caller's year shifts everything by at most one day -- negligible for
// a "gentle" seasonal tint, not asserted by the tests below.
const PEAK_DOY = {
  spring: Math.round((Date.UTC(2001, 3, 20) - Date.UTC(2001, 0, 1)) / MS_PER_DAY), // Apr 20 -> 109
  summer: Math.round((Date.UTC(2001, 6, 20) - Date.UTC(2001, 0, 1)) / MS_PER_DAY), // Jul 20 -> 200
  autumn: Math.round((Date.UTC(2001, 9, 20) - Date.UTC(2001, 0, 1)) / MS_PER_DAY), // Oct 20 -> 292
  winter: Math.round((Date.UTC(2001, 0, 20) - Date.UTC(2001, 0, 1)) / MS_PER_DAY), // Jan 20 -> 19
};

function dayOfYear(date){
  const d = new Date(date);
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((today - startOfYear) / MS_PER_DAY);
}

// Circular distance between two days-of-year over a 365-day wheel, so
// Jan 20 and Dec 20 (31 days apart) read as close as they actually are.
function circDist(a, b){
  const d = Math.abs(a - b);
  return Math.min(d, YEAR_DAYS - d);
}

// seasonTint(date, lat) -> {spring, summer, autumn, winter}, weights in
// [0,1] summing to 1, continuous across the year, peaking 1 at each
// season's named date and shading smoothly into its neighbours. A
// raised-cosine (Hann-like) kernel per season, normalized so the four
// always sum to exactly 1 -- never all zero, since the nearest peak is
// always within half the 91-day gap between peaks.
export function seasonTint(date, lat){
  const doy = dayOfYear(date);
  const raw = {};
  for(const season of Object.keys(PEAK_DOY)){
    const d = circDist(doy, PEAK_DOY[season]);
    const c = Math.max(0, Math.cos(Math.PI * d / (YEAR_DAYS / 2)));
    raw[season] = c * c;
  }
  const sum = raw.spring + raw.summer + raw.autumn + raw.winter;
  const northern = {
    spring: raw.spring / sum,
    summer: raw.summer / sum,
    autumn: raw.autumn / sum,
    winter: raw.winter / sum,
  };
  const southern = (lat != null && lat < 0);
  if(!southern) return northern;
  return { spring: northern.autumn, summer: northern.winter, autumn: northern.spring, winter: northern.summer };
}
