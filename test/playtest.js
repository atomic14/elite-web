/**
 * Autonomous playtest agent — a commander that plays the actual game.
 *
 * The unit tests (`npm test`) guard the maths; this guards the *gameplay*.
 * It drives the real game through `window.__game`, exercising trading,
 * contracts, equipment, hyperspace, combat (flown by the trained defence
 * policy), docking, hermits and encounters — while continuously asserting
 * invariants that should never break, however the systems interact.
 *
 * Usage: open the game, open DevTools, paste this file, then:
 *
 *     await __playtest.run({ legs: 20 })          // ~1 min of simulated play
 *     await __playtest.run({ legs: 60, log: true })
 *
 * It backs up your commander first and restores it at the end, and prints
 * a report: what it achieved, what it saw, and every invariant violation.
 *
 * Nothing here reimplements a game rule. This file is pasted into a console
 * and cannot use a static `import`, but it CAN use a dynamic one against the
 * dev server (test/gang-trial.js already does), so every rule it needs is
 * loaded from the module that owns it. It used to carry copies — the market
 * model with the `& 0xff` wrap missing and no living galaxy, the contraband
 * list, the hold's unit table, the chart metric, the player's turn rates —
 * and each one was a measurement quietly taken on a different game.
 */
(async () => {
  const g = window.__game;
  const kit = window.__policyKit;
  if (!g || !kit) { console.error('open the game first'); return; }

  //   galaxy.ts     the 1984 market model, byte wrap and all
  //   navigation.ts the chart distance metric
  //   contracts.ts  the living galaxy's price pressure on top of it
  //   law.ts        CONTRABAND — the ONE definition
  //   commander.ts  what counts against the hold, and how big it is
  //   storage.ts    the one-way switch into the harness save namespace
  //   player.ts     the ship's real pitch, roll, acceleration and rate ramp
  const [galaxyMod, navMod, contractsMod, lawMod, commanderMod, storageMod, playerMod] =
    await Promise.all([
      import('/src/galaxy/galaxy.ts'),
      import('/src/galaxy/navigation.ts'),
      import('/src/game/contracts.ts'),
      import('/src/game/law.ts'),
      import('/src/game/commander.ts'),
      import('/src/game/storage.ts'),
      import('/src/player.ts'),
    ]);
  const { COMMODITIES, generateMarket } = galaxyMod;
  const { distanceTenths } = navMod;
  const { applyMarketPressure } = contractsMod;
  const { isContraband } = lawMod;
  const { cargoTonnes: holdTonnes, cargoCapacity: holdCapacity } = commanderMod;
  const { useHarnessSaves, clearHarnessSaves, saveNamespace } = storageMod;
  const { PLAYER_FLIGHT, rampFlightRate } = playerMod;

  const V = g.player.position.clone().constructor;
  const Q = g.player.quaternion.clone().constructor;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** kg and g commodities don't take hold space — galaxy.ts says which. */
  const isTonne = (i) => COMMODITIES[i].unit === 't';

  const pt = window.__playtest = {
    report: null,
    history: [],

    // ---- invariant checking -------------------------------------------

    violations: [],
    seen: new Set(),
    note(what) { this.seen.add(what); },
    fail(what) {
      if (this.violations.length < 40) this.violations.push(`${what} (day ${g.commander.day})`);
    },

    checkInvariants() {
      const c = g.commander;
      const p = g.player.position;
      if (!Number.isFinite(p.x + p.y + p.z)) this.fail('player position became non-finite');
      if (!Number.isFinite(g.player.speed)) this.fail('player speed became non-finite');
      if (c.credits < 0) this.fail(`credits went negative (${c.credits})`);
      if (c.fuel < -0.001 || c.fuel > 70.001) this.fail(`fuel out of range (${c.fuel})`);
      if (c.missiles < 0 || c.missiles > 4) this.fail(`missiles out of range (${c.missiles})`);
      if (c.cargo.some((q) => q < 0)) this.fail('negative cargo quantity');
      // the game's own hold arithmetic — the copy here missed the rescued
      // survivors that also take a bay, so it could not see a real overfill
      const tonnes = holdTonnes(c);
      const cap = holdCapacity(c);
      if (tonnes > cap) this.fail(`hold overfilled (${tonnes}/${cap})`);
      // 255-point banks since TODO 27, and whole points: a fraction in here
      // means something has started doing arithmetic in the old normalized
      // units again.
      if (g.energy < 0 || g.energy > 255) this.fail(`energy out of range (${g.energy})`);
      if (!Number.isInteger(g.energy)) this.fail(`energy is not a whole point (${g.energy})`);
      // the three base modes plus every ScreenId (ui/screen-host.ts) — the
      // list had not been updated for saves/naming/briefing, so any of them
      // would have been reported as a soft lock rather than a screen
      const modes = ['docked', 'flight', 'dead',
        'market', 'equip', 'contracts', 'status', 'data',
        'chart', 'local', 'saves', 'naming', 'briefing'];
      if (!modes.includes(g.mode)) this.fail(`unknown mode "${g.mode}"`);
      for (const n of g.npcs) {
        if (!Number.isFinite(n.object.position.x)) this.fail(`${n.role} position became non-finite`);
      }
      // a screen mode must always have a visible overlay to escape from
      if (['market', 'equip', 'contracts', 'status', 'data'].includes(g.mode)) {
        if (document.getElementById('screen').classList.contains('hidden')) {
          this.fail(`mode ${g.mode} with no screen shown — soft lock`);
        }
      }
    },

    step(n, dt = 1 / 30) {
      for (let i = 0; i < n; i++) {
        g.update(dt, performance.now() / 1000 + i * dt);
        if (i % 30 === 0) this.checkInvariants();
      }
    },

    // ---- combat: hand the ship to the trained defence policy ----------

    obsBuf: new Float32Array(18),
    scratch: kit.makeScratch(),
    cPitch: 0, cRoll: 0, cTimer: 0, cControl: null,
    // `cls` is the OBSERVATION normaliser, not the ship. It stays at the
    // trader-Cobra the defence policy was trained flying — same values
    // combat-computer.ts feeds it — because changing it moves the observation
    // out of the distribution the brain learned. The ship it actually flies is
    // PLAYER_FLIGHT, below.
    meView: { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, speed: 0,
      cls: { maxSpeed: 220, turnRate: 0.5 }, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0 },
    tgView: { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, speed: 280,
      cls: { maxSpeed: 300, turnRate: 1.1 }, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0 },

    nearestHostile(range) {
      let best = null, bestD = range;
      for (const n of g.npcs) {
        if (!n.state.alive || !['pirate', 'thargoid', 'thargon'].includes(n.role)) continue;
        const d = n.object.position.distanceTo(g.player.position);
        if (d < bestD) { bestD = d; best = n; }
      }
      return best;
    },

    combatStep(target, dt) {
      this.cTimer -= dt;
      if (!this.cControl || this.cTimer <= 0) {
        this.cTimer = 0.1;
        const me = this.meView, tv = this.tgView;
        const p = g.player.position, q = g.player.quaternion;
        me.pos.x = p.x; me.pos.y = p.y; me.pos.z = p.z;
        me.quat.x = q.x; me.quat.y = q.y; me.quat.z = q.z; me.quat.w = q.w;
        me.speed = g.player.speed; me.laserTemp = g.laserTemp; me.laserCooldown = g.laserCooldown;
        me.pitchRate = this.cPitch; me.rollRate = this.cRoll;
        const tp = target.object.position, tq = target.object.quaternion;
        tv.pos.x = tp.x; tv.pos.y = tp.y; tv.pos.z = tp.z;
        tv.quat.x = tq.x; tv.quat.y = tq.y; tv.quat.z = tq.z; tv.quat.w = tq.w;
        this.cControl = kit.act(kit.defendBrain, kit.observe(me, tv, this.obsBuf), this.scratch);
      }
      const c = this.cControl;
      // The ship that ships. This was 0.7 pitch / 1.2 roll / 120 accel /
      // 300 top speed with a 4-5 ramp — half the real pitch and roll (1.45 and
      // 2.5), a fifth off the acceleration, and a decay of 5 where the real
      // controls bleed off at 12. src/player.ts owns these; PLAYER_FLIGHT and
      // rampFlightRate are exported so they cannot drift apart again.
      const F = PLAYER_FLIGHT;
      this.cPitch = rampFlightRate(this.cPitch, c.pitch * F.maxPitch, c.pitch !== 0, dt);
      this.cRoll = rampFlightRate(this.cRoll, c.roll * F.maxRoll, c.roll !== 0, dt);
      if (c.throttle > 0) g.player.speed = Math.min(F.maxSpeed, g.player.speed + F.accel * dt);
      if (c.throttle < 0) g.player.speed = Math.max(0, g.player.speed - F.accel * dt);
      if (this.cRoll) g.player.quaternion.multiply(new Q().setFromAxisAngle(new V(0, 0, 1), this.cRoll * dt));
      if (this.cPitch) g.player.quaternion.multiply(new Q().setFromAxisAngle(new V(1, 0, 0), this.cPitch * dt));
      if (c.fire) g.fireLaser();
    },

    // ---- station business ---------------------------------------------

    lastSpend: 0,

    cargoTonnes() {
      return holdTonnes(g.commander);
    },

    /** Take a contract if one looks doable, and report where it wants us. */
    takeContract() {
      const c = g.commander;
      if (c.contracts.length >= 2 || !g.contractOffers.length) return null;
      for (let i = 0; i < g.contractOffers.length; i++) {
        const k = g.contractOffers[i];
        if (k.kind === 'cargo' && this.cargoTonnes() + k.qty > holdCapacity(c)) continue;
        g.contractSelected = i;
        const before = c.contracts.length;
        g.acceptContract();
        if (c.contracts.length > before) {
          this.note(`contract:${k.kind}`);
          return c.contracts[c.contracts.length - 1];
        }
      }
      return null;
    },

    /**
     * Reload the last station save after being destroyed. Drives respawn()
     * directly rather than injecting Enter: the death screen's keypress is
     * edge-triggered, and a press that lands on the wrong frame leaves the
     * agent sitting in `dead` forever, which reads as a strand.
     */
    reviveFromDeath() {
      this.note('death');
      g.respawn();
      this.step(4);
    },

    /**
     * Turn the hold back into cash and top up the tank. Split out of trade()
     * because it must happen *before* we ask what's in jump range: a commander
     * sitting on a full hold and a dry tank isn't stranded, just illiquid.
     */
    liquidate() {
      const c = g.commander;
      // sell all non-contract cargo
      const committed = new Map();
      for (const k of c.contracts) {
        if (k.kind === 'cargo') committed.set(k.commodity, (committed.get(k.commodity) ?? 0) + k.qty);
      }
      for (let i = 0; i < COMMODITIES.length; i++) {
        const keep = committed.get(i) ?? 0;
        while (c.cargo[i] > keep) {
          c.cargo[i] -= 1;
          g.market[i].quantity += 1;
          c.credits += Math.round(g.market[i].price * 10);
        }
      }
      // refuel through the game's own purchase path (all-or-nothing, as in
      // the original — it declines rather than part-filling)
      if (c.fuel < 70) g.buyEquipment('fuel');
    },

    /**
     * What `index` will pay per commodity, averaged over every fluctuation
     * byte — the real market model, not a paraphrase of it.
     *
     * This was a hand-copied BASE/GRAD/MASK table and the expression
     * `(BASE + MASK/2 + economy*GRAD) * 0.4`, which had dropped the `& 0xff`
     * byte wrap galaxy.ts applies. Two things it got wrong, and it is worth
     * being exact about which, because they are different sizes:
     *
     *  - The missing wrap. Measured against generateMarket across all eight
     *    economies, exactly one commodity overflows a byte: NARCOTICS (base
     *    0xeb, gradient +29, mask 0x78), overvalued by up to 140.8 Cr —
     *    199.2 against a real 58.4. Every other commodity matched to the
     *    penny, because the mean of `fluctuation & mask` really is mask/2.
     *    Narcotics is contraband, and the filter below skips it, so this one
     *    was a live round that happened to be pointed at the floor.
     *  - The living galaxy. The old estimate had never heard of it, so it
     *    quoted baseline prices at a destination that may be ±25% off them —
     *    that one was affecting every choice, every leg.
     *
     * No cache: the pressure moves as the galaxy trades, and a price list
     * kept past its moment is the thing this file is meant to catch.
     */
    expectedPrices(index) {
      const mean = COMMODITIES.map(() => 0);
      for (let f = 0; f < 256; f++) {
        const m = applyMarketPressure(
          generateMarket(g.systems[index], f),
          (i) => g.living.priceMultiplier(index, i));
        for (let i = 0; i < m.length; i++) mean[i] += m[i].price / 256;
      }
      return mean;
    },

    /** Sell everything, refuel, then buy the most profitable legal cargo for `dest`. */
    trade(destIndex) {
      const c = g.commander;
      this.liquidate();
      // buy for the destination market
      const expect = this.expectedPrices(destIndex);
      let best = -1, bestScore = 0.5;
      for (let i = 0; i < COMMODITIES.length; i++) {
        // isContraband is law.ts's — the bare literals [3, 6, 10] were here
        if (isContraband(i) || !isTonne(i) || g.market[i].quantity <= 0) continue;
        const margin = expect[i] - g.market[i].price;
        const cost = Math.round(g.market[i].price * 10);
        const units = Math.min(g.market[i].quantity, Math.floor(c.credits / cost),
          holdCapacity(c) - this.cargoTonnes());
        if (units > 0 && units * margin > bestScore) { bestScore = units * margin; best = i; }
      }
      this.lastSpend = 0;
      if (best >= 0) {
        const before = c.credits;
        g.marketSelected = best;
        g.buyCargo(Infinity);
        this.lastSpend = before - c.credits;
        this.note('trade:bought');
      }
    },

    /** Spend surplus on kit, cheapest useful first — exercises the shop. */
    equip() {
      const c = g.commander;
      const wanted = ['fuel', 'missile', 'largeBay', 'ecm', 'scoops', 'beam',
        'escapePod', 'dockingComputer', 'combatComputer'];
      for (const id of wanted) {
        const before = JSON.stringify(c.equipment) + c.missiles;
        // leave a working float so we never strand ourselves
        if (c.credits < 1200) break; // always keep a trading float
        g.buyEquipment(id);
        if (JSON.stringify(c.equipment) + c.missiles !== before) this.note(`bought:${id}`);
      }
    },

    // ---- flight ---------------------------------------------------------

    async flyToStationAndDock(maxSteps = 20000) {
      let steps = 0, finalRun = false, fights = 0, combatSteps = 0;
      let holdSteps = 0, blockaded = false;
      // what the approach was DOING when it ran out of budget — see
      // recordDockGiveUp; a give-up with no measurement is what made TODO 60
      // three candidate causes instead of one
      let runs = 0, bumps = 0, minDist = Infinity;
      // A screen still open is not a docking problem, and it must not be
      // reported as one — see leaveScreens.
      if (g.mode !== 'flight' && g.mode !== 'docked' && g.mode !== 'dead') {
        const was = g.mode;
        this.fail(`screen "${was}" was still open in flight, ${this.leaveScreens()} escapes to clear`);
      }
      while (g.mode === 'flight' && steps < maxSteps) {
        const st = g.world.station;
        const slotN = new V(0, 0, -1).applyQuaternion(st.quaternion);
        const dist = g.player.position.distanceTo(st.position);
        const gate = st.position.clone().addScaledVector(slotN, 800);
        if (dist < minDist) minDist = dist;

        // Traffic loitering in the station's lap would otherwise hold us at a
        // standstill forever (the collision hold below yields to anything
        // within 320, and we don't normally fight this close in). In an
        // anarchy that's a livelock, not caution — so once the approach has
        // been blocked this long, latch it: fight what is shooting at us, and
        // stop yielding to anything at all.
        if (!blockaded && holdSteps >= 400) {
          blockaded = true;
          this.note('combat:blockaded');
        }

        // a fight that won't end is a fight to run from — the defence
        // policy evades rather than kills, so cap the engagement
        const fightingTooLong = combatSteps > 2500;
        const threat = (dist > 2500 || blockaded) && !fightingTooLong
          ? this.nearestHostile(4500)
          : null;
        if (fightingTooLong && combatSteps < 2600) {
          combatSteps = 2600;
          this.note('combat:disengaged');
        }
        if (threat) {
          if (!fights) this.note('combat:engaged');
          fights += 1;
          g.state.session.torusEngaged = false;
          finalRun = false;
          for (let i = 0; i < 8 && g.mode === 'flight'; i++) {
            this.combatStep(threat, 1 / 30);
            g.update(1 / 30, performance.now() / 1000 + i / 30);
            if (!threat.state.alive) break;
          }
          steps += 8;
          combatSteps += 8;
          this.checkInvariants();
          if (steps % 1500 === 0) await sleep(0);
          continue;
        }

        // Yield to traffic in the docking lanes — until the latch above says
        // the approach is blocked, and then to nothing.
        //
        // This used to keep yielding to non-hostiles once `blockaded` was set,
        // and that is what TODO 60 was: measured at the give-up, two armed
        // traders the harness had provoked were sitting 115 and 264 away at
        // speed 0 — the defence brain holds throttle -1, and npc.ts gives a
        // speed floor only to hostiles, so a trader is ENTITLED to come to
        // rest. We stopped for them; they were already stopped. 14,180 of a
        // 20,004-step budget went on a mutual standstill 408 from the door.
        // A deadlock is not a slow approach, so no budget rescues it.
        //
        // Flying on is not a free pass: collisions.ts shoves us clear, takes
        // 70% of our speed and bills the impact. That is the game's price for
        // barging through traffic, and paying it is a legitimate outcome —
        // waiting for a ship that will never move is not.
        if (dist < 6000 && !blockaded) {
          let nd = Infinity;
          for (const n of g.npcs) {
            if (!n.state.alive) continue;
            nd = Math.min(nd, n.object.position.distanceTo(g.player.position));
          }
          if (nd < 320) {
            g.player.speed = 0;
            this.step(10); steps += 10; holdSteps += 10;
            continue;
          }
        }
        holdSteps = 0;

        if (finalRun) {
          const before = dist;
          g.lookAlong(st.position.clone().sub(g.player.position));
          this.alignRoll();
          g.player.speed = 80;
          this.step(4); steps += 4;
          if (g.player.position.distanceTo(st.position) > before + 150) {
            finalRun = false;
            bumps += 1;
          }
        } else if (dist > 6000) {
          g.lookAlong(gate.clone().sub(g.player.position));
          g.player.speed = 400;
          if (!g.massLocked()) g.state.session.torusEngaged = true;
          this.step(20); steps += 20;
        } else if (g.player.position.distanceTo(gate) > 60) {
          g.state.session.torusEngaged = false;
          g.lookAlong(gate.clone().sub(g.player.position));
          g.player.speed = Math.min(300, g.player.position.distanceTo(gate) * 0.5 + 40);
          this.step(6); steps += 6;
        } else {
          finalRun = true;
          runs += 1;
        }
        if (steps % 1500 === 0) await sleep(0);
      }
      if (g.mode !== 'docked' && g.mode !== 'dead') {
        this.recordDockGiveUp({ steps, maxSteps, finalRun, blockaded, holdSteps,
          combatSteps, runs, bumps, minDist });
      }
      return steps;
    },

    /**
     * The one line at the give-up that TODO 60 asked for.
     *
     * Where the ship was, what the approach thought it was doing, and what was
     * shooting at it. `minDist`/`runs`/`bumps` are what separate the three
     * candidate causes: never getting close (minDist stays large), a final run
     * that oscillates (many runs, many bumps, minDist at the hull), or a
     * blockade holding it off (blockaded/holdSteps with a hostile in the lap).
     */
    dockFailures: [],

    recordDockGiveUp(m) {
      const st = g.world.station;
      const slotN = new V(0, 0, -1).applyQuaternion(st.quaternion);
      const gate = st.position.clone().addScaledVector(slotN, 800);
      const near = this.nearestHostile(Infinity);
      // how far the wings are off the slot's long axis, docking.ts's measure
      const qRel = st.quaternion.clone().invert().multiply(g.player.quaternion);
      const right = new V(1, 0, 0).applyQuaternion(qRel);
      const rec = {
        day: g.commander.day,
        system: g.systems[g.commander.systemIndex].name,
        mode: g.mode,
        steps: m.steps,
        budget: m.maxSteps,
        dist: Math.round(g.player.position.distanceTo(st.position)),
        gateDist: Math.round(g.player.position.distanceTo(gate)),
        minDist: Math.round(m.minDist),
        finalRun: m.finalRun,
        runs: m.runs,
        bumps: m.bumps,
        blockaded: m.blockaded,
        holdSteps: m.holdSteps,
        combatSteps: m.combatSteps,
        rollOffset: +Math.atan2(Math.abs(right.x), Math.abs(right.y)).toFixed(2),
        hostile: near
          ? `${near.role}@${Math.round(near.object.position.distanceTo(g.player.position))}`
          : 'none',
      };
      this.dockFailures.push(rec);
      console.warn('dock give-up', rec);
      this.fail(`failed to dock within step budget — ${m.steps} steps, `
        + `${rec.dist} from the station (closest ${rec.minDist}), `
        + `${m.runs} final runs, ${m.bumps} bounced, roll off by ${rec.rollOffset} rad, `
        + `hostile ${rec.hostile}`);
      return rec;
    },

    /**
     * Roll the wings onto the slot's long axis — docking.ts's test, not a
     * paraphrase of it.
     *
     * `rollAlignedWithSlot` measures `atan2(|right.x|, |right.y|)` in the
     * STATION's frame, so the wings have to lie along the station's local Y.
     * This used to drive `atan2(right.y, right.x)` to zero, which aims at the
     * local X — a quarter turn wrong ever since TODO 25 brought the exact hulls
     * and turned the letterbox upright. It did not simply always miss, which is
     * why it survived: rolling about the ship's own Z mixes `right` with the
     * ship's up, so the map was `φ → 2φ` and the offset wandered (measured from
     * the gate: 0.66, 0.26, 1.05, 0.54, 0.5, 0.58 rad against a 0.65 tolerance)
     * rather than converging. Every final run was a coin toss, and a lost toss
     * is a slotMiss: bounced to 420, hull damage, and round again.
     *
     * Rolling by θ about the ship's Z takes `right` to `cosθ·right + sinθ·up`,
     * so the x-component in the station frame vanishes at
     * `θ = atan2(-right.x, up.x)` — one step, either handedness, offset 0.
     */
    alignRoll() {
      const st = g.world.station;
      const qRel = st.quaternion.clone().invert().multiply(g.player.quaternion);
      const right = new V(1, 0, 0).applyQuaternion(qRel);
      const up = new V(0, 1, 0).applyQuaternion(qRel);
      g.player.quaternion.multiply(
        new Q().setFromAxisAngle(new V(0, 0, 1), Math.atan2(-right.x, up.x)));
    },

    /** Detour to any hermit we can see — exercises the encounter. */
    async visitHermitIfNear() {
      const hermit = g.npcs.find((n) => n.state.alive && n.role === 'hermit' &&
        n.object.position.distanceTo(g.player.position) < 20000);
      if (!hermit) return false;
      for (let i = 0; i < 900 && g.mode === 'flight'; i++) {
        const d = g.player.position.distanceTo(hermit.object.position);
        g.lookAlong(hermit.object.position.clone().sub(g.player.position));
        if (d > 3000) {
          g.player.speed = 400;
          if (!g.massLocked()) g.state.session.torusEngaged = true;
        } else {
          g.state.session.torusEngaged = false;
          g.player.speed = d > 500 ? 120 : 15;
        }
        this.step(6);
        if (g.hermitTrading) break;
      }
      if (g.hermitTrading) {
        this.note('encounter:hermit');
        const taps = this.leaveScreens();
        if (taps !== 1) this.fail(`leaving the hermit took ${taps} escapes, not one`);
        return true;
      }
      return false;
    },

    /**
     * Back out to the world, however deep the stack is.
     *
     * `Game.mode` is DERIVED from the screen stack (invariant 13), and every
     * flight loop in this file is `while (g.mode === 'flight')`. So a screen
     * left open does not slow the agent down — it stops it dead, and then the
     * next loop reports the fault as whatever IT was trying to do. That is how
     * one duplicated `screens.open('market')` in the hermit trade came back as
     * "failed to dock", 16 km out, with zero steps flown.
     *
     * Bounded, and it counts: Escape is edge-triggered, and one that lands on
     * the wrong frame is the same hazard `reviveFromDeath` avoids. A stack that
     * needs more than one is a finding, not something to absorb quietly.
     */
    leaveScreens() {
      const world = ['flight', 'docked', 'dead'];
      let taps = 0;
      while (taps < 8 && !world.includes(g.mode)) {
        g.input.injectPress('Escape');
        this.step(4);
        taps += 1;
      }
      return taps;
    },

    async jumpTo(index) {
      g.chart.targetIndex = index;
      g.startHyperspace();
      this.step(170);
      for (let tries = 0; g.witchspace && tries < 3; tries++) {
        this.note('encounter:witchspace');
        if (g.commander.fuel < 10) break; // no fuel to jump clear
        g.startHyperspace();
        for (let i = 0; i < 220 && g.mode === 'flight'; i++) {
          const t = this.nearestHostile(6000);
          if (t) this.combatStep(t, 1 / 30);
          g.update(1 / 30, performance.now() / 1000 + i / 30);
        }
        this.checkInvariants();
      }
      // stranded: call for the tow rather than drifting forever
      if (g.witchspace) {
        this.note('encounter:distress-beacon');
        g.sendDistressBeacon();
        for (let i = 0; i < 2000 && g.witchspace && g.mode === 'flight'; i++) {
          const t = this.nearestHostile(6000);
          if (t) this.combatStep(t, 1 / 30);
          g.update(1 / 30, performance.now() / 1000 + i / 30);
        }
        this.checkInvariants();
      }
    },

    // ---- the main loop --------------------------------------------------

    async run({ legs = 20, log = false, dockSteps = 20000, dockRetries = 2 } = {}) {
      // NOTHING THIS HARNESS DOES CAN REACH YOUR SAVES, and it is not a
      // convention any more.
      //
      // It used to run in the last numbered slot and put the pointer back in a
      // `finally`. That was still not safe: the game autosaves the whole world
      // every 20 seconds, so a tab left running after the harness finished
      // wrote over the restore — which is exactly how a real commander was
      // lost. `useHarnessSaves()` switches the whole page, the running game
      // included, into the `elite-web-harness-` namespace, ONE WAY. There is no
      // call that undoes it and nothing to put back: a crash, a forgotten
      // `finally` or a tab left open cannot leak, because from this line on the
      // program cannot compute a player's key. Reload to play your career.
      useHarnessSaves();
      clearHarnessSaves();
      this.violations = [];
      this.seen = new Set();
      this.dockFailures = [];
      const history = [];
      const start = performance.now();
      let ended = null;

      try {
        g.respawn();
        let deaths = 0;

        for (let leg = 0; leg < legs; leg++) {
          if (g.mode === 'dead') { deaths += 1; this.reviveFromDeath(); }
          if (g.mode !== 'docked') {
            await this.flyToStationAndDock(dockSteps);
            // dying on the way in is a death, not a strand: reload the last
            // station save and press on, exactly as a player would
            if (g.mode === 'dead') { deaths += 1; this.reviveFromDeath(); }
            // A dock that fails is a legitimate outcome for a bot, and it is
            // ONE fault: recordDockGiveUp has already written the line saying
            // what the approach was doing when it gave up. It used to fall
            // through into the strand test, so one failure to arrive became
            // three violations and the first — the only one with any evidence
            // in it — was buried. Reload the last station checkpoint and press
            // on, as a player would; a run that cannot dock `dockRetries`
            // times ends saying THAT, and only a reload that does not put us
            // back at a station is a strand.
            if (g.mode !== 'docked') {
              if (this.dockFailures.length >= dockRetries) {
                ended = `gave up docking ${this.dockFailures.length} times`;
                break;
              }
              this.note('dock:reloaded-station-save');
              g.respawn();
              this.step(4);
            }
            if (g.mode !== 'docked') { this.fail('stranded — abandoning run'); ended = 'stranded'; break; }
          }

          // --- station business ---
          // cash up and refuel first, so the range check below reflects what
          // this commander can actually afford rather than what's in the hold
          this.liquidate();
          const contract = this.takeContract();
          this.equip();
          // where next? contract destination, else a profitable neighbour
          let dest = contract ? contract.destination
            : g.commander.contracts[0]?.destination ?? null;
          if (dest === null || dest === g.commander.systemIndex) {
            const here = g.systems[g.commander.systemIndex];
            const reach = g.systems.filter((s) => {
              // navigation.ts owns the 1984 chart metric; this was a fifth copy
              const d = distanceTenths(here, s);
              return s.index !== here.index && d > 0 && d <= g.commander.fuel;
            });
            if (!reach.length) { this.fail('no system in fuel range'); break; }
            dest = reach[Math.floor(Math.random() * reach.length)].index;
          }
          this.trade(dest);

          const before = { credits: g.commander.credits, day: g.commander.day };
          const spentOnCargo = this.lastSpend;
          g.launch();
          this.step(90);
          this.note('flight:launched');

          if (Math.random() < 0.4) await this.visitHermitIfNear();

          await this.jumpTo(dest);
          this.note('flight:jumped');
          await this.flyToStationAndDock(dockSteps);

          history.push({
            leg: leg + 1,
            system: g.systems[g.commander.systemIndex].name,
            credits: +(g.commander.credits / 10).toFixed(1),
            delta: +((g.commander.credits - before.credits) / 10).toFixed(1),
            cargoSpend: +(spentOnCargo / 10).toFixed(1),
            days: g.commander.day - before.day,
            kills: g.commander.kills,
            docked: g.mode === 'docked',
          });
          if (log) console.log(history[history.length - 1]);
          await sleep(0);
        }

        const c = g.commander;
        this.history = history;
        this.report = {
          legsCompleted: history.length,
          endedBecause: ended ?? 'ran the legs asked for',
          dockFailures: this.dockFailures,
          finalCredits: +(c.credits / 10).toFixed(1),
          kills: c.kills,
          deaths,
          daysElapsed: c.day,
          contractsOutstanding: c.contracts.length,
          equipment: Object.entries(c.equipment).filter(([, v]) => v && v !== 'pulse').map(([k]) => k),
          systemsVisited: new Set(history.map((h) => h.system)).size,
          systemsExercised: [...this.seen].sort(),
          invariantViolations: this.violations,
          seconds: +((performance.now() - start) / 1000).toFixed(1),
        };
        console.log('%c=== PLAYTEST REPORT ===', 'color:#4dff5c');
        console.table(history);
        console.log(this.report);
        if (this.violations.length) {
          console.warn(`${this.violations.length} invariant violation(s):`, this.violations);
        } else {
          console.log('%cno invariant violations', 'color:#4dff5c');
        }
        return this.report;
      } finally {
        clearHarnessSaves();
        console.log(`ran entirely in ${saveNamespace()}*; your saves were never`
          + ' addressable from this page — reload it to play your career');
      }
    },
  };

  console.log('playtest agent loaded: await __playtest.run({ legs: 20 })');
})();
