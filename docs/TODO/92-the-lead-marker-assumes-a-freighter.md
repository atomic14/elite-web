# 92 — The lead marker assumes every target is a freighter

**Kind:** combat bug / UI · **Severity:** medium · **Size:** small
**Depends on:** none · found by the docs/TODO/90 survey · **Chris decided this
on 2026-08-04**: use the real speed, then fly it

## Why

`hud-model.ts:204` builds the lead marker — the ring that says where to aim so a
shot arrives where the target will be:

```ts
const vel = scratch.set(0, 0, -1)
  .applyQuaternion(npc.object.quaternion)
  .multiplyScalar(ASSUMED_TARGET_SPEED);
```

`ASSUMED_TARGET_SPEED` is `hud-model.ts:218`, value **220**, comment "Assumed
target cruise". It is not a stale copy of a simulation constant — there is no
constant it is a copy of. 220 is the **armed trader Cobra Mk III**'s cruise
(`ship-specs.ts:218`). Every other 220 in the codebase is a different quantity:
`player.ts`'s `ACCEL` is an acceleration, `BREAK_OFF_RANGE` is a distance,
`CC_MAX_SPEED` is the autopilot's own cruise, and `effects.ts`'s is debris
speed.

So the HUD leads **every** locked ship as though it were a freighter. What a
player actually locks, from the roster:

| ship | speed | the marker is out by |
| --- | --- | --- |
| pirate Cobra Mk III | 260 | −15% |
| Moray | 280 | −21% |
| Krait, Gecko | 290 | −24% |
| Sidewinder, Thargoid | 300 | −27% |
| Mamba | 310 | −29% |
| Viper | 320 | −31% |
| Fer-de-Lance | 330 | **−33%** |
| Thargon | 350 | −37% |
| Constrictor | 370 | −41% |

Only the armed trader is led correctly, and it is the one thing in the sky that
mostly is not shooting back.

**The real number is already in scope at the call site.** `npc.state.speed` is
public (`npc.ts:229`) and its doc says why it exists: *"The brain's observation
needs it to lead a shot."* And `npc.ts:1306` already has the identical
expression as a named helper:

```ts
velocityOf(quat, speed)   // set(0,0,-1).applyQuaternion(quat).multiplyScalar(speed)
```

The HUD open-codes that helper and substitutes a constant for the argument.

## What is NOT the problem

- **Not `BOLT_SPEED = 8000`.** The notional bolt speed is a separate
  approximation (real shots are instant raycasts) and it is not what this item
  is about.
- **Not the aim assist.** `AIM_ASSIST` widens the hit cone at knife range and
  fades to nothing by 2,400 units, so it masks the error exactly where the error
  is smallest and does nothing where it is worst.
- **Not a reason to distrust the marker's geometry.** The lead calculation is
  right; one of its inputs is a guess.

## What to work out

- **Use `npc.state.speed`**, via `velocityOf` rather than a second copy of the
  expression — that is the one-rule-one-home half of this.
- **Decide what a stationary target does.** At speed 0 the lead collapses onto
  the hull, which is correct and may look like the marker has broken. Chris
  considered and rejected keeping a floor, because a floor is a new constant
  that would itself need justifying — but check how it reads in a fight where a
  target has stopped, and if it is genuinely confusing, say so rather than
  quietly adding one back.
- **`ASSUMED_TARGET_SPEED` is then dead** and goes, along with its comment.

## Watch out for

- **This changes how aiming feels, and it is the one thing a player does
  constantly.** CLAUDE.md: prefer a fight a human flew to a bot-flown number,
  and fly it before tuning it. A measured "the marker is now correct" is not the
  acceptance; Chris flying it is.
- **It will make fast ships harder to hit, not easier**, at first. The marker
  has been under-leading for as long as anyone has played, so muscle memory is
  calibrated to compensate. Expect the first session to feel worse.
- **It moves a seeded outcome only if a test asserts the marker.** Check
  `test/hud.test.ts` and re-baseline deliberately.
- **`hud-model.ts` is a pure module on the portability side** — read
  `npc.state.speed` off the ship it is already handed; do not reach for a new
  import.

## Acceptance

- The lead marker uses the target's real speed, through `velocityOf`.
- `ASSUMED_TARGET_SPEED` no longer exists.
- A test that a fast ship and a slow ship at the same bearing produce different
  lead points — and that it fails if the speed is pinned to a constant again.
- **Flown by Chris**, in a real fight, against something fast.

## Verify

```sh
grep -n "ASSUMED_TARGET_SPEED" src/hud/hud-model.ts
# 218: const ASSUMED_TARGET_SPEED = 220;   ← and 204 is the only use
grep -n "maxSpeed" src/game/ship-specs.ts | head -40
# the roster: nothing a player fights cruises at 220 except the armed trader
```
