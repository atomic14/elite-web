# 30 — Add the permanent Elite-A alignment gate

**Kind:** verification / documentation · **Severity:** high · **Size:** medium
**Depends on:** 21 through 29

## Why

The work is only durable if one command proves that source data, geometry,
identity, live combat and generated artifacts have not drifted—and if the
documentation clearly separates completed damage alignment from deferred
Elite-A features.

## Permanent command

Add `npm run elite-a` (or an equivalently clear command) that fails unless:

- vendored hashes match the manifest and generated output is current;
- counts remain 15 player hulls, 38 designs, 23 sets, 260 variants, 713 slot
  assignments and 398 populated assignments;
- all 38 geometries and target radii validate;
- all 15,600 outgoing, 3,900 incoming and 570 summarized oracle rows match;
- every player/design/exact-profile ID resolves and round-trips, and every
  recommended design lookup resolves to a real variant with the matching
  combat tuple;
- legacy player/NPC/system migrations pass;
- runtime lasers call the shared oracle functions;
- no retired normalized HP, random NPC laser-damage or mixed-unit adapter is
  reachable;
- all ten formerly missing ships are constructible and role-reachable; and
- custom Harmless profiles are excluded from source-parity claims.

## Browser acceptance

Exercise at minimum:

- pulse, beam and military player lasers against weak, armoured, regenerating,
  Constrictor and station targets;
- armed and unarmed NPCs against front and aft player shields;
- old and newly added small, medium and large hulls;
- Coriolis, Dodo, cargo, rocks and missiles;
- save/restore during combat without identity or energy drift;
- HUD, warnings, scanner labels, reports and deterministic replay.

## Documentation

1. Document the generated catalogue, stable IDs, geometry registry, damage
   flows, units and save schema.
2. Add source attribution and the manifest hash to the combat architecture
   notes.
3. Publish one compact table distinguishing exact Elite-A facts, clean
   recreation choices and Harmless-specific policies.
4. Document the deliberately deferred shipyard, Adder start, player flight
   profiles, per-mount equipment and S.A-S.W selection.
5. Add a future shipyard note: purchase changes `shipId`, validates loadout,
   rebuilds flight/capacity state and saves atomically; combat needs no new
   formula or data extraction.
6. Remove docs that still claim normalized shields, approximate source hulls,
   global laser damage or random NPC hit strength.

## Final verification

Run at minimum:

```text
npm run lint
npm test
npm run build
npm run elite-a
npm run campaign
npm run portability
git diff --check
```

Review bundle size, generated import cost, frame time and snapshot size before
marking the index 10/10 complete.

## Completion gate

- The permanent command is green locally and in CI.
- Browser acceptance is recorded and deviations are explicit.
- The TODO index reports 10/10 complete.
- Exact combat and geometry data are reusable by a future shipyard and
  blueprint selector without another model rewrite.
