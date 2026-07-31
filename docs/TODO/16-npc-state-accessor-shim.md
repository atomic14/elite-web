# 16 — Remove `NpcShip`'s duplicate state access paths

**Kind:** pass-through · **Severity:** medium · **Size:** medium

## What is wrong

`NpcShip` exposes its canonical mutable `NpcState` as `readonly state`, then
also exposes roughly 25 getter/setter pairs that forward one field at a time to
that same object. Callers can therefore write either `npc.hp` or
`npc.state.hp`, with no invariant or validation distinguishing the two paths.

This is the same pass-through distortion removed from `Game` in TODO 11. It is
also why the architecture review counts 85 public members on `npc.ts` even
though the behaviour class itself is cohesive.

## Evidence

- `src/game/npc.ts` declares `readonly state: NpcState`.
- The block immediately below forwards `hp`, `alive`, `provoked`, missiles,
  mission/fleeing/docking flags, timers, brain rates, vectors, and trader phase
  directly into `state`.
- The accessors add no checks, derivation, events, or coordination.
- Snapshot code relies on `NpcState` as the complete serialisable mutable state,
  so keeping two public spellings does not provide a persistence boundary.

## The fix

Choose one public access path and migrate callers to it:

- Prefer `npc.state.<field>` when the caller is explicitly reading or mutating
  serialisable state.
- Keep a named method only when a write has a real invariant or consequence;
  that method should express the operation rather than mirror a field.
- Keep render identity and immutable hull data (`object`, `role`, `radius`,
  `maxHp`, and similar) on `NpcShip`.
- Preserve private convenience accessors only where they materially clarify
  behaviour code; private members do not create a second public API.

Do not mechanically move every property into `state`: first distinguish
identity, derived values, and operations from mutable snapshot data.

## Verify

- Search production, tests, and JavaScript harnesses for every removed accessor;
  the untyped harnesses will not be protected by TypeScript.
- `npm run lint && npm test && npm run sizes`
- Run the playtest and training smoke tests that construct or inspect NPCs.
- Re-run the architecture analysis; the `npc.ts` shallow-module finding should
  disappear or materially improve for the right reason.
