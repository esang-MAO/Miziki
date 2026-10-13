/* ================= day arc: the day model (DA1, docs/DAY_ARC.md) =================
   Pure functions, no DOM, no S import — dayEvents()/dayPosition() take
   plain dates/lat/lon and an events object, the same "testable without a
   browser" shape as sundown/solar.js itself. src/sundown/solar.js's
   computeSun()/sunProgress()/easedProgress() are the only real callers;
   this is where the actual day-model math lives. */
import { solarEvent, solarNoon, solarAltitudeAtNoon } from './solar.js';
import { clamp } from '../util/math.js';

const MIN = 60000;
const MORNING_SPAN_MS = 3 * 60 * MIN;   // Morning: sunrise -> ~3h after
const GOLDEN_SPAN_MS = 60 * MIN;        // Golden hour: ~1h before sunset -> sunset

// Dawn/dusk are civil twilight (-6°, the sun 6° below the horizon); sunrise/
// sunset are the sun's own edge at the horizon (-0.833°, matching the
// -0.833° solarEvent() has always used for "set"). Solar noon never
// returns null (the sun transits the meridian every day, even through
// polar day/night), which is what lets dayPosition() tell polar day from
// polar night apart below when the other four do return null.
export function dayEvents(date, lat, lon){
  return {
    dawn: solarEvent(date, lat, lon, -6, true),
    rise: solarEvent(date, lat, lon, -0.833, true),
    noon: solarNoon(date, lon),
    set: solarEvent(date, lat, lon, -0.833, false),
    dusk: solarEvent(date, lat, lon, -6, false),
    // not one of the doc's own five named events — an internal field
    // dayPosition() reads only when dawn/rise/set/dusk are all missing
    // (a polar date), to classify day-all-day vs. night-all-day. See
    // solarAltitudeAtNoon's own comment in solar.js.
    altitudeAtNoon: solarAltitudeAtNoon(date, lat, lon),
  };
}

// dayPosition(now, events) -> { phase, phaseProgress, nightness, rateProgress }.
//
// rateProgress is the raw (un-paced — see src/sundown/solar.js's
// easedProgress(), which applies Window/Moment pacing on top of this) 0=day/
// 1=night curve computeRate() eases toward the night rate: 0 before sunset,
// 0->1 across sunset->dusk, 1 all night, 1->0 across dawn->sunrise, 0 again
// once past sunrise. nightness is the same curve under its own name, kept
// as a separate field since DA2/DA3/DA5 (docs/DAY_ARC.md) are each
// expected to read dayPosition()'s output for their own purposes (the
// character drift blend, the sky, the rhythm stat) — today they compute
// identically, but naming the general "how nighttime is it" concept apart
// from "what the platter rate curve specifically eases" avoids a rename
// later even though nothing in DA1 itself needs them to differ.
//
// phase is one of the seven named in docs/DAY_ARC.md's own day-model
// table: night, dawn, morning, midday, afternoon, golden, twilight.
// phaseProgress is 0..1 through whichever phase is current — for dawn
// specifically this is also "how far risen" (rateProgress = 1 -
// phaseProgress there, by construction — see the dawn branch below),
// which is what the readout's "N% of the way up" text reads directly
// (src/player/clock.js's drawSun()).
//
// Continuity across midnight needs no separate "yesterday"/"tomorrow"
// events, despite docs/DAY_ARC.md's own prose suggesting that as one way
// to do it: solarEvent()'s underlying Julian-day rounding already picks
// whichever calendar day is astronomically nearest to `now`, at any hour,
// so a single dayEvents(now, lat, lon) call always represents "today" in
// local solar terms regardless of when it's called — the night phase
// below folds both the pre-dawn tail of last night (now < dawn) and the
// post-dusk start of tonight (now >= dusk) into one flat phase, which is
// what actually closes the loop over midnight using only today's own
// events. Recomputing dayEvents() at local midnight (see solar.js's
// computeSun() and its callers) keeps "today's own events" from going
// stale, not from being structurally insufficient.
export function dayPosition(now, events){
  const t = now.getTime();
  const e = events || {};
  const { dawn, rise, noon, set, dusk, altitudeAtNoon } = e;

  // Legacy/partial data: set and dusk known, dawn/rise not — the exact
  // shape S.sun had before this PR, which tests/unit/solar.test.js's own
  // computeRate() fixtures still construct directly. Falls back to
  // exactly the pre-DA1 sunset-only progress (0 before sunset, linear
  // across the twilight window, 1 from dusk on) with no dawn-side
  // behavior at all, since there's nothing here to compute it from.
  if(set && dusk && (!dawn || !rise)){
    const setT = set.getTime(), duskT = dusk.getTime();
    if(t <= setT) return { phase: 'midday', phaseProgress: 0, nightness: 0, rateProgress: 0 };
    if(t >= duskT) return { phase: 'night', phaseProgress: 0, nightness: 1, rateProgress: 1 };
    const p = (t - setT) / (duskT - setT || 1);
    return { phase: 'twilight', phaseProgress: p, nightness: p, rateProgress: p };
  }

  if(!dawn || !rise || !set || !dusk){
    // No usable sunrise/sunset data at all: either a genuinely polar date
    // (solarEvent() returned null for every altitude the sun never
    // crosses) or no location yet. Classify a polar date by the sun's own
    // noon altitude; with no altitude reading either, default to day —
    // the same conservative "no data yet" default sunProgress() itself
    // already falls back to (its own `if(!S.sun.ok) return 0`) before
    // this function is ever reached from there.
    const polarNight = typeof altitudeAtNoon === 'number' && altitudeAtNoon < -0.833;
    return polarNight
      ? { phase: 'night', phaseProgress: 0, nightness: 1, rateProgress: 1 }
      : { phase: 'midday', phaseProgress: 0, nightness: 0, rateProgress: 0 };
  }

  const dawnT = dawn.getTime(), riseT = rise.getTime(), setT = set.getTime(), duskT = dusk.getTime();
  // Golden hour and Morning each reserve their own fixed span off the
  // sunset/sunrise end they're anchored to; Midday and Afternoon split
  // whatever's left between them, centred on solar noon where there's
  // room for it. Clamping morningEnd into goldenStart (and goldenStart
  // into [riseT, setT]) keeps every phase boundary monotonic — Morning
  // and Golden hour can shrink to zero width on a very short day, but
  // never overlap or run backward. The arc itself is schematic (see the
  // design README's own "not to scale" note on the day-arc artboard), so
  // exact minute-level placement for Midday/Afternoon isn't load-bearing;
  // nothing in DA1 itself reads either one specifically.
  const goldenStart = Math.max(setT - GOLDEN_SPAN_MS, riseT);
  const morningEnd = Math.min(riseT + MORNING_SPAN_MS, goldenStart);
  const middaySplit = clamp(noon ? noon.getTime() : (morningEnd + goldenStart) / 2, morningEnd, goldenStart);

  if(t < dawnT) return { phase: 'night', phaseProgress: 0, nightness: 1, rateProgress: 1 };

  if(t < riseT){
    const risen = (t - dawnT) / (riseT - dawnT || 1); // 0 at dawn, 1 at sunrise
    return { phase: 'dawn', phaseProgress: clamp(risen, 0, 1), nightness: 1 - risen, rateProgress: 1 - risen };
  }
  if(t < morningEnd){
    const p = (t - riseT) / (morningEnd - riseT || 1);
    return { phase: 'morning', phaseProgress: clamp(p, 0, 1), nightness: 0, rateProgress: 0 };
  }
  if(t < middaySplit){
    const p = (t - morningEnd) / (middaySplit - morningEnd || 1);
    return { phase: 'midday', phaseProgress: clamp(p, 0, 1), nightness: 0, rateProgress: 0 };
  }
  if(t < goldenStart){
    const p = (t - middaySplit) / (goldenStart - middaySplit || 1);
    return { phase: 'afternoon', phaseProgress: clamp(p, 0, 1), nightness: 0, rateProgress: 0 };
  }
  if(t < setT){
    const p = (t - goldenStart) / (setT - goldenStart || 1);
    return { phase: 'golden', phaseProgress: clamp(p, 0, 1), nightness: 0, rateProgress: 0 };
  }
  if(t < duskT){
    const p = (t - setT) / (duskT - setT || 1);
    return { phase: 'twilight', phaseProgress: clamp(p, 0, 1), nightness: p, rateProgress: p };
  }
  return { phase: 'night', phaseProgress: 0, nightness: 1, rateProgress: 1 };
}
