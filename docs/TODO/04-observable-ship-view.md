# 04 — `ObservableShip` marshalling is written twice, and both copies cast

**Kind:** wrong interface · **Severity:** medium · **Size:** small

## What is wrong

How a ship is marshalled into `policy.ts`'s `ObservableShip` is implemented
twice: a private struct plus a field-by-field copy in `scenario.ts`, and a
second set of static structs plus copy in `npc.ts`. Both end in
`as ObservableShip` casts.

The cast is the interface admitting it is the wrong shape. `ObservableShip`
describes what the encoder reads; neither caller can build one without lying to
the compiler, which means the type is not doing the job it exists for.

## Evidence (read at `de9a668`)

- `src/ai-training/scenario.ts:784` `interface MutableView`, `:795`
  `function blankView()`, `:803` `function copyView(v, p, q)`, used at `:676`
  and `:684`, ending at `:686`:
  `observe(me as ObservableShip, t as ObservableShip, this.obs)`.
- `src/game/npc.ts:734-740` — the second copy, with a wider cast still:
  ```ts
  observe(me as ObservableShip, tv as ObservableShip, NpcShip.obsBuf)
  observePackWide(me as ObservableShip & { hp: number; cls: { hp: number } }, ...)
  ```
  That intersection cast is the type saying out loud that the pack-wide encoder
  reads two fields `ObservableShip` does not declare.

## The fix

Give `policy.ts` — the module that owns `ObservableShip` — both the mutable view
type and the writer:

```ts
export interface ShipView { /* the fields the encoders actually read */ }
export function writeView(v: ShipView, pos: THREE.Vector3, quat: THREE.Quaternion, ...): void
```

Then both callers fill one struct that needs no cast. While doing it, resolve the
`hp` / `cls.hp` question the intersection cast exposes: either those fields
belong on the observable type (because an encoder reads them) or `observePackWide`
should take them as separate arguments. Pick one; the cast is the third option
and it is the one to remove.

Keep the allocation behaviour: both sites reuse a struct per frame on purpose
(`NpcShip.obsBuf` is static, `scenario.ts` uses `blankView()` once). The new
writer must not allocate per call.

## Verify

- `npm run lint && npm test`
- The lint is a real gate here: the point of the change is that `as` disappears.
  `grep -rn "as ObservableShip" src/` should return nothing when done.
- Seeded equivalence on an episode, as in file 03 — the encoders must produce
  byte-identical observation vectors, or the shipped brains fly differently.

## Notes

Do file 03 first. `observeFor` and `writeView` are the same seam approached from
two sides, and landing them together means `policy.ts` ends up owning both "what
a brain observes" and "how a ship is presented to it", which is where they belong.
