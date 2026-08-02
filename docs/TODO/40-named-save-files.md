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

CLAUDE.md invariant 3 says the `elite-web-*` keys are NEVER renamed, because
they are where every existing player's commander lives. The rule is right
about the risk and this item does not get to wave it away: the deliverable is
the new scheme PLUS a migration that cannot lose a save, and invariant 3 is
rewritten to describe the new scheme and the same protection. If the migration
cannot be made safe, keep the keys and stop.

`storage.ts` remains the only file that may touch localStorage.

## What still needs settling — decide, and write the reason down

1. **How many autosaves, and per what.** A ring of a stated size. Per
   commander or global? Global silently belongs to whoever flew last, which is
   wrong the moment a player keeps two careers. Say which and why.
2. **Do not let routine autosaves flush the useful one.** Docking is a
   checkpoint; a periodic in-flight save is not. If both go in one ring, three
   quiet minutes of flying evicts the checkpoint you actually wanted. Either
   keep the newest docking autosave outside the ring, or tag entries and evict
   within a kind. State the rule.
3. **What a save looks like in the list.** A player choosing "one of the
   autosaves" needs to tell them apart at a glance: when, where (system, and
   docked or in flight), credits, rating. Decide the line, and make it the
   same shape for manual saves so the two lists read alike.
4. **Death.** This is a game-design decision, not a storage one, and it wants
   Chris's answer rather than an implementer's. Elite's tension comes from
   death costing you the run. If the death screen offers "load an autosave",
   dying becomes an inconvenience. Options: offer it (a modern kindness),
   refuse it and let autosaves cover crashes and closed tabs only, or offer it
   and take something for it. **Do not decide this silently — ask.**
5. **Manual save while flying.** A named save taken in flight has to carry the
   world, or loading it puts you somewhere you never were. Decide whether `S`
   is available in flight at all, and if so that a named save carries both
   halves the way an autosave does.
6. **Overwrite confirmation.** The default name is the commander's, so the
   default action for a second career is to overwrite the first. A one-key
   confirmation on an existing name is cheap; say whether you added it.

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
  existing name replaces it.
- Autosaves are taken on docking and during play, are kept as a set, and can
  never overwrite a named save.
- The load list shows named saves and autosaves, each identifiable at a glance.
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
saves under a new name, overwrites an existing one, flies, docks, and loads
back from both a named save and an autosave.
