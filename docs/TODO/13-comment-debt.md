# 13 — Orphaned doc comments in `npc.ts` and `hud.ts`

**Kind:** comment debt · **Severity:** low, but actively misleading · **Size:**
small

## What is wrong

The state migration left doc comments attached to whatever declaration happened to
follow them, and one collapsed a commented-out field declaration onto a single
line. `NpcShip`'s field block now misdescribes itself: a reader cannot tell which
fields exist.

Comments that describe a field that moved are worse than no comments — they are a
confident wrong answer. This is cheap to fix and makes files 07 and 08 (both in
`npc.ts`) easier to do correctly.

## Evidence (read at `de9a668`)

`src/game/npc.ts`:

- `:235-238` — "Set when the player damages this ship", "hit by anything at all"
  and "True when it was specifically the player who attacked us" sit immediately
  above `readonly armed: boolean`, which is none of those things.
- `:239-243` and `:248-267` — further stranded comments with no declarations.
- `:287` — one line reading
  `// trained-brain flight state (pirates)  private brainControl: {...} | null = null;  /** @internal snapshot */`
  i.e. a whole field declaration collapsed into dead code.
- `:155` — "scratch for the docking gate" documents nothing.

`src/hud/hud.ts`:

- `:257-275` — three stacked doc comments before one private method: "Docking
  alignment aid: the slot aperture as a rectangle… your lateral offset as a dot"
  and "Point at the docking slot" both precede
  `private drawEdgeArrow(...)`, which draws neither. The surviving third block is
  accurate; the other two describe a removed overlay.
- `:55-61` — an abandoned one-line `dockAid` comment immediately above the real
  one.

## The fix

- `npc.ts`: move each comment that still describes something onto the `NpcState`
  field it belongs to, and delete the rest. Delete the collapsed dead line at
  `:287` — check first, via git history, whether `brainControl` still exists
  somewhere under another name; if it does, the comment goes there.
- `hud.ts`: delete the two superseded blocks at `:257-275` and the abandoned
  `dockAid` one-liner at `:55`.

Read each comment against the code before deleting it. The risk in this fix is
deleting a comment that is the only record of a reason — if a comment explains
*why* rather than *what*, it belongs somewhere, so find where.

## Verify

- `npm run lint && npm test` — nothing should change behaviourally; if a test
  fails, something that looked like a comment was not one.
- `git diff` should be comments only. Any code line in the diff other than the
  dead `:287` line means the change went further than intended.
