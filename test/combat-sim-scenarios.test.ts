// The combat trainer's rules: who it sends at you, and when it stops.
//
// The pure half of docs/COMBAT-SIM.md. The load-bearing checks are the ones that
// stop the scenario table drifting from the game it measures: every role is a role
// the roster knows, every named brain is a file that exists, and "as they come" is
// pirateThreat() itself rather than a second opinion about a reception.

import { readFileSync, existsSync } from 'node:fs';
import { SPECS, CONSTRICTOR_SPEC } from '../src/game/ship-specs.ts';
import { hasShipDef, shipDisplayName } from '../src/ships/registry.ts';
import {
  SCENARIOS,
  MODES,
  SCENARIO_TIMEOUT,
  MAX_TIER,
  WAVE_MAX_COUNT,
  WAVE_SATURATION,
  SHIPPED_SOLO_BRAIN,
  SHIPPED_PACK_BRAIN,
  SHIPPED_DEFENCE_BRAIN,
  SIM_BRAINS,
  scenarioOpposition,
  asTheyCome,
  oppositionFromThreat,
  oppositionShips,
  allShips,
  shipCount,
  describeOpposition,
  simHulls,
  waveOpposition,
  waveCount,
  waveTier,
  exerciseTimeout,
  nextOpposition,
  roundOutcome,
  OPPOSITION_ROLES,
  type Opposition,
  type BrainId,
  type ExerciseSpec,
  type ExerciseSession,
  type ThreatContext,
} from '../src/game/combat-sim-scenarios.ts';
import { pirateThreat, markOf, memberTier } from '../src/game/threat.ts';
import { makeRng } from '../src/game/rng.ts';
import { check, eq } from './harness.ts';
import { g1 } from './fixtures.ts';

// --- the combat trainer's opposition ----------------------------------------
//
// The rules half of docs/COMBAT-SIM.md: who the training simulator sends at
// you, and when it stops. It is pure, so all of it is reachable here — the
// seven scenarios, the wave ramp, and the three modes as two functions.
//
// The load-bearing checks are the ones that stop the table drifting away from
// the game it is supposed to measure: every role is a role the roster knows,
// every named brain is a file that exists, and "as they come" is `pirateThreat`
// itself rather than a second opinion about what a reception looks like.

console.log('\ncombat trainer scenarios');
{
  // a laden Cobra at Lave, which is what "as they come" is worth asking about,
  // and the same commander with nothing aboard
  const cargo = (t: Record<number, number>) => {
    const c = new Array(17).fill(0);
    for (const [i, q] of Object.entries(t)) c[+i] = q;
    return c;
  };
  const ladenCommander = {
    cargo: cargo({ 7: 35 }), kills: 0, combatScore: 0,
    equipment: { laser: 'pulse', largeBay: true },
  };
  const brokeCommander = { ...ladenCommander, cargo: cargo({}) };
  const threatCtx: ThreatContext = {
    sys: g1[7], danger: 0.1, commander: ladenCommander, notoriety: 0,
  };

  const spec = (over: Partial<ExerciseSpec> = {}): ExerciseSpec => ({
    mode: 'scenario', scenario: 'single-pirate', tier: 1, seed: 1234, ...over,
  });
  const session = (over: Partial<ExerciseSession> = {}): ExerciseSession => ({
    spec: spec(), round: 0, spawned: 0, alive: 0, roundElapsed: 0,
    playerAlive: true, ...over,
  });
  const brainFileExists = (id: BrainId) => id === 'scripted'
    || existsSync(new URL(`../src/ai-training/brains/${id}.json`, import.meta.url));

  // 1 — the table resolves, all seven of it. One check per property rather
  // than one per ship: 55 lines of "ok Sidewinder has hp" is not a test
  // report, so the loop collects what is wrong and each check names it.
  {
    eq('there are seven scenarios', SCENARIOS.length, 7);
    const empty: string[] = [];
    const badRole: string[] = [];
    const badCount: string[] = [];
    const badTier: string[] = [];
    const badBrain: string[] = [];
    const badHull: string[] = [];
    let groups = 0;
    let ships = 0;
    for (const s of SCENARIOS) {
      for (const tier of s.tiered ? [0, 1, 2] : [1]) {
        const where = `${s.id}@${tier}`;
        const list = s.groups
          ? scenarioOpposition(spec({ scenario: s.id, tier }), 99)
          : asTheyCome(threatCtx, 99, makeRng(7));
        if (!list.length) empty.push(where);
        for (const o of list) {
          groups += 1;
          if (!SPECS[o.role]?.length) badRole.push(`${where} ${o.role}`);
          if (!(o.count >= 1)) badCount.push(`${where} ${o.count}`);
          if (o.tier < 0 || o.tier > MAX_TIER) badTier.push(`${where} ${o.tier}`);
          if (!brainFileExists(o.brain)) badBrain.push(`${where} ${o.brain}`);
          for (const ship of oppositionShips(o)) {
            ships += 1;
            if (!hasShipDef(ship.spec.designId) || ship.spec.hp <= 0
                || ship.spec.maxSpeed <= 0) {
              badHull.push(`${where} ${shipDisplayName(ship.spec.designId)}`);
            }
          }
        }
      }
    }
    check(`every scenario sends somebody (${groups} groups, ${ships} ships)`,
      empty.length === 0 && groups >= 9, empty.join(', '));
    check('every role is a role the roster knows', badRole.length === 0, badRole.join(', '));
    check('every group is at least one ship', badCount.length === 0, badCount.join(', '));
    check(`every tier is 0..${MAX_TIER}`, badTier.length === 0, badTier.join(', '));
    check('every named brain is a real brain file', badBrain.length === 0, badBrain.join(', '));
    check('every ship resolved to a hull that can fly',
      badHull.length === 0, badHull.join(', '));
  }

  // ...and the ids agree with what the game actually flies. This is the pairing
  // that matters: a report saying "g3" when the game flew something else is
  // worse than no report, and only brains.ts knows the truth.
  {
    const src = readFileSync(new URL('../src/game/brains.ts', import.meta.url), 'utf8');
    check(`the shipped solo brain is ${SHIPPED_SOLO_BRAIN}`,
      src.includes(`${SHIPPED_SOLO_BRAIN}.json`));
    check(`the shipped pack brain is ${SHIPPED_PACK_BRAIN}`,
      src.includes(`${SHIPPED_PACK_BRAIN}.json`));
    check(`the shipped defence brain is ${SHIPPED_DEFENCE_BRAIN}`,
      src.includes(`${SHIPPED_DEFENCE_BRAIN}.json`));
    check('every listed brain exists', SIM_BRAINS.every(brainFileExists));
  }

  // 2 — the individual fights are what the spec says they are
  {
    const hunter = scenarioOpposition(spec({ scenario: 'lone-hunter' }), 3);
    const hunterShip = oppositionShips(hunter[0])[0];
    const hull = shipDisplayName(hunterShip.spec.designId);
    check(`a lone bounty hunter is one ship off the hunter roster (${hull})`,
      hunter.length === 1 && hunter[0].count === 1
      && SPECS.hunter.some((s) => s.designId === hunterShip.spec.designId));

    const police = scenarioOpposition(spec({ scenario: 'police' }), 3);
    check('police interdiction is two Vipers',
      police[0].count === 2
      && oppositionShips(police[0]).every(
        (s) => shipDisplayName(s.spec.designId) === 'Viper'));

    const pair = oppositionShips(scenarioOpposition(spec({ scenario: 'pirate-pair', tier: 1 }), 3)[0]);
    check('a pirate pair is two of the SAME tier',
      pair.length === 2 && pair.every((s) => s.tier === 1));

    const gang3 = scenarioOpposition(spec({ scenario: 'pirate-gang', tier: 1 }), 3)[0];
    const gang4 = scenarioOpposition(spec({ scenario: 'pirate-gang', tier: 2 }), 3)[0];
    check(`a gang is three, four at the top tier (${gang3.count}, ${gang4.count})`,
      gang3.count === 3 && gang4.count === 4);
    check('a gang is organised and flies the pack policy',
      gang4.organised && gang4.brain === SHIPPED_PACK_BRAIN);
    // ...and it is ringleaders plus hangers-on, which is contracts.ts's rule
    // and not a second one: two leaders, the rest a tier below.
    const gangTiers = oppositionShips(gang4).map((s) => s.tier);
    check(`a gang is ringleaders plus hangers-on (${gangTiers.join(',')})`,
      gangTiers.join(',') === [0, 1, 2, 3].map((i) => memberTier(2, i)).join(','));

    const thargoids = scenarioOpposition(spec({ scenario: 'thargoids', tier: 0 }), 3);
    const top = scenarioOpposition(spec({ scenario: 'thargoids', tier: 2 }), 3);
    check('a Thargoid ambush brings Thargons too',
      thargoids.length === 2 && thargoids[0].role === 'thargoid'
      && thargoids[1].role === 'thargon');
    check(`Thargoids come two or three (${thargoids[0].count}, ${top[0].count})`,
      thargoids[0].count === 2 && top[0].count === 3);
    check('Thargoids are scripted — the brains are pirates',
      thargoids.every((o) => o.brain === 'scripted'));
  }

  // 3 — as they come: the galaxy's own answer, not a second opinion
  {
    const threat = pirateThreat(threatCtx.sys, threatCtx.danger,
      markOf(threatCtx.commander, threatCtx.notoriety), makeRng(42));
    const mine = asTheyCome(threatCtx, 5, makeRng(42));
    check('as-they-come IS pirateThreat',
      JSON.stringify(mine) === JSON.stringify(oppositionFromThreat(threat, 5)));
    check(`...count, tier and organisation come straight from it `
      + `(${threat.count} at tier ${threat.tier})`,
    mine[0].count === Math.max(1, threat.count) && mine[0].tier === threat.tier
      && mine[0].organised === threat.organised);
    check('...and the group is ringleaders plus hangers-on, as spawning.ts builds it',
      mine[0].mixed);
    check('...flying the brain the live game gives them',
      mine[0].brain === (threat.organised ? SHIPPED_PACK_BRAIN : SHIPPED_SOLO_BRAIN));

    // the one deviation: you came here for a fight, so a reception of nobody
    // still sends one ship. An empty hold in a corporate state is genuinely
    // nobody, which is what makes the floor worth having.
    const quiet: ThreatContext = {
      sys: { ...threatCtx.sys, government: 7 }, danger: 0,
      commander: brokeCommander, notoriety: 0,
    };
    const raw = pirateThreat(quiet.sys, quiet.danger, markOf(quiet.commander), () => 0);
    const lone = asTheyCome(quiet, 5, () => 0);
    check(`a reception of nobody is still one opponent (pirateThreat said ${raw.count})`,
      raw.count === 0 && lone[0].count === 1 && shipCount(lone) === 1);

    // it reads the CAREER commander, which is the whole point of passing one in
    const rich = asTheyCome(threatCtx, 5, () => 0.5);
    const poor = asTheyCome({ ...threatCtx, commander: brokeCommander }, 5, () => 0.5);
    check(`a laden commander draws a hotter reception than an empty one `
      + `(tier ${rich[0].tier} vs ${poor[0].tier})`,
    rich[0].tier > poor[0].tier);
  }

  // 4 — the three modes, as two functions
  {
    check('a scenario spawns on round 0',
      nextOpposition(session({ spec: spec({ mode: 'scenario' }) })) !== null);
    check('...and never again',
      nextOpposition(session({ spec: spec({ mode: 'scenario' }), round: 1 })) === null);
    check('a scenario is running while they live',
      roundOutcome(session({ spawned: 2, alive: 2, roundElapsed: 10 })) === 'running');
    check('a scenario ends when the last one dies',
      roundOutcome(session({ spawned: 2, alive: 0 })) === 'over');
    check('...or when the player is destroyed',
      roundOutcome(session({ spawned: 2, alive: 2, playerAlive: false })) === 'over');
    check(`...or on the ${SCENARIO_TIMEOUT}s timeout`,
      roundOutcome(session({ spawned: 1, alive: 1, roundElapsed: SCENARIO_TIMEOUT })) === 'over');
    check('...and the timeout is configurable',
      roundOutcome(session({
        spec: spec({ timeoutSeconds: 30 }), spawned: 1, alive: 1, roundElapsed: 31,
      })) === 'over');
    check('nothing spawned yet is not a wipeout',
      roundOutcome(session({ spawned: 0, alive: 0 })) === 'running');
    check('quitting ends it',
      roundOutcome(session({ spawned: 1, alive: 1, quitting: true })) === 'over');

    // sparring: one opponent, endlessly, and the player gets patched up
    {
      const sp = spec({ mode: 'sparring', scenario: 'pirate-gang', tier: 2 });
      const rounds = [0, 1, 2, 3, 4, 5].map((round) =>
        nextOpposition(session({ spec: sp, round }))!);
      check('sparring sends exactly one opponent, every round',
        rounds.every((r) => shipCount(r) === 1));
      check('...alone, so not flying the pack policy',
        rounds.every((r) => !r[0].organised && r[0].brain === SHIPPED_SOLO_BRAIN));
      check('...on a fresh seed each round',
        new Set(rounds.map((r) => r[0].seed)).size === rounds.length);
      // ...and against the SAME hull each round, which is the mode's whole
      // point: you are learning what one ship does, not sampling the roster.
      check('...against the same hull every round',
        new Set(rounds.map(
          (r) => shipDisplayName(oppositionShips(r[0])[0].spec.designId))).size === 1);
      check('...the hull a lone opponent of that fight would be',
        oppositionShips(rounds[0][0])[0].spec.designId
        === oppositionShips({ ...scenarioOpposition(sp, sp.seed, undefined)[0], count: 1 })[0]
          .spec.designId);
      check('a sparring kill starts another round',
        roundOutcome(session({ spec: sp, spawned: 1, alive: 0 })) === 'roundOver');
      check('...and death still ends it',
        roundOutcome(session({ spec: sp, spawned: 1, alive: 1, playerAlive: false })) === 'over');
      check('...it is never on a clock',
        exerciseTimeout(sp) === 0
        && roundOutcome(session({ spec: sp, spawned: 1, alive: 1, roundElapsed: 9999 })) === 'running');
      check('sparring restores the ship between rounds — it is for learning a hull',
        MODES.sparring.restoreBetweenRounds && MODES.sparring.record === 'kill');
      check('sparring is endless', nextOpposition(session({ spec: sp, round: 400 })) !== null);
    }

    // waves: the human-flown answer to "how many can I actually take?"
    {
      const wv = spec({ mode: 'waves' });
      const ns = Array.from({ length: 40 }, (_, i) => i + 1);
      const counts = ns.map(waveCount);
      const tiers = ns.map(waveTier);
      check('waves ramp monotonically in count',
        counts.every((c, i) => i === 0 || c >= counts[i - 1]));
      check('...and in tier', tiers.every((t, i) => i === 0 || t >= tiers[i - 1]));
      check(`...and both actually grow (${counts[0]}→${counts[9]} ships, `
        + `tier ${tiers[0]}→${tiers[9]})`,
      counts[9] > counts[0] && tiers[9] > tiers[0]);
      check(`...then saturate rather than diverge (${WAVE_MAX_COUNT} ships, `
        + `tier ${MAX_TIER}, from wave ${WAVE_SATURATION})`,
      counts.every((c) => c <= WAVE_MAX_COUNT) && tiers.every((t) => t <= MAX_TIER));
      const late = ns.filter((n) => n >= WAVE_SATURATION)
        .map((n) => JSON.stringify(waveOpposition(n, 0)));
      check(`every wave from ${WAVE_SATURATION} on is the same fight`,
        new Set(late).size === 1);
      check(`...and the wave before it is not (${WAVE_SATURATION - 1} differs)`,
        JSON.stringify(waveOpposition(WAVE_SATURATION - 1, 0)) !== late[0]);
      check('a top wave is an organised gang flying the pack policy',
        waveOpposition(WAVE_SATURATION)[0].organised
        && waveOpposition(WAVE_SATURATION)[0].brain === SHIPPED_PACK_BRAIN);
      check('wave 1 is a single opportunist',
        shipCount(waveOpposition(1)) === 1 && waveTier(1) === 0);
      check('the session asks for wave n+1 on round n',
        JSON.stringify(nextOpposition(session({ spec: wv, round: 3 }))!.map((o) => o.count))
        === JSON.stringify(waveOpposition(4).map((o) => o.count)));
      check('a cleared wave brings the next one',
        roundOutcome(session({ spec: wv, spawned: 3, alive: 0 })) === 'roundOver');
      check('...and dying ends the run — that is the score',
        roundOutcome(session({ spec: wv, spawned: 3, alive: 1, playerAlive: false })) === 'over');
      check('waves do NOT restore the ship — attrition is the question',
        !MODES.waves.restoreBetweenRounds && MODES.waves.score === 'waves');
    }
  }

  // 5 — determinism, and the A/B override
  {
    const s = session({ spec: spec({ scenario: 'pirate-gang', tier: 2 }) });
    const a = JSON.stringify(nextOpposition(s));
    const b = JSON.stringify(nextOpposition(s));
    check('the same seed sends the same opposition', a === b);
    check('...down to the hulls',
      JSON.stringify(allShips(nextOpposition(s)!).map((x) => x.spec.designId))
      === JSON.stringify(allShips(nextOpposition(s)!).map((x) => x.spec.designId)));
    const other = nextOpposition(session({
      spec: spec({ scenario: 'pirate-gang', tier: 2, seed: 999 }),
    }));
    check('a different seed sends a different draw', JSON.stringify(other) !== a);
    check('as-they-come is deterministic in its rng',
      JSON.stringify(asTheyCome(threatCtx, 1, makeRng(3)))
      === JSON.stringify(asTheyCome(threatCtx, 1, makeRng(3))));

    // the A/B rig: same fight, other brain — the question CLAUDE.md says the
    // numbers cannot answer
    const ab = nextOpposition(session({
      spec: spec({ scenario: 'thargoids', brain: 'pirate-attack-r2' }),
    }))!;
    check('one brain override reaches every opponent',
      ab.length > 1 && ab.every((o) => o.brain === 'pirate-attack-r2'));

    // the custom picker: a hull off the roster, and the fit
    const custom: Opposition = {
      role: 'pirate', count: 2, tier: 2, organised: false,
      brain: SHIPPED_SOLO_BRAIN, mixed: false, seed: 0,
      hull: simHulls().find((h) => h.name === 'Constrictor')!.spec,
      missiles: 4, ecm: 1,
    };
    const built = oppositionShips(custom);
    check('a custom hull overrides the roster pick',
      built.every((x) => shipDisplayName(x.spec.designId) === 'Constrictor'));
    check('...and the fit overrides the hull',
      built.every((x) => x.spec.missiles === 4 && x.spec.ecmChance === 1));
    check('...without editing the roster entry',
      CONSTRICTOR_SPEC.missiles === 2);
    // the custom picker's roster is DERIVED from SPECS, so a new hull in the
    // game is a new hull here without anyone remembering to add it
    {
      const hulls = simHulls();
      const rostered = OPPOSITION_ROLES
        .flatMap((r) => SPECS[r]).filter((s) => hasShipDef(s.designId)).length;
      check(`the picker offers the whole roster plus the Constrictor `
        + `(${hulls.length} hulls)`,
      hulls.length === rostered + 1
        && hulls.some((h) => h.name === 'Constrictor')
        && hulls.some((h) => h.name === 'Cobra Mk III')
        && hulls.every((h) => hasShipDef(h.spec.designId)));
    }
    check('a custom exercise wins over the scenario table',
      nextOpposition(session({ spec: spec({ custom: [custom] }) }))![0].hull !== undefined);
  }

  check('opposition describes itself for the report',
    /2 × .+\(tier 1\)/.test(describeOpposition(
      scenarioOpposition(spec({ scenario: 'pirate-pair', tier: 1 }), 3))));
}
