# Critic rubric — scoring against Cities: Skylines II

The critic is a brutal AAA art director. It writes no code. It takes its own screenshots with
`node tools/screenshot.mjs`, opens the PNGs, and scores **0–10**:

| Score | Meaning |
|---|---|
| 10 | Indistinguishable from a CS2 screenshot at the same framing. |
| 8.5 | AAA with nits. Pass threshold. |
| 7 | Good indie. Clearly a real game, clearly not CS2. |
| 5 | Programmer art: flat colours, boxes, no materials, no atmosphere. |
| 3 | Broken or nearly empty. |

**Pass = ≥ 8.5 AND zero console errors AND zero failed/missing modules AND draw calls within the module budget.**
Never round up. If it is a 7.4, write 7.4.

## What Cities: Skylines II actually looks like (reference description)

Real CS2 reference imagery is not reachable from this environment (egress proxy) and is copyrighted, so the critic
scores against this description. Judges must say so in their report.

**Terrain.** Rolling heightfield with soft, large-scale relief; grass is a dense, slightly desaturated green with
visible patchiness (dry patches, darker damp areas, mowed vs wild), never a single flat colour. Detail normal at
street level; macro variation breaks tiling at overview. Cliffs/rock show layered strata and are slope-driven.
Sand/mud gradients at shorelines. Water has a Fresnel reflection of the sky, subtle animated normals, a shallow
turquoise-to-deep-blue depth gradient, and a foam/wet band at the shore.

**Sky and light.** Physically plausible sky: Rayleigh blue at zenith fading to a warm, hazy horizon; sun disc with
glare; golden hour is orange-pink with long soft shadows; night is deep blue-black with a visible moon glow, stars
faint. Aerial perspective: distant objects lose contrast and shift toward the horizon colour. Cloud cover changes
shadow softness and overall brightness. Exposure is filmic (ACES); nothing clips to white except the sun.
Shadows are cascaded, contact-hardening-ish, with no visible acne, peter-panning, or cascade seams.

**Roads.** Asphalt is dark grey with fine aggregate noise, tyre-wear lanes slightly lighter, cracks and patches,
oil stains near intersections; wet roads reflect. Lane markings: crisp white/yellow dashed and solid lines with
slight wear; crosswalk stripes at intersections; stop lines; arrows. Curbs are lighter concrete with a real
height step; sidewalks have paving tiles with grime, and a grass verge or tree pits. Intersections are properly
joined (no overlapping geometry, no z-fighting), corners filleted.

**Buildings.** Facades have depth: window recesses, sills, balconies, cornices, ground-floor shopfronts with
awnings/signs, roofs with HVAC/water tanks/parapets. Materials: brick with mortar lines, concrete panels with
staining under sills, glass curtain walls with reflection and slightly varying tint per pane, plaster with
weathering. Variety: no two adjacent buildings identical; per-zone character (suburban houses with gables and
gardens; mid-rise apartments; downtown towers; industrial sheds with loading docks and smokestacks; offices with
glass). At night windows glow warm/cool with a random on/off pattern; shops have signage light.

**Props.** Trees are volumetric canopies with silhouette variety (not billboards edge-on), several species, trunk
visible, casting shadows; street lamps with warm pools of light on the road at night; benches, bins, hydrants,
signs, bus stops, parked cars, fences, hedges. Props follow roads and lots, never float or intersect.

**Traffic.** Cars with recognisable body types (sedan, SUV, van, truck, bus), painted metallic with reflection,
headlights + taillights at night with light spill on asphalt, moving in lanes, stopping at intersections, turning
with plausible curvature. Density that reads as "a city", not a parade.

**Atmosphere/post.** Subtle bloom on emissives, ambient occlusion in corners and under eaves, slight vignette, no
oversharpening, no obvious aliasing; night has a gentle blue ambient so scenes remain readable.

**Composition (whole game).** At `overview` the city reads as districts (downtown core, suburbs, industry near the
edge) with a road hierarchy (highway → avenues → locals), parks, water. Skyline has a few tall landmarks. It looks
inhabited.

## What the critic checks besides the look

1. Console: zero errors. Warnings listed.
2. `stats().modules`: no `failed` or `missing`.
3. Draw calls / triangles vs the module budget in ARCHITECTURE.md §8.
4. API contract: the module exports the fields in §4; `api` has the documented functions; events emitted as in §5.
5. Determinism: two screenshots with the same seed are pixel-identical at t=paused (compare hashes).
6. Screenshots at ≥ 3 times of day (09, 14, 19.5, 23) and ≥ 2 zoom levels (`showcase`, `showcase-close`, plus any
   the module documents).

## Report format (append to docs/STATUS.json via the orchestrator)

```json
{ "module": "roads", "round": 2, "score": 7.8, "pass": false,
  "errors": 0, "drawCalls": 88, "budgetDrawCalls": 120,
  "issues": [ "1. Lane markings blur at street level: increase texture res to 2048 or use SDF lines", "2. ..." ],
  "screenshots": ["shots/critic/roads-14-showcase.png", "..."] }
```
Issues are ranked by visual impact. Be specific and actionable: which texture, which camera, which value.
