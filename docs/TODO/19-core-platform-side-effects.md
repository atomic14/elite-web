# 19 — Core rule modules still perform platform side effects

**Kind:** platform leak / conjoined modules · **Severity:** medium · **Size:** large

## What is wrong

The governing pattern is “a module decides and reports; the orchestrator
applies.” `WorldStep` now follows it, but three core modules still cross that
boundary:

- `combat.ts` calls `sfx` while also returning `CombatEvent`s.
- `ordnance.ts` calls `sfx` while returning `OrdnanceReply`/`OrdnanceEvent`.
- `station.ts` calls audio, storage, and DOM screen renderers directly despite
  already having `StationEvent` and `StationHost` seams.

Headless execution works because those platform modules degrade gracefully, not
because the rules are actually independent of the platform.

## The fix

Make each module decide and report every platform consequence:

- Combat and ordnance should return named sound consequences alongside their
  existing semantic events/replies. Do not reintroduce raw frequencies.
- Station should report sound and presentation outcomes, and route persistence
  through the narrow host/orchestrator seam. Keep RNG-drawing operations at
  their existing synchronous point and order.
- Apply all reported consequences in `Game` through the existing named sound,
  screen, and persistence seams.

Prefer shared event types and one application path over parallel sound switches.
Preserve event ordering exactly; moving a seeded RNG draw across a branch is a
behavior change.

## Verify

- Assert `combat.ts`, `ordnance.ts`, and `station.ts` do not import `audio.ts`,
  `storage.ts`, or DOM screen renderers.
- Add equivalence tests for the ordered consequences of representative combat,
  missile/ECM/bomb, dock, and launch paths.
- `npm run lint && npm test && npm run build`
- `npm run campaign && npm run portability`
- Run feasible browser/playtest smoke checks; document anything requiring
  manual sound or visual verification.
- `git diff --check`
