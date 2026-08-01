# 24 — Replace approximate geometry with all 38 Elite-A designs

**Kind:** generated data / rendering · **Severity:** high · **Size:** large
**Depends on:** 21, 23

## Why

Several current hulls are approximations, some source objects use generic
stand-ins, and ten named Elite-A ships are absent. Geometry also supplies the
target radius that determines whether a laser hit registers, so it belongs in
the alignment work even though hit frequency is not part of the damage oracle.

## Implementation

- Generate one immutable geometry record per `ShipDesignId`. Variants share
  their design geometry; never duplicate it 260 times.
- Extend the renderer to consume exact source vertices, edges, face adjacency,
  face normals, visibility distances, normal scale and gun vertex.
- Reconstruct closed face loops for the dark occluding hull and preserve
  decorative edges that do not bound a face. Validate winding and orientation
  rather than silently dropping ambiguous edges.
- Define one `sourceGeometryToWorld()` conversion anchored so the Cobra Mk III
  retains its current visual scale. Apply the same conversion to all designs.
- Replace gameplay target radii with the catalogue's targetable radii converted
  through the same named scale.
- Supply exact designs for stations, escape pod, alloy plate, canister,
  boulder, asteroid, splinter and missile as well as mobile ships.
- Keep the procedural generation ship as a Harmless-only design outside the
  source registry.
- Add a development viewer showing all 38 labelled designs at common and
  relative scales with target-radius overlays.

## Acceptance

- Vertex, edge and face counts match the source for all 38 designs.
- Every index and face reference validates; all closed hulls occlude correctly.
- All designs remain `-Z` nose-forward with no per-ship spawning exception.
- Ray tests use exact source-backed target radii.
- Existing ship imports resolve through the registry and no approximate source
  hull remains in `src/ships/geometry.ts`.
- Screenshot review covers the complete viewer, both stations, small objects,
  front/rear silhouettes and a docking approach.

## Verify

Run generated-data checks, geometry validation, ray/hit tests and standard
verification, then record the viewer and docking visual checks.
