// ONE HOME FOR EVERY CONSTANT — the gate that makes docs/TODO/90 stick.
//
// The move is a one-off tidy without this. `MAX_TRADERS` grew a second home in
// `encounters.ts` and `population.ts` and nothing noticed for months, and the
// only reason anybody knows is that a human read both files. A scan is the only
// thing that can notice.
//
// WHAT IT ENFORCES
//
//   1. Every module-level `UPPER_CASE` const declared in `src/` outside
//      `src/constants/` is named on THE LIST below. The list is the project
//      plan: one group per slice, shrinking as each subject moves. When a group
//      empties, its heading goes with it.
//   2. Nothing on the list is stale. A file that has lost its constants — or a
//      name that has — has to come off, or the list becomes a place to hide.
//   3. `src/constants/` imports nothing outside `src/constants/`. It is a leaf
//      and four modules plus the portability gate depend on that.
//   4. No name is declared twice inside `src/constants/`, and no name declared
//      there is declared anywhere else in `src/`. That is "one home", checked
//      rather than intended, and it is the check `MAX_TRADERS` would have
//      failed.
//
// HOW IT LOOKS, AND WHY NOT THE OBVIOUS GREP
//
// docs/TODO/90 shipped with a census grep that only matched a right-hand side
// beginning with an UPPER_CASE identifier. It therefore missed every derived
// constant wrapped in a call, a paren or a digit — `Math.round(MAX_ENERGY / 4)`,
// `(EXTEND_RANGE_MIN + EXTEND_RANGE_MAX) / 2`,
// `playerHull(...).energyRechargeRating` — and the
// item concluded from it that the codebase had exactly ONE derived constant when
// it has at least twenty. So this scan looks at the LEFT of the `=` and never at
// the right: a declaration is a declaration whatever it is initialised from.
//
// Two deliberate narrowings, both of them the item's own exclusions:
//
//   * COLUMN ZERO ONLY. An indented `const` is inside a function, and "values
//     whose only meaning is local to one function" are out of scope.
//   * COMMENTS STRIPPED. This project's prose names the things it deleted, on
//     purpose, and a scan that read the comments would fire on that history.
//
// `src/` only. `train/` and `tools/` are outside the home by decision, not by
// omission: the survey's answer is that `train/` should CONSUME src/constants/
// and keep its own search hyperparameters, seed bases and probe thresholds in a
// `train/constants.ts` that nothing in `src/` may import, and that `tools/` is a
// separate world. Neither is a game rule's home, so neither is gated here.
//
// Modelled on `test/ai.test.ts`'s purity list and `tools/sizes.mjs`: a policy
// enforced by scanning source, with an allowlist that is itself the review
// surface. Both of those have held.

import { readdirSync, readFileSync } from 'node:fs';
import { check } from './harness.ts';

/** Whole-file entry: every constant in it is still waiting for its slice. */
const ALL = '*' as const;

/**
 * THE LIST — everything still outside `src/constants/`, grouped by the slice
 * that will take it.
 *
 * Read this as the plan for docs/TODO/90 and not as a set of exemptions. A
 * group heading says what the subject IS, because that is also the argument for
 * what the constants file will be called; if naming a group needs an "and", it
 * is two slices.
 *
 * Three of the entries are not pending at all and say so in their heading. That
 * distinction matters: an exclusion the item has already decided (data tables,
 * a resolved object, a shader) is a finished answer, and burying it among the
 * pending work would leave the next reader re-deciding it.
 */
interface Group {
  /** what the subject IS, which is also the argument for the file it becomes. */
  readonly why: string;
  readonly files: Record<string, typeof ALL | readonly string[]>;
}

const OUTSIDE: readonly Group[] = [
  // --- MOVED, apart from a stated exception ---------------------------------

  {
    why: 'resolved once at load, not a rule — a catalogue lookup, and moving it would'
      + ' put a `requireShipDef` call inside a directory that may not import',
    files: {
      'game/ordnance.ts': ['MISSILE_HULL'],
    },
  },

  {
    why: 'per-module three.js vectors — scratch buffers and the fixed axes a rotation is'
      + ' taken about — hoisted so a per-frame path allocates nothing. docs/TODO/90'
      + ' rules them out by name: a THREE.Vector3 is MUTABLE, so a shared home would'
      + ' be a bug rather than a fix',
    files: {
      'game/npc.ts': ['ZERO', 'UP'],
      'player.ts': ['AXIS_X', 'AXIS_Z'],
      'game/world-step.ts': ['ZERO'],
      'game/game.ts': ['ZERO', 'UP'],
      'game/combat-sim.ts': ['ZERO', 'UP'],
    },
  },

  {
    why: 'STAYS: four `THREE.Quaternion`s, one per cockpit window, built from the four'
      + ' yaw angles that DEFINE front/rear/left/right. The home may not import three,'
      + ' so the only part of this that could move is the angle list — which would'
      + ' split one table across two files to buy nothing, since the angles have no'
      + ' second home and are not a tuning choice. The reasoning is beside it',
    files: {
      'game/views.ts': ['VIEW_QUATS'],
    },
  },

  {
    why: 'STAYS, with one exception: the roster is hull DATA — which designs fly which'
      + ' role, and how each is presented — and `KEY_SEP` and the lookup map are how it'
      + ' is indexed. docs/TODO/90 rules the tables out by name. The exception is'
      + ' `WORLD_SPEED_PER_SOURCE_SPEED`, a real derivation that is blocked: its other'
      + ' half is a released hull, which means the Elite-A catalogue and six generated'
      + ' tables, and this directory may not import. See docs/TODO/90-constants-cleanup.md',
    files: {
      'game/ship-specs.ts': [
        'SOURCE_DESIGN', 'ASTEROID_IDENTITY', 'WORLD_SPEED_PER_SOURCE_SPEED', 'SPECS',
        'PIRATE_TIERS', 'CONSTRICTOR_SPEC', 'KEY_SEP', 'BY_ROLE_AND_DESIGN',
      ],
    },
  },

  {
    why: 'STAYS: the source\'s own blueprint-slot numbering and the two maps over it. The'
      + ' slot bands are DATA transcribed from the released sets, and `BAND_SLOTS` is'
      + ' deliberately PRIVATE — the file\'s header argues that nothing outside it should'
      + ' hold a copy of "17 to 24 means pirate", and moving it to a public home would'
      + ' undo that. The other three are keyed on `NpcRole`, a type this directory may'
      + ' not import, and two of them are catalogue lookups computed once at load rather'
      + ' than rules — the same shape as `MISSILE_HULL` above',
    files: {
      'game/ship-roles.ts': ['BAND_SLOTS', 'ROLE_BANDS', 'CANDIDATES', 'MISSION_TARGET_DESIGNS'],
    },
  },

  {
    why: 'STAYS: a `ReadonlySet<NpcRole>` — which roles are trying to hurt somebody, stated'
      + ' as a set rather than inferred from "has a laser". It is keyed on a type declared'
      + ' in `ship-roles.ts`, so bringing it here would need an import out of the'
      + ' directory, and spelling it as bare strings to avoid that would lose the check'
      + ' that every member is a real role',
    files: {
      'game/role-variants.ts': ['COMBAT_ROLES'],
    },
  },

  {
    why: 'MOVED, apart from one BLOCKED derivation: the pools are constants/pools.ts, how'
      + ' they come back is constants/recharge.ts, the sun and the cabin are'
      + ' constants/sun.ts and what a breach costs is constants/hull-breach.ts. The'
      + ' recharge ANCHOR cannot follow — it is a released hull\'s rating, read through'
      + ' ship-identity.ts and the Elite-A catalogue, and this directory may not import.'
      + ' Same shape as `WORLD_SPEED_PER_SOURCE_SPEED`; see docs/TODO/90-constants-cleanup.md',
    files: {
      'game/systems.ts': ['ANCHOR_RECHARGE_RATING'],
    },
  },

  {
    why: 'STAYS: the pack\'s own design ids and catalogue lookups, not tunable rules.'
      + ' `NON_REGENERATING_DESIGNS` and `COBRA_MK_3_DESIGN` are design ids — the DATA'
      + ' the fidelity contract and the anchor are stated in, held to ship-specs\''
      + ' `SOURCE_DESIGN` and to registry.ts by tests — and `ANCHOR_NPC_MAX_ENERGY` is'
      + ' read through the Elite-A catalogue, which this directory may not import: the'
      + ' `ANCHOR_RECHARGE_RATING` shape exactly. `HARMLESS_POLICY` is keyed on'
      + ' `HARMLESS_OVERLAYS` profile ids and typed over `combat-math.ts`, so it cannot'
      + ' come without an import either; its two banks are measured catalogue figures'
      + ' (both released stations carry 240) stated as Harmless\'s own',
    files: {
      'game/npc-energy.ts': [
        'NON_REGENERATING_DESIGNS', 'COBRA_MK_3_DESIGN', 'ANCHOR_NPC_MAX_ENERGY',
        'HARMLESS_POLICY',
      ],
    },
  },

  {
    why: 'MOVED, apart from one: what a kill leaves behind is constants/wreck.ts and'
      + ' the spill lists are constants/commodities.ts. `BEAM_FLASH` is how long the'
      + ' cockpit beams stay LIT — a drawing duration read by two orchestrators and no'
      + ' rule, so it stays under the item\'s own is-it-the-game-or-how-it-looks test',
    files: {
      'game/combat.ts': ['BEAM_FLASH'],
    },
  },

  {
    why: 'STAYS: three parsed weights files and the name-to-weights table over them —'
      + ' resolved once at load from JSON the game ships, not rules, the same shape as'
      + ' `MISSILE_HULL` — and `LOADED` is keyed on `BrainName`, a type this directory'
      + ' may not import. The one tunable number the file held, the target-speed floor,'
      + ' is constants/brain-flight.ts now',
    files: {
      'game/brains.ts': ['LOADED'],
    },
  },

  {
    why: 'STAYS, all of it, per docs/TODO/90\'s own precedent: brain-names.ts is the'
      + ' import-nothing leaf the home is MODELLED on, and CLAUDE.md names it as where'
      + ' the scripted/trained rule lives. Nothing in it is a tunable game rule: the'
      + ' five `BrainName` constants are that rule\'s decisions stated as names, the'
      + ' five tables are keyed on `BrainName` — a type declared beside them that the'
      + ' home may not import — the two `AS_*` strings are picker sentinels, and'
      + ' `SHIPPED_BRAINS` is the frozen no-override default npm test asserts is empty.'
      + ' Moving any of it would split the one file the rule lives in across two homes',
    files: {
      'game/brain-names.ts': [
        'AS_SHIPPED', 'AS_THE_GAME_FLIES', 'BRAINS', 'SENTINEL_NAMES',
        'SHIPPED_DEFENCE', 'SHIPPED_BRAINS', 'SELECTIONS', 'LIVE_BRAIN_IDS',
      ],
    },
  },

  // --- pending slices --------------------------------------------------------

  {
    why: 'MOVED, apart from one BLOCKED derivation: the career\'s tuning went to eleven'
      + ' subject files (commander, law, contracts, market, hermit-market, jettison,'
      + ' missions, rating, shop, trumbles, living-galaxy, commodities, scoop), and'
      + ' commander.ts, contracts.ts, law.ts, jettison.ts, missions.ts, rating.ts,'
      + ' shop.ts and trumbles.ts declare nothing at all now. `COMMODITY_COUNT` is'
      + ' `COMMODITIES.length` — a derivation off the 1984 table, which is DATA the'
      + ' home may not import: the `ANCHOR_RECHARGE_RATING` shape exactly. See'
      + ' docs/TODO/90-constants-cleanup.md, Blocked',
    files: {
      'galaxy/living.ts': ['COMMODITY_COUNT'],
    },
  },

  {
    why: 'STAYS: the drifting-cargo field\'s own furniture, none of it a tunable rule.'
      + ' `CANISTER_HULL` is a memoised `requireShipDef` lookup and `POLICY` a pair of'
      + ' catalogue reads keyed on the canister kinds — both the `MISSILE_HULL` shape —'
      + ' and `SPIN_RATE` is how fast a canister LOOKS to tumble: nothing reads an'
      + ' object\'s orientation back, so it is drawing, like `BEAM_FLASH` below',
    files: {
      'game/cargo.ts': ['CANISTER_HULL', 'POLICY', 'SPIN_RATE'],
    },
  },

  {
    why: 'MOVED, apart from one derivation and one table: the slot and its cube are'
      + ' constants/docking.ts, the computer\'s hand is constants/docking-computer.ts and'
      + ' the station as a place is constants/station.ts. `STATION_PRESENTATION_SCALE`'
      + ' is an EXPRESSION now — `SOURCE_UNITS_PER_WORLD_UNIT`, the relationship its own'
      + ' comment always claimed — and cannot follow, because its meaning is a product'
      + ' over the ships\' geometry anchor, which this directory may not import: the'
      + ' `WORLD_SPEED_PER_SOURCE_SPEED` shape. `STATION_DESIGNS` is a pair of design'
      + ' ids resolved through `shipDesignIdOf` — the `MISSILE_HULL` shape',
    files: {
      'ships/station-hulls.ts': ['STATION_PRESENTATION_SCALE', 'STATION_DESIGNS'],
    },
  },

  {
    why: 'STAYS: not a number at all — the refusal noise as a ready-made'
      + ' `AutopilotEvent`, a union typed over `SoundEvent`, which this directory may'
      + ' not import. The one tunable the file held, the computer\'s range, is'
      + ' constants/docking-computer.ts now',
    files: {
      'game/autopilot.ts': ['REFUSED'],
    },
  },

  {
    why: 'STAYS: how the launch/docking tunnel effect LOOKS — the ellipse squash that'
      + ' reads as a bay mouth, and two fractions of the effect\'s own timeline. Pure'
      + ' drawing under the item\'s is-it-the-game-or-how-it-looks test: nothing outside'
      + ' the overlay canvas can observe any of them',
    files: {
      'hud/tunnel.ts': ['SQUASH', 'OPEN_AT', 'BAY_FADE_FROM'],
    },
  },

  {
    why: 'MOVED where a number is a rule about the game as well as how it looks —'
      + ' the scanner, the compass, the aim aid, the gauge warnings and the sight are'
      + ' constants/console.ts, the one camera and the pretend viewport are'
      + ' constants/camera.ts, the local chart\'s geometry joined'
      + ' constants/chart-metric.ts and the input carry joined the frame budget it was'
      + ' chosen against in constants/world-clock.ts. What stays is only drawing,'
      + ' prose, typed tables or music: the three phosphor colours (docs/TODO/93) and'
      + ' the painter\'s label tables; the briefing\'s pages and the count derived over'
      + ' them; the key tables docs/TODO/50 welded (`BINDINGS`, `COMMAND_HELP`,'
      + ' `ALL_BINDINGS`, `LABELS`, the layouts and the keymap\'s own storage key —'
      + ' invariant 3\'s one carve-out); the import screen\'s three refusal lines; the'
      + ' inert painter\'s DOM plumbing; the cockpit beams\' convergence depth; the'
      + ' Blue Danube; and the manual\'s prose rows',
    files: {
      'hud/hud.ts': [
        'GREEN', 'DIM', 'AMBER', 'CONTACT_COLORS', 'VIEW_NAMES', 'SCORE_LABELS',
      ],
      'ui/screens.ts': ['BRIEFING', 'BRIEFING_PAGES'],
      'ui/key-help.ts': ['LABELS', 'ALL_BINDINGS'],
      'game/command-help.ts': ['COMMAND_HELP'],
      'game/controls.ts': [
        'GLOBAL_BINDINGS', 'FLIGHT_BINDINGS', 'NOT_IN_THE_SIMULATOR', 'BINDINGS',
      ],
      'game/screens/save-transfer.ts': ['NOT_A_SAVE', 'WRONG_VERSION', 'STORE_FULL'],
      'engine/keymap.ts': ['LAYOUTS', 'STORAGE_KEY'],
      'engine/inert-dom.ts': ['STYLE_METHODS'],
      'engine/render-stack.ts': ['BEAM_Z'],
      'audio.ts': ['NOTE', 'BLUE_DANUBE', 'BASS'],
      'manual.ts': ['FLIGHT'],
    },
  },

  {
    why: 'MOVED, apart from what is typed, versioned or prose: the record\'s rules are'
      + ' constants/combat-record.ts, the exercise\'s opening and clocks are'
      + ' constants/exercise.ts, the wave ramp\'s rates are constants/waves.ts and the'
      + ' tier ladder\'s top is constants/threat.ts. What stays: `COMBAT_SIM_SCHEMA` is'
      + ' a format version welded to its record; `CADENCE_EPSILON` is float slack, not'
      + ' a rule; `UNKNOWN`/`SOURCES` are a bucket label and its closed list;'
      + ' `ARENA_RADII` is the decided same-number-different-rule exception'
      + ' (docs/TODO/90-constants-cleanup.md); `AHEAD`/`OPENINGS`/`CUSTOM_OPENING`/'
      + '`NO_OPENING` are tables keyed on `ScenarioId` and `DEG` is a unit conversion;'
      + ' the scenario file\'s remainder is typed tables (`SCENARIOS`, `WAVE_STEPS`,'
      + ' `MODES`, `OPPOSITION_ROLES`, `SIM_BRAINS`), brain-name reads, a derivation'
      + ' over a table (`WAVE_SATURATION`) and the custom picker\'s private seed'
      + ' stride; the notes are prose; the setup rows are typed lists',
    files: {
      'game/combat-sim-compare.ts': ['IDENTITY', 'PER_OPPONENT', 'GROUPS'],
      'game/combat-sim-opening.ts': [
        'ARENA_RADII', 'AHEAD', 'OPENINGS', 'CUSTOM_OPENING', 'NO_OPENING', 'DEG',
      ],
      'game/combat-sim-report.ts': [
        'COMBAT_SIM_SCHEMA', 'CADENCE_EPSILON', 'UNKNOWN', 'SOURCES',
      ],
      'game/combat-sim-scenarios.ts': [
        'OPPOSITION_ROLES', 'SHIPPED_SOLO_BRAIN', 'SHIPPED_PACK_BRAIN',
        'SHIPPED_DEFENCE_BRAIN', 'SIM_BRAINS', 'SHIP_SEED_STRIDE', 'SCENARIOS',
        'WAVE_STEPS', 'WAVE_SATURATION', 'MODES',
      ],
      'game/screens/combat-sim-notes.ts': [
        'MODE_BLURB',
      ],
      'game/screens/combat-sim-setup.ts': ['MODES', 'TIERS', 'LASERS', 'PIRATE_CHOICES'],
    },
  },

  {
    why: 'STAYS: the combat viewer and the gallery are development pages, and their'
      + ' constants are catalogue reads (`COBRA_MK3`, `SIDEWINDER`), brain-name reads'
      + ' (`SOLO`, `GANG`, `DEFENCE`), a scenario table, typed mode lists'
      + ' (`SCALES`, `VIEWS`) and pure drawing — grid geometry, three colours (one of'
      + ' them the phosphor, which docs/TODO/93 owns) and two fixed axes',
    files: {
      'viewer/main.ts': ['COBRA_MK3', 'SIDEWINDER', 'DEFENCE', 'SCENARIOS'],
      'viewer/gallery.ts': [
        'COLUMNS', 'CELL', 'HULL_COLOUR', 'RADIUS_COLOUR', 'LABEL_COLOUR',
        'UP', 'RIGHT', 'GRID_CENTRE',
      ],
      'viewer/gallery-main.ts': ['SCALES', 'VIEWS'],
    },
  },

  {
    why: 'MOVED, apart from what is welded in place: the cadence, the ring, the name'
      + ' ceiling and the named-save cap are constants/saves.ts. `SAVE_RECORD_VERSION`'
      + ' and `SNAPSHOT_VERSION` stay beside the interfaces they version — a version'
      + ' bumped in a different file from the shape it describes is a divergence'
      + ' waiting to happen — and `SAVE_ID_PREFIX` stays with the id grammar it opens,'
      + ' whose parse side restates it inside three regexes that'
      + ' `test/saves.test.ts`\'s round trips hold together',
    files: {
      'game/save-file.ts': ['SAVE_RECORD_VERSION', 'SAVE_ID_PREFIX'],
      'game/snapshot.ts': ['SNAPSHOT_VERSION'],
    },
  },

  {
    why: 'STAYS, on the file\'s own security argument: the two namespaces and the boot'
      + ' key are halves of STORAGE KEYS, built from module-private mutable `ns` so'
      + ' that after `useHarnessSaves()` nothing on the page can compute a player\'s'
      + ' key. Moving them into a directory everything imports would break that'
      + ' structurally, not stylistically. `NEW_COMMANDER` is the boot pointer\'s own'
      + ' encoding, spent entirely within the file',
    files: {
      'game/storage.ts': ['PLAYER_NS', 'HARNESS_NS', 'BOOT_KEY', 'NEW_COMMANDER'],
    },
  },

  {
    why: 'STAYS, whole, on the brain-names.ts precedent: policy.ts IS "what shape a'
      + ' genome is" — the four observation widths, the hidden width and the two head'
      + ' counts are the policy format\'s own dimensions, welded to the network the'
      + ' file defines and to observation.ts\'s encoder choice (`observeFor` picks the'
      + ' encoder BY the input count). Moving them would split one format across two'
      + ' homes; every shipped weights file is fitted at exactly these numbers. The'
      + ' fitted-world constants that ARE tunable-shaped (`OBS_SPEED_SCALE`,'
      + ' `TARGET_SPEED_FLOOR`, the ramp) live in constants/brain-flight.ts',
    files: {
      'ai-training/policy.ts': [
        'OBS_SIZE', 'DEFEND_OBS_SIZE', 'PACK_OBS_SIZE', 'PACK_WIDE_OBS_SIZE',
        'HIDDEN', 'DEFEND_HIDDEN', 'OUT_SIZE', 'DEFEND_OUT_SIZE',
        'MAX_OBS_SIZE', 'MAX_HIDDEN', 'MAX_OUT_SIZE',
      ],
      // ...and the empty-sky ThreatsView the defence encoder defaults to — a
      // sentinel value of observation.ts's own parameter, not a tunable
      'ai-training/observation.ts': ['NO_OTHER_THREATS'],
    },
  },

  {
    why: 'STAYS: `EPISODE_SCHEMA` is a format version welded to the episode record and'
      + ' its five-bump history, the `SNAPSHOT_VERSION` shape; `TARGET_HULLS`,'
      + ' `TRADER_COBRA`, `PLAYER_LASERS` and `TRADER_WEAPON_BYTE` are catalogue and'
      + ' roster reads resolved at load, the `MISSILE_HULL` shape; and the three'
      + ' `WEAVE_*` numbers calibrate the weaving INSTRUMENT docs/TODO/66 built — a'
      + ' measurement target one private pilot flies, not a game rule, and nothing'
      + ' outside `weavingTrader` could ever need them',
    files: {
      'ai-training/scenario.ts': [
        'EPISODE_SCHEMA', 'TARGET_HULLS', 'TRADER_COBRA', 'PLAYER_LASERS',
        'TRADER_WEAPON_BYTE', 'WEAVE_RADIUS', 'WEAVE_MIN_SECONDS', 'WEAVE_MAX_SECONDS',
      ],
    },
  },

  // --- decided: these stay where they are ------------------------------------

  {
    why: 'STAYS: the classic Elite galaxy generator\'s own data — the three seed words'
      + ' and the twist they advance under, the digraph table two different name'
      + ' generators both index, the species-name tables, and the market model\'s'
      + ' per-commodity base prices, gradients, quantities and masks. Every one of these'
      + ' is transcribed from the 1984 algorithm rather than chosen by Harmless; docs/TODO/90'
      + ' rules the tables out by name and invariant 4 is what holds them to the original\'s'
      + ' bytes. `ECONOMY_NAMES` and `GOVERNMENT_NAMES` are the same case: the original\'s'
      + ' own category names, not a Harmless wording',
    files: {
      'galaxy/galaxy.ts': ALL,
      'galaxy/goatsoup.ts': ALL,
    },
  },

  {
    why: 'STAYS: a JSON overlay resolved once at load and keyed by system index — the'
      + ' `MISSILE_HULL` shape, not a rule. It is Harmless\'s own generated prose'
      + ' (docs/TODO/58) rather than 1984 data, but it is content laid over the galaxy'
      + ' rather than a game constant, and the map itself is nothing more than the'
      + ' committed JSON given a name',
    files: {
      'galaxy/descriptions.ts': ALL,
    },
  },

  {
    why: 'STAYS: the encyclopaedia\'s own green and amber, which docs/TODO/90 rules out of'
      + ' scope by name alongside every other phosphor colour in the game — "the'
      + ' encyclopaedia\'s separate green and amber" stays duplicated, and docs/TODO/93'
      + ' owns it, not this item',
    files: {
      'encyclopaedia/chart.ts': ['THEME'],
    },
  },

  {
    why: 'STAYS: which galaxy this build of the encyclopaedia covers — a page-build choice'
      + ' tied to the descriptions corpus being galaxy-1-only (galaxy/descriptions.ts\'s own'
      + ' header explains why), not a rule any other module has an opinion about. Read once,'
      + ' at the top of the page\'s own entry point, and nothing outside this file could use'
      + ' a second copy',
    files: {
      'encyclopaedia/main.ts': ['GALAXY'],
    },
  },

  {
    why: 'STAYS: hull and pack DATA, not constants. Generated or transcribed from a'
      + ' source, with their own provenance — docs/TODO/90 rules the tables out by'
      + ' name. The slice that reaches them records the exclusion; it does not move'
      + ' them',
    files: {
      'game/elite-a/catalogue.ts': ALL,
      'game/elite-a/combat-math.ts': ALL,
      'game/elite-a/designs.generated.ts': ALL,
      'game/elite-a/geometry.generated.ts': ALL,
      'game/elite-a/player-hulls.generated.ts': ALL,
      'game/elite-a/provenance.generated.ts': ALL,
      'game/elite-a/slots.generated.ts': ALL,
      'game/elite-a/variants.generated.ts': ALL,
      'game/ship-identity.ts': ALL,
      'ships/elite-a-faces.ts': ALL,
      'ships/elite-a-hulls.ts': ALL,
      'ships/harmless-hulls.ts': ALL,
      'ships/registry.ts': ALL,
    },
  },

  {
    why: 'STAYS: a GLSL program and a three.js material. Neither is a number anybody'
      + ' outside the file can act on',
    files: {
      'ships/geometry.ts': ALL,
      'world/planet.ts': ALL,
      'world/sun.ts': ALL,
    },
  },
];

// --- the scan ----------------------------------------------------------------

const ROOT = new URL('../src/', import.meta.url);

const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir))
    : /\.ts$/.test(e.name) ? [new URL(e.name, dir)] : []));

const FILES = walk(ROOT)
  .map((url) => ({ rel: url.pathname.slice(ROOT.pathname.length), url }))
  .sort((a, b) => a.rel.localeCompare(b.rel));

/**
 * The source with its comments gone.
 *
 * The same strip `test/ai.test.ts` and `tools/portability.mjs` use, and for the
 * same reason: this codebase deliberately writes down the constants it deleted,
 * and a scan that read prose would fire on the history that stops them coming
 * back.
 */
const code = (url: URL): string =>
  readFileSync(url, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

/**
 * Every module-level UPPER_CASE constant a file declares.
 *
 * Deliberately blind to the initialiser: a name is captured whether it is a
 * literal, an expression, a call or a table. Anchored at column zero, so a
 * `const` inside a function is not one of these.
 */
const declarations = (source: string): string[] =>
  [...source.matchAll(/^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\b/gm)].map((m) => m[1]);

const inHome = (rel: string): boolean => rel.startsWith('constants/');

const found = new Map<string, string[]>();
for (const { rel, url } of FILES) {
  const names = declarations(code(url));
  if (names.length) found.set(rel, names);
}

console.log('\nconstants — one home for every one of them');

// The list, flattened. Two groups naming the same file would be two plans for
// it, so that is a failure of its own.
const listed = new Map<string, typeof ALL | readonly string[]>();
const claimedTwice: string[] = [];
for (const group of OUTSIDE) {
  for (const [rel, allowed] of Object.entries(group.files)) {
    if (listed.has(rel)) claimedTwice.push(rel);
    listed.set(rel, allowed);
  }
}
check('no file is claimed by two groups of the plan', claimedTwice.length === 0,
  claimedTwice.join(' · '));

// 1. NOTHING UNACCOUNTED FOR.
{
  const stray: string[] = [];
  for (const [rel, names] of found) {
    if (inHome(rel)) continue;
    const allowed = listed.get(rel);
    if (allowed === ALL) continue;
    const permitted = new Set(allowed ?? []);
    for (const name of names) if (!permitted.has(name)) stray.push(`${rel}: ${name}`);
  }
  check(`no game-rule constant is declared outside src/constants/ off the plan`
    + ` (${stray.length} stray)`,
  stray.length === 0,
  `${stray.slice(0, 8).join(' · ')}${stray.length > 8 ? ` (+${stray.length - 8} more)` : ''}`
    + ' — move it to src/constants/, or add it to OUTSIDE in test/constants.test.ts'
    + ' under the slice that owns it');
}

// 2. THE LIST IS NOT VACUOUS, AND IT IS NOT STALE.
{
  const remaining = [...found].filter(([rel]) => !inHome(rel))
    .reduce((n, [, names]) => n + names.length, 0);
  const homed = [...found].filter(([rel]) => inHome(rel))
    .reduce((n, [, names]) => n + names.length, 0);
  check(`the scan finds constants at all — ${homed} home, ${remaining} still out`
    + ` across ${[...found].filter(([rel]) => !inHome(rel)).length} files`,
  homed >= 30 && remaining >= 100);

  const stale: string[] = [];
  for (const [rel, allowed] of listed) {
    const names = found.get(rel);
    if (!names) { stale.push(`${rel} (no constants left)`); continue; }
    if (allowed === ALL) continue;
    for (const name of allowed) {
      if (!names.includes(name)) stale.push(`${rel}: ${name} (gone)`);
    }
  }
  check('...and every entry on the plan still has something to account for',
    stale.length === 0,
    `${stale.join(' · ')} — take it off the list in test/constants.test.ts`);
}

// 3. THE HOME IS A LEAF.
//
// Everything imports it, so a single edge out of it can create a cycle — and it
// would propagate the portability gate's contamination in both directions, since
// `npc.ts` and `combat-computer.ts` import `ai-training/` and `ai-training/` is
// reached from the trainer. `import type` is not exempted: the point of the rule
// is that a reader can see the directory has no dependencies, and an erased
// import still puts one in the file.
//
// TWO PATTERNS, because one missed a whole shape. The `from` form covers every
// import and re-export that binds a name; a SIDE-EFFECT import — `import 'x';`
// — has no `from` at all and went straight through, which was found by breaking
// this check in the spawning slice and watching it stay green. It is the most
// dangerous shape of the two: it brings a module's top-level work into the leaf
// while leaving nothing in the file for a reader to notice. The bare pattern
// cannot be widened into the first one without also matching
// `export const X = 'a string'`.
{
  const edges: string[] = [];
  for (const { rel, url } of FILES) {
    if (!inHome(rel)) continue;
    const source = code(url);
    for (const m of [...source.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+'([^']+)'/gm),
      ...source.matchAll(/^\s*import\s+'([^']+)'/gm)]) {
      // relative, and not escaping the directory. A bare specifier ('three')
      // fails the first half; '../game/rng.ts' fails the second.
      if (!m[1].startsWith('./') || m[1].includes('..')) edges.push(`${rel} -> ${m[1]}`);
    }
  }
  check('src/constants/ imports nothing outside src/constants/', edges.length === 0,
    edges.join(' · '));
}

// 4. ONE HOME, CHECKED.
{
  const home = new Map<string, string>();
  const twice: string[] = [];
  for (const [rel, names] of found) {
    if (!inHome(rel)) continue;
    for (const name of names) {
      const already = home.get(name);
      if (already) twice.push(`${name} (${already} and ${rel})`);
      else home.set(name, rel);
    }
  }
  check(`no constant is declared twice inside src/constants/ (${home.size} names)`,
    twice.length === 0, twice.join(' · '));

  const shadowed: string[] = [];
  for (const [rel, names] of found) {
    if (inHome(rel)) continue;
    for (const name of names) {
      if (home.has(name)) shadowed.push(`${name}: ${home.get(name)} and ${rel}`);
    }
  }
  check('...and nothing in src/ redeclares a name that lives there',
    shadowed.length === 0,
    `${shadowed.join(' · ')} — this is the MAX_TRADERS failure, in a file that`
    + ' can see the answer');
}
