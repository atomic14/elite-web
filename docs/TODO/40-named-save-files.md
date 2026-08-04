# 40 — Named saves you make, and autosaves you can fall back to

**Kind:** save model / UI · **Severity:** high · **Size:** large
**Depends on:** none

## Why

Saves are four numbered slots. A player picks a number and has to remember
what is in it, and every write — deliberate or automatic — goes to the same
key. So the autosave and the save you meant to keep are the same thing, and
losing one to the other takes twenty seconds of a tab left running.

That is not hypothetical. During this session an agent switched the slot
pointer with a game still running; the next autosave wrote a scratch commander
over the real one in slot 1, and there was nothing to restore from. CLAUDE.md's
"never write save slots 1-3" is a warning sign in front of that hole. This
item fills it.

## The model (Chris's, decided — implement this)

- **Saving is a deliberate act.** `S` prompts for a name, defaulting to the
  commander's name. Choosing a name that already exists **overwrites it**.
- **Autosaves happen on their own**: when you dock, and as you play. They are
  kept as a set, not one, so a routine autosave cannot bury the useful one.
- **Loading offers both**: your named saves, and the autosaves.

Because a repeated name overwrites, **the name IS the identity of a manual
save** — there is no rename, no duplicate, and no hidden id. An earlier draft
of this spec argued for a generated id precisely so that names could collide;
that is not the model, and the simpler one wins.

## This changes a stated invariant

docs/INVARIANTS.md invariant 3 says the `elite-web-*` keys are NEVER renamed, because
they are where every existing player's commander lives. The rule is right
about the risk and this item does not get to wave it away: the deliverable is
the new scheme PLUS a migration that cannot lose a save, and invariant 3 is
rewritten to describe the new scheme and the same protection. If the migration
cannot be made safe, keep the keys and stop.

`storage.ts` remains the only file that may touch localStorage.

## Three more of Chris's decisions (also decided — implement these)

1. **The docked autosave is written on docking AND immediately before
   launch.** Those two moments are the checkpoint, and the pre-launch one is
   what makes the death rule below work: it is by construction the state you
   left the station in.
2. **In-flight autosaves never overwrite the docked one.** They are their own
   thing. A quiet three minutes of flying must not evict the station you came
   from.
3. **Death offers a load**, and must at minimum get the player back to the
   last station before they launched — i.e. the pre-launch docked autosave.
   Offer the in-flight autosaves too if the list reads clearly; the docked one
   is the guarantee.
4. **Saving under an existing name asks first.** The default name is the
   commander's, so for a second career the default action would otherwise be
   to overwrite the first.

## What still needs settling — decide, and write the reason down

- **How many in-flight autosaves, and per what.** A ring of a stated size. Per
  commander or global? Global silently belongs to whoever flew last, which is
  wrong the moment a player keeps two careers. Say which and why. The docked
  autosave is separate from this ring by decision 2.
- **What a save looks like in the list.** A player choosing "one of the
  autosaves" needs to tell them apart at a glance: when, where (system, and
  docked or in flight), credits, rating. Decide the line, and make it the same
  shape for manual saves so the two lists read alike. The docked autosave
  should be obviously the safe one.
- **Manual save while flying.** A named save taken in flight has to carry the
  world, or loading it puts you somewhere you never were. Decide whether `S`
  is available in flight at all, and if so that a named save carries both
  halves the way an autosave does.

## What to work out

- **Key scheme.** Names go in the key, encoded so any name is safe and
  reversible, with a stated length limit. Autosaves get their own reserved
  prefix that a manual save cannot collide with whatever the player types.
- **Enumeration.** How the list is built. If it scans the `elite-web-` prefix,
  own that cost; if there is an index record, say what happens when it
  disagrees with what actually exists. The disagreement case is the one that
  bites.
- **Capacity.** A snapshot is about 9.7 kB (measured at TODO 30) against a few
  megabytes of localStorage, so hundreds fit. Decide whether manual saves are
  capped and what the UI does when a write fails — silently dropping the
  oldest is the wrong answer, and a quota error mid-write must not corrupt an
  existing save.
- **The reserved harness save.** CLAUDE.md's slot-4 rule becomes a reserved
  name a player cannot type and a harness cannot escape. Make it structurally
  impossible for a test or an agent to write a player's save, rather than a
  rule somebody has to remember. This is the part with direct evidence behind
  it.
- **Export and import.** `X EXPORT` / `Z IMPORT` already exist; an exported
  file should carry its name, and an import must not silently land on top of
  an existing save.
- **The screen.** `screens/saves.ts` owns the list and already pushes a name
  entry screen — that is where the save prompt belongs. It stays behind the
  Screen contract (invariant 13) with one input surface.

## Migration

- Every existing slot 1-4 becomes a named save keeping its commander AND its
  world, named from the commander, disambiguated when they collide — and they
  will, because they are all JAMESON.
- A player who has never seen this build loses nothing, including a world
  snapshot taken mid-flight.
- Migration runs once and is idempotent: twice must not duplicate a save, and
  a half-migrated store must be recoverable.
- Decide whether the old keys are deleted or kept as a fallback, and say why.
  Keeping them is cheap insurance; keeping them forever is a second home for
  the same data.

## Acceptance

- `S` prompts for a name, defaults to the commander's, and saving under an
  existing name asks before replacing it.
- The docked autosave is written on docking and immediately before launch, and
  in-flight autosaves cannot overwrite it.
- Autosaves can never overwrite a named save.
- The load list shows named saves and autosaves, each identifiable at a glance.
- Dying offers a load, and the pre-launch docked autosave is always among the
  options — a test flies out of a station, dies, and proves the offered save
  puts the commander back at that station with what they left with.
- Every pre-existing slot survives with its commander and its world; a test
  loads a fixture of the old key shape and proves it.
- Migration is idempotent and a half-written store recovers.
- A harness cannot write a player's save — structurally, not by convention.
- A failed write (quota) leaves every existing save intact.
- `storage.ts` is still the only file touching localStorage, and CLAUDE.md
  invariant 3 is rewritten.

## Verify

`npm run check`, plus a fixture test for the old key shape, an idempotency
test, a crash-midway test, a quota-failure test, and a browser pass that
saves under a new name, overwrites an existing one (confirming), flies, docks,
launches, dies, and takes the offered way back to the station.
