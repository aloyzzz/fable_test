// Per-type cross-section layout. All offsets are metres from the centreline; positive = right of travel a→b.
// `width` in Units.ROAD_TYPES is the full right-of-way (asphalt + curbs + sidewalks).
import { ROAD_TYPES } from '../../core/Units.js';

export const CURB_W = 0.35;      // curb top width (m)
export const CURB_H = 0.15;      // curb step height above asphalt (m)
export const LANE_W = 3.5;

export const LAYOUTS = {
  //            asphalt half-width, sidewalk width (0 = none), median half-width, lane centres (right side; mirrored), markings
  alley:   { asphalt: 3.2, sidewalk: 0.8, median: 0, laneW: 3.0, lanesRight: [1.6],
             markings: [], crosswalk: false, arrows: false, bulb: 8 },
  local:   { asphalt: 5.0, sidewalk: 3.0, median: 0, laneW: 3.5, lanesRight: [1.75],
             markings: [{ kind: 'solid', offset: 0.15, w: 0.1, color: 'yellow' }, { kind: 'solid', offset: -0.15, w: 0.1, color: 'yellow' },
                        { kind: 'solid', offset: 3.65, w: 0.12, color: 'white' }, { kind: 'solid', offset: -3.65, w: 0.12, color: 'white' }],
             crosswalk: true, arrows: true, bulb: 11 },
  avenue:  { asphalt: 8.0, sidewalk: 4.0, median: 1.0, medianKind: 'grass', laneW: 3.5, lanesRight: [2.75, 6.25],
             markings: [{ kind: 'solid', offset: 1.25, w: 0.12, color: 'yellow' }, { kind: 'solid', offset: -1.25, w: 0.12, color: 'yellow' },
                        { kind: 'dashed', offset: 4.5, w: 0.12, color: 'white' }, { kind: 'dashed', offset: -4.5, w: 0.12, color: 'white' },
                        { kind: 'solid', offset: 7.7, w: 0.12, color: 'white' }, { kind: 'solid', offset: -7.7, w: 0.12, color: 'white' }],
             crosswalk: true, arrows: true, bulb: 0 },
  highway: { asphalt: 16.0, sidewalk: 0, median: 1.5, medianKind: 'barrier', laneW: 3.5, lanesRight: [4.25, 7.75, 11.25],
             markings: [{ kind: 'solid', offset: 2.3, w: 0.15, color: 'yellow' }, { kind: 'solid', offset: -2.3, w: 0.15, color: 'yellow' },
                        { kind: 'dashed', offset: 6.0, w: 0.15, color: 'white' }, { kind: 'dashed', offset: -6.0, w: 0.15, color: 'white' },
                        { kind: 'dashed', offset: 9.5, w: 0.15, color: 'white' }, { kind: 'dashed', offset: -9.5, w: 0.15, color: 'white' },
                        { kind: 'solid', offset: 13.2, w: 0.15, color: 'white' }, { kind: 'solid', offset: -13.2, w: 0.15, color: 'white' }],
             crosswalk: false, arrows: false, bulb: 0 },
};

export function layoutOf(type) { return LAYOUTS[type] || LAYOUTS.local; }
export function rowHalf(type) { return (ROAD_TYPES[type] || ROAD_TYPES.local).width / 2; }

/**
 * Lane list for an edge: index 0..n-1 left→right looking a→b.
 * Two-way: left half drives b→a (dir -1), right half a→b (+1). One-way: every lane a→b.
 * One-way roads re-pack the lanes across the full asphalt width (no median).
 */
export function laneOffsets(type, oneWay) {
  const L = layoutOf(type);
  if (oneWay) {
    const n = L.lanesRight.length * 2, w = L.laneW;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ offset: (i - (n - 1) / 2) * w, dir: 1 });
    return out;
  }
  const left = L.lanesRight.slice().reverse().map((o) => ({ offset: -o, dir: -1 }));
  const right = L.lanesRight.map((o) => ({ offset: o, dir: 1 }));
  return [...left, ...right];
}

/** Marking strips for an edge (one-way roads: dashed white between lanes, solid white edges, no yellow). */
export function markingsFor(type, oneWay) {
  const L = layoutOf(type);
  if (!oneWay) return L.markings;
  const lanes = laneOffsets(type, true);
  const out = [];
  for (let i = 1; i < lanes.length; i++) out.push({ kind: 'dashed', offset: (lanes[i - 1].offset + lanes[i].offset) / 2, w: 0.12, color: 'white' });
  const edge = lanes[lanes.length - 1].offset + L.laneW / 2 + 0.15;
  if (edge < L.asphalt - 0.2) out.push({ kind: 'solid', offset: edge, w: 0.12, color: 'white' }, { kind: 'solid', offset: -edge, w: 0.12, color: 'white' });
  return out;
}
