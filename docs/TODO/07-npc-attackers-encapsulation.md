# 07 — `npc.attackers` is public with two external writers

**Kind:** leaky abstraction · **Severity:** medium · **Size:** small

## What is wrong

`attackers` is a public mutable array on `NpcShip`. Its invariant — "the ships
whose `npcTarget` is this ship" — is maintained in two *other* modules, while
`npc.ts` is the only module that reads it.

So the class exposes internal state and delegates its consistency to its callers,
and the list is derived data with two writers and a restore-time repair. That is
the shape a defect hides in: `world.ts:135-138` exists because a reload broke the
invariant once already.

## Evidence (read at `de9a668`)

- `src/game/npc.ts:244` — `readonly attackers: NpcShip[] = [];` (`readonly`
  binds the reference, not the contents).
- `src/game/npc.ts:646` — the only read:
  `return this.attackers.find((a) => a.alive) ?? null;`
- `src/game/npc-targeting.ts:58-61` — writer one, pruning:
  ```ts
  const live = npc.attackers.filter((a) => a.alive && a.npcTarget === npc);
  npc.attackers.length = 0;
  npc.attackers.push(...live);
  ```
- `src/game/npc-targeting.ts:70-71` — writer two, adding:
  `if (npc.npcTarget && !npc.npcTarget.attackers.includes(npc)) { ...push(npc) }`
- `src/game/world.ts:135-138` — the restore-time repair, with a comment recording
  that `attackers` drives `nearestAttacker()` and a reloaded fleeing ship turned
  passive without it.

## The fix

Two options; the first is better if it is affordable.

1. **Derive it.** `npcTarget` is the authority — `nearestAttacker()` can scan the
   fleet for `a.alive && a.npcTarget === this` instead of keeping a mirror. Then
   the field, both writers, and the restore repair all delete. Check the cost
   first: it is called per ship per frame, so it is O(n²) over the fleet — with
   the fleet sizes this game runs, that is likely nothing, but measure rather
   than assume.
2. **Encapsulate it.** Make the field private with `addAttacker(npc)` and
   `pruneAttackers()`, so the invariant is stated in the class that owns it and
   `npc-targeting.ts` calls verbs instead of splicing an array.

Either way `world.ts:135-138`'s repair should end up either deleted (option 1) or
a single call to the same verb the live path uses (option 2) — not a second
hand-rolled copy of the rule.

## Verify

- `npm run lint && npm test`
- The specific regression to re-test is the one `world.ts:135` documents: save
  while a pirate is attacking a fleeing trader, reload, and confirm the prey
  still flees. Use save slot 4 only (`SAVE_SLOTS`) and restore the pointer —
  never slots 1-3.
- Seeded equivalence on a fleet fight: same seed, identical outcome. Option 1
  changes *when* the list is computed, so if targeting order matters the result
  can shift; if it does, that is information worth knowing before committing.
