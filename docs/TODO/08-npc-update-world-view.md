# 08 — `NpcShip.update` takes a world fact it has to remember

**Kind:** leaky abstraction / sticky parameter · **Severity:** medium ·
**Size:** medium

## What is wrong

`update` takes seven parameters, three of them defaulted, and one of them —
`stationDockZ` — is a world fact stashed into a private field *only when
present*. So the ship's behaviour depends on whether some earlier caller happened
to pass it, and the fallback constant is wrong for one of the two station types.

The comment on that constant records the bug this already caused.

Every real caller passes it every frame anyway, which is the giveaway: the
optionality buys nothing and costs a remembered value.

## Evidence (read at `de9a668`)

- `src/game/npc.ts:475-484`:
  ```ts
  update(
    dt: number,
    player: PlayerRef,
    playerLegal: number,
    station: THREE.Object3D,
    fleet: readonly NpcShip[] = [],
    stationDockZ?: number,
    brains: BrainSelection = SHIPPED_BRAINS,
  ): FireEvent | null {
    if (stationDockZ !== undefined) this.stationDockZ = stationDockZ;
  ```
- `src/game/npc.ts:163` — `const DOCK_Z = 160;` whose own comment records that
  this was wrong for Dodo stations (135).
- `src/game/npc.ts:256` — `private stationDockZ = DOCK_Z;`
- `src/game/world-step.ts:280` — the caller, passing it every frame for every
  ship: `world.station, world.npcs, world.stationDockZ, s.brains`.
  The same `world.stationDockZ` is threaded through four other call sites
  (`world-step.ts:256`, `:319`, `:534`).

## The fix

Replace the tail parameters with one struct:

```ts
update(dt: number, player: PlayerRef, view: WorldView): FireEvent | null
```

where `WorldView` names `{ station, dockZ, fleet, playerLegal, brains }`. Then the
slot depth is always present and never remembered, and the private
`stationDockZ` field plus `DOCK_Z` fallback both delete.

Check whether `WorldView` should be defined once and reused — `world-step.ts`
already threads the same four facts to several callees (`:256`, `:319`, `:534`),
so a shared view type may simplify more than this one signature. Do not go
further than the call sites justify.

Note the field is currently part of the ship's state. Confirm whether
`stationDockZ` appears in `NpcState` and therefore in the snapshot — if it does,
removing it is a save-format change and the snapshot test will tell you.

## Verify

- `npm run lint && npm test` — the snapshot test asserts every `GameState` field
  appears by name in capture and restore; if `stationDockZ` was persisted, that
  test is the one to satisfy.
- The specific behaviour to check is the one `DOCK_Z`'s comment names: NPCs
  docking at a **Dodo** station (dock depth 135, not 160). Fly to one and watch a
  trader dock.
- Seeded equivalence on a docking approach.
