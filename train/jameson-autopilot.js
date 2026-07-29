/**
 * The Commander Jameson autopilot — the end-to-end economy/combat test
 * harness behind docs/JAMESON-TRIALS.md.
 *
 * Usage: open the game (npm run dev → localhost:5173), open DevTools,
 * paste this whole file into the console, then:
 *
 *   await __auto.runTrial('Lave', 'Leesti', 6)
 *
 * It backs up your commander save, spawns a fresh 100.0 Cr Jameson, flies
 * N trading legs between the two systems (combat handled by the trained
 * jameson-defend policy via window.__policyKit), prints a ledger, and
 * restores your save. Everything runs through real game mechanics — real
 * markets, fuel, pirates, witch-space, docking physics, legal system. The
 * only concession is perfectly-aligned docking approaches (a stand-in for
 * the docking computer).
 */
(async () => {
  const g = window.__game;
  const kit = window.__policyKit;
  if (!g || !kit) { console.error('open the game first'); return; }
  const V = g.player.position.clone().constructor;
  const Q = g.player.quaternion.clone().constructor;
  const stepN = (n, dt = 1 / 30) => { for (let i = 0; i < n; i++) g.update(dt, performance.now() / 1000 + i * dt); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // The rules, from the modules that own them. A console paste cannot use a
  // static `import`, but it can use a dynamic one against the dev server —
  // which is how the commodity table, the contraband list and the autopilot's
  // turn rates stop being copies kept in step by hope.
  const [galaxyMod, contractsMod, lawMod, ccMod, storageMod] = await Promise.all([
    import('/src/galaxy/galaxy.ts'),
    import('/src/game/contracts.ts'),
    import('/src/game/law.ts'),
    import('/src/game/combat-computer.ts'),
    import('/src/game/storage.ts'),
  ]);
  const { COMMODITIES, generateMarket } = galaxyMod;
  const { applyMarketPressure } = contractsMod;
  const { isContraband } = lawMod;
  const { CC_MAX_PITCH, CC_MAX_ROLL, CC_MAX_SPEED, CC_ACCEL, ccRamp } = ccMod;
  const { slotKeys } = storageMod;

  const isTonne = (i) => COMMODITIES[i].unit === 't';

  /**
   * What `index` pays per commodity, averaged over every fluctuation byte.
   *
   * This was a transcribed [basePrice, gradient, mask] table and
   * `(base + mask/2 + econ*gradient) * 0.4` — the 1984 formula with the
   * `& 0xff` byte wrap left off, and with no knowledge of the living galaxy's
   * ±25% price pressure at the far end. Of the two, the pressure was the one
   * distorting every leg: the wrap only bites Narcotics (overvalued by up to
   * 140.8 Cr), which is contraband and skipped anyway. It now runs galaxy.ts's
   * own model over all 256 fluctuations with contracts.ts's pressure on top,
   * which is exactly what the destination will quote.
   */
  const expectedPrices = (index) => {
    const mean = COMMODITIES.map(() => 0);
    for (let f = 0; f < 256; f++) {
      const m = applyMarketPressure(
        generateMarket(g.systems[index], f),
        (i) => g.living.priceMultiplier(index, i));
      for (let i = 0; i < m.length; i++) mean[i] += m[i].price / 256;
    }
    return mean;
  };

  const auto = window.__auto = {
    log: [],
    obsBuf: new Float32Array(18),
    scratch: kit.makeScratch(),
    cPitch: 0, cRoll: 0, cTimer: 0, cControl: null,
    meView: { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, speed: 0,
      cls: { maxSpeed: 220, turnRate: 0.5 }, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0 },
    tgView: { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, speed: 280,
      cls: { maxSpeed: 300, turnRate: 1.1 }, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0 },

    cargoTonnes() {
      return g.commander.cargo.reduce((s, q, i) => s + (isTonne(i) ? q : 0), 0);
    },

    buyBest(destIndex) {
      // Refuel through the REAL purchase path. This file is pasted into the
      // console and cannot import FUEL_PRICE, so recomputing `need * 0.4` here
      // was a fourth copy of the pricing rule waiting to drift. buyEquipment
      // charges the right amount and checks affordability itself — and what it
      // charged is the difference, which is also how the fuel cost gets into
      // the ledger. It used to be read from `fuelNeed`/`fuelCost`, two
      // variables that no longer existed: buyBest threw a ReferenceError on
      // every call and no trial had run since.
      const beforeFuel = g.commander.credits;
      g.buyEquipment('fuel');
      const fuelCost = beforeFuel - g.commander.credits;

      const expect = expectedPrices(destIndex);
      let best = -1, bestScore = 0.5;
      for (let i = 0; i < COMMODITIES.length; i++) {
        // law.ts owns the contraband set; this was the literal [3, 6, 10]
        if (isContraband(i) || !isTonne(i)) continue;
        const m = g.market[i];
        if (m.quantity <= 0) continue;
        const cost = Math.round(m.price * 10);
        const units = Math.min(m.quantity, Math.floor(g.commander.credits / cost), 20 - this.cargoTonnes());
        if (units <= 0) continue;
        const score = units * (expect[i] - m.price);
        if (score > bestScore) { bestScore = score; best = i; }
      }
      let bought = 0, spent = 0;
      if (best >= 0) {
        const m = g.market[best];
        while (m.quantity > 0 && this.cargoTonnes() < 20) {
          const cost = Math.round(m.price * 10);
          if (g.commander.credits < cost) break;
          m.quantity--; g.commander.cargo[best]++; g.commander.credits -= cost;
          bought++; spent += cost;
        }
      }
      return { commodity: best, bought, spent, fuelCost };
    },

    sellAll() {
      let revenue = 0;
      for (let i = 0; i < COMMODITIES.length; i++) {
        const m = g.market[i];
        while (g.commander.cargo[i] > 0) {
          g.commander.cargo[i]--; m.quantity++;
          revenue += Math.round(m.price * 10);
        }
      }
      g.commander.credits += revenue; // MkII died wishing for this line
      return revenue;
    },

    alignRollOnly() {
      const st = g.world.station;
      const qRel = st.quaternion.clone().invert().multiply(g.player.quaternion);
      const right = new V(1, 0, 0).applyQuaternion(qRel);
      g.player.quaternion.multiply(new Q().setFromAxisAngle(new V(0, 0, 1), -Math.atan2(right.y, right.x)));
    },

    nearestHostile(range) {
      let best = null, bestD = range;
      for (const n of g.npcs) {
        if (!n.alive || (n.role !== 'pirate' && n.role !== 'thargoid' && n.role !== 'thargon')) continue;
        const d = n.object.position.distanceTo(g.player.position);
        if (d < bestD) { bestD = d; best = n; }
      }
      return best;
    },

    /** One combat step: the jameson-defend brain flies the player's ship. */
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
      // Trader-Cobra dynamics: the distribution the policy trained in, and
      // therefore also what the purchasable combat computer flies. These were
      // written out here as 0.5*1.4, 0.5*2.4, 220 and 100 — byte-identical to
      // combat-computer.ts's caps, which is why importing them changes no
      // measurement in docs/JAMESON-TRIALS.md; it only removes the copy.
      // (playtest.js and gang-trial.js are different: they claim to measure
      // what a COMMANDER survives, so they fly src/player.ts's numbers.)
      this.cPitch = ccRamp(this.cPitch, c.pitch * CC_MAX_PITCH, c.pitch !== 0, dt);
      this.cRoll = ccRamp(this.cRoll, c.roll * CC_MAX_ROLL, c.roll !== 0, dt);
      if (c.throttle > 0) g.player.speed = Math.min(CC_MAX_SPEED, g.player.speed + CC_ACCEL * dt);
      if (c.throttle < 0) g.player.speed = Math.max(0, g.player.speed - CC_ACCEL * dt);
      if (this.cRoll) g.player.quaternion.multiply(new Q().setFromAxisAngle(new V(0, 0, 1), this.cRoll * dt));
      if (this.cPitch) g.player.quaternion.multiply(new Q().setFromAxisAngle(new V(1, 0, 0), this.cPitch * dt));
      if (c.fire) g.fireLaser();
    },

    async flyToStationAndDock(maxSteps = 20000) {
      const events = [];
      let steps = 0, bounces = 0, finalRun = false, combatTicks = 0;
      let maxHostiles = 0, hullMin = 6;
      const killsBefore = g.commander.kills;
      while (g.mode === 'flight' && steps < maxSteps) {
        const st = g.world.station;
        const slotN = new V(0, 0, -1).applyQuaternion(st.quaternion);
        const dist = g.player.position.distanceTo(st.position);
        const gate = st.position.clone().addScaledVector(slotN, 800);
        const hostiles = g.npcs.filter((n) => n.alive && (n.role === 'pirate' || n.role === 'thargoid') &&
          n.object.position.distanceTo(g.player.position) < 9000).length;
        maxHostiles = Math.max(maxHostiles, hostiles);
        hullMin = Math.min(hullMin, g.foreShield + g.aftShield + g.energy);

        // combat: hand the ship to the defence brain when pirates close in
        const threat = dist > 3000 ? this.nearestHostile(4500) : null;
        if (threat) {
          g.torusEngaged = false;
          finalRun = false;
          for (let i = 0; i < 8 && g.mode === 'flight'; i++) {
            this.combatStep(threat, 1 / 30);
            g.update(1 / 30, performance.now() / 1000 + i / 30);
            if (!threat.alive) break;
          }
          steps += 8; combatTicks += 8;
          if (steps % 1200 === 0) await sleep(0);
          continue;
        }

        // traffic hold: never ram anything (RIP MkII)
        if (dist < 6000) {
          let nd = Infinity;
          for (const n of g.npcs) if (n.alive) nd = Math.min(nd, n.object.position.distanceTo(g.player.position));
          if (nd < 320) { g.player.speed = 0; stepN(10); steps += 10; continue; }
        }

        if (finalRun) {
          const before = dist;
          g.lookAlong(st.position.clone().sub(g.player.position));
          this.alignRollOnly();
          g.player.speed = 80;
          stepN(4); steps += 4;
          if (g.player.position.distanceTo(st.position) > before + 150) { bounces++; finalRun = false; }
        } else if (dist > 6000) {
          g.lookAlong(gate.clone().sub(g.player.position));
          g.player.speed = 400;
          if (!g.massLocked()) g.torusEngaged = true;
          stepN(20); steps += 20;
        } else if (g.player.position.distanceTo(gate) > 60) {
          g.torusEngaged = false;
          g.lookAlong(gate.clone().sub(g.player.position));
          g.player.speed = Math.min(300, g.player.position.distanceTo(gate) * 0.5 + 40);
          stepN(6); steps += 6;
        } else {
          finalRun = true; // latched — no gate-seek oscillation
        }
        if (steps % 1200 === 0) await sleep(0);
      }
      const kills = g.commander.kills - killsBefore;
      if (maxHostiles) events.push(`pirates: ${maxHostiles}`);
      if (combatTicks) events.push(`combat: ${(combatTicks / 30).toFixed(0)}s`);
      if (kills) events.push(`KILLS: ${kills}`);
      if (hullMin < 5.9) events.push(`hull low: ${hullMin.toFixed(1)}/6`);
      if (bounces) events.push(`bounces: ${bounces}`);
      if (g.mode !== 'docked') events.push('FAILED TO DOCK');
      return events;
    },

    async jumpTo(targetIndex) {
      const events = [];
      g.chart.targetIndex = targetIndex;
      g.startHyperspace();
      stepN(170);
      for (let tries = 0; g.witchspace && tries < 3; tries++) {
        events.push('WITCH-SPACE');
        g.startHyperspace();
        for (let i = 0; i < 200 && g.mode === 'flight'; i++) {
          const t = this.nearestHostile(6000);
          if (t) this.combatStep(t, 1 / 30);
          g.update(1 / 30, performance.now() / 1000 + i / 30);
        }
      }
      return events;
    },

    async leg(destIndex) {
      const from = g.systems[g.commander.systemIndex].name;
      if (g.mode === 'docked') this.sellAll();
      const buy = this.buyBest(destIndex);
      const creditsStart = g.commander.credits;
      g.launch();
      stepN(80);
      const jumpEvents = await this.jumpTo(destIndex);
      const dockEvents = await this.flyToStationAndDock();
      let revenue = 0;
      if (g.mode === 'docked') revenue = this.sellAll();
      const rec = {
        leg: `${from} -> ${g.systems[g.commander.systemIndex].name}`,
        cargo: buy.commodity >= 0 ? `${buy.bought}t ${COMMODITIES[buy.commodity].name}` : 'empty',
        tradeProfit: +((revenue - buy.spent - buy.fuelCost) / 10).toFixed(1),
        bounty: +((g.commander.credits - creditsStart - revenue) / 10).toFixed(1),
        credits: +(g.commander.credits / 10).toFixed(1),
        events: [...jumpEvents, ...dockEvents],
      };
      this.log.push(rec);
      console.log(rec);
      return rec;
    },

    /** The full experiment: fresh commander, N legs, ledger, save restored. */
    async runTrial(systemA, systemB, legs = 6) {
      const a = g.systems.findIndex((s) => s.name === systemA);
      const b = g.systems.findIndex((s) => s.name === systemB);
      if (a < 0 || b < 0) { console.error('unknown system name'); return; }
      // The commander lives in a SLOT (storage.ts) — `elite-web-commander:1`
      // by default, with the mid-flight world beside it. This backed up and
      // cleared the pre-slots `elite-web-commander`, which no loader has read
      // since slots arrived, so `respawn()` reloaded the player's OWN
      // commander rather than a fresh Jameson, every dock overwrote the real
      // save, and the restore put it somewhere nothing looks.
      const keys = Object.values(slotKeys());
      const backup = keys.map((k) => localStorage.getItem(k));
      try {
        for (const k of keys) localStorage.removeItem(k);
        g.respawn(); // fresh 100.0 Cr Jameson at Lave
        this.log = [];
        console.log(`Commander Jameson reporting. ${legs} legs, ${systemA} <-> ${systemB}.`);
        for (let i = 0; i < legs; i++) {
          if (g.mode !== 'docked') {
            // not docked: either dead, or a failed dock — one retry
            if (g.mode === 'flight') await this.flyToStationAndDock();
            if (g.mode !== 'docked') { console.log('RUN OVER:', g.mode); break; }
          }
          const dest = g.commander.systemIndex === a ? b : a;
          await this.leg(dest);
        }
        console.table(this.log);
        console.log(`Final: ${(g.commander.credits / 10).toFixed(1)} Cr, ` +
          `${g.commander.kills} kills, legal ${g.commander.legalStatus}, ${g.mode}`);
        return this.log;
      } finally {
        keys.forEach((k, i) => {
          if (backup[i] === null) localStorage.removeItem(k);
          else localStorage.setItem(k, backup[i]);
        });
        console.log('your commander save is restored — reload the page');
      }
    },
  };
  console.log('Jameson autopilot loaded: await __auto.runTrial("Lave", "Leesti", 6)');
})();
