# Invariants

Rules that must hold. **The numbers are load-bearing** — around 120 places in the
repo cite them by number, so never renumber; append.

Most are enforced by `npm test`. Where they are, the test is the real home and
this line is an index — read the test for the detail. `CLAUDE.md` is how we work;
this is what must not break. Why any of them exists is `docs/TODO/` and the git
log.

1. **The name.** "Elite" is a live Frontier trademark and is never this project's
   NAME — not in titles, H1s, Open Graph, JSON-LD or the domain. Using it in
   prose to say what this is a tribute to is nominative use and is the point. The
   in-game combat rank stays: it describes gameplay, not the product.

2. **Link to pages without `.html`.** Clean URLs are served and `.html` redirects,
   so a canonical or sitemap entry ending in `.html` points at a redirect.

3. **A save is one key, and a harness cannot address one.** `storage.ts` is the
   only file that may keep a save in localStorage. An autosave cannot overwrite a
   named save because it cannot address one — the name alphabet has no separator.
   One record, one write, so a save either lands or does not.
   **`useHarnessSaves()` is one-way**: it moves the namespace for the life of the
   process and nothing puts it back. Call it before any console or harness work
   that flies the game. A commander was lost learning this.

4. **Galaxy fidelity.** `galaxy.ts` is byte-matched to the 1984 algorithm. Never
   "fix" its maths.

5. **One combat model.** Training episodes are built from the game's own combat
   modules, not copies of them. A change to a combat number therefore changes the
   game and the training world together — nothing desyncs, but it **invalidates
   the brains**. Retrain deliberately.

6. **No `logarithmicDepthBuffer`** on the renderer: it disables polygonOffset,
   which is what keeps black hull fills behind wireframe edges.

7. **Ship defs use +Z nose** and are rotated, never mirrored. Mirroring is the
   same picture for a symmetric hull and a different ship for an asymmetric one,
   and released designs are asymmetric.

8. **Money is integer tenths of a credit; fuel is tenths of a light year.**

9. **A key binding has one home, and the surfaces that list it are rendered.**
   A command and the line describing it are welded by the type system, so an
   undocumented command does not compile. No surface holds its own copy of a key.

10. **Economic rules live outside `game.ts`** — in the modules the headless
    campaign also runs, so the campaign exercises the same code the game does.

11. **`Math.random` is banned in world code.** One seeded source of chance, or
    reproducibility is gone.

12. **No global variables.** If game code branches on it, it is a field of game
    state — that is what makes it saveable, testable as an argument, and
    impossible to leave set by accident. Debug **handles** are the one exception
    and are not variables: the game writes them, nothing reads them, nothing
    branches on them, and one file owns them.

13. **A screen owns its rendering, its keys and its state in one file**, behind a
    small interface. It never sets the mode and never touches the game; it
    returns an outcome. The mode is derived and has no other writer. **Clicks are
    input** — they become keystrokes and row selections — so a screen has one
    input surface rather than a click path that drifts from the key path.

14. **The menu cursor runs before the top screen**, and reading input consumes
    it. Safe only because it touches almost nothing. Don't widen it.

15. **NPCs report; the game resolves.** An NPC returns an event and never has a
    side effect. There are two orchestrators — the game and the trainer — and
    **one resolver** they both call for what a shot costs, plus one home for
    which shield takes it. A tracer is presentation; the shield face is a rule.
    Adding a consequence to a shot means the resolver or nowhere.
