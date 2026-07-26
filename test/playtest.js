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
 */
(() => {
  const g = window.__game;
  const kit = window.__policyKit;
  if (!g || !kit) { console.error('open the game first'); return; }

  const V = g.player.position.clone().constructor;
  const Q = g.player.quaternion.clone().constructor;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TONNES = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1];

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
      const tonnes = c.cargo.reduce((s, q, i) => s + (TONNES[i] ? q : 0), 0);
      const cap = c.equipment.largeBay ? 35 : 20;
      if (tonnes > cap) this.fail(`hold overfilled (${tonnes}/${cap})`);
      if (g.energy < -0.001 || g.energy > 4.001) this.fail(`energy out of range (${g.energy})`);
      const modes = ['docked', 'flight', 'market', 'chart', 'local', 'equip',
        'status', 'data', 'contracts', 'dead'];
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
    meView: { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, speed: 0,
      cls: { maxSpeed: 220, turnRate: 0.5 }, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0 },
    tgView: { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, speed: 280,
      cls: { maxSpeed: 300, turnRate: 1.1 }, laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0 },

    nearestHostile(range) {
      let best = null, bestD = range;
      for (const n of g.npcs) {
        if (!n.alive || !['pirate', 'thargoid', 'thargon'].includes(n.role)) continue;
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
      const maxPitch = 0.7, maxRoll = 1.2;
      const ramp = (cur, tgt, active) => {
        const r = active ? 4 : 5;
        const nx = cur + (tgt - cur) * Math.min(1, r * dt);
        return Math.abs(nx) < 0.001 && !active ? 0 : nx;
      };
      this.cPitch = ramp(this.cPitch, c.pitch * maxPitch, c.pitch !== 0);
      this.cRoll = ramp(this.cRoll, c.roll * maxRoll, c.roll !== 0);
      if (c.throttle > 0) g.player.speed = Math.min(300, g.player.speed + 120 * dt);
      if (c.throttle < 0) g.player.speed = Math.max(0, g.player.speed - 120 * dt);
      if (this.cRoll) g.player.quaternion.multiply(new Q().setFromAxisAngle(new V(0, 0, 1), this.cRoll * dt));
      if (this.cPitch) g.player.quaternion.multiply(new Q().setFromAxisAngle(new V(1, 0, 0), this.cPitch * dt));
      if (c.fire) g.fireLaser();
    },

    // ---- station business ---------------------------------------------

    lastSpend: 0,

    cargoTonnes() {
      return g.commander.cargo.reduce((s, q, i) => s + (TONNES[i] ? q : 0), 0);
    },

    /** Take a contract if one looks doable, and report where it wants us. */
    takeContract() {
      const c = g.commander;
      if (c.contracts.length >= 2 || !g.contractOffers.length) return null;
      for (let i = 0; i < g.contractOffers.length; i++) {
        const k = g.contractOffers[i];
        if (k.kind === 'cargo' && this.cargoTonnes() + k.qty > (c.equipment.largeBay ? 35 : 20)) continue;
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

    /** Sell everything, then buy the most profitable legal cargo for `dest`. */
    trade(destIndex) {
      const c = g.commander;
      // sell all non-contract cargo
      const committed = new Map();
      for (const k of c.contracts) {
        if (k.kind === 'cargo') committed.set(k.commodity, (committed.get(k.commodity) ?? 0) + k.qty);
      }
      for (let i = 0; i < 17; i++) {
        const keep = committed.get(i) ?? 0;
        while (c.cargo[i] > keep) {
          c.cargo[i] -= 1;
          g.market[i].quantity += 1;
          c.credits += Math.round(g.market[i].price * 10);
        }
      }
      // refuel
      const need = 70 - c.fuel;
      if (need > 0) {
        const cost = Math.round(need * 0.4);
        if (c.credits >= cost) { c.credits -= cost; c.fuel = 70; }
      }
      // buy for the destination economy
      const dest = g.systems[destIndex];
      const GRAD = [-2, -1, -3, -5, -5, 8, 29, 14, 6, 1, 13, -9, -1, -1, -2, -1, 15];
      const BASE = [0x13, 0x14, 0x41, 0x28, 0x53, 0xc4, 0xeb, 0x9a, 0x75, 0x4e, 0x7c, 0xb0, 0x20, 0x61, 0xab, 0x2d, 0x35];
      const MASK = [1, 3, 7, 31, 15, 3, 120, 3, 7, 31, 7, 63, 3, 7, 31, 15, 7];
      const ILLEGAL = [3, 6, 10];
      let best = -1, bestScore = 0.5;
      for (let i = 0; i < 17; i++) {
        if (ILLEGAL.includes(i) || !TONNES[i] || g.market[i].quantity <= 0) continue;
        const expect = (BASE[i] + MASK[i] / 2 + dest.economy * GRAD[i]) * 0.4;
        const margin = expect - g.market[i].price;
        const cost = Math.round(g.market[i].price * 10);
        const units = Math.min(g.market[i].quantity, Math.floor(c.credits / cost),
          (c.equipment.largeBay ? 35 : 20) - this.cargoTonnes());
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
      while (g.mode === 'flight' && steps < maxSteps) {
        const st = g.world.station;
        const slotN = new V(0, 0, -1).applyQuaternion(st.quaternion);
        const dist = g.player.position.distanceTo(st.position);
        const gate = st.position.clone().addScaledVector(slotN, 800);

        // a fight that won't end is a fight to run from — the defence
        // policy evades rather than kills, so cap the engagement
        const fightingTooLong = combatSteps > 2500;
        const threat = dist > 2500 && !fightingTooLong ? this.nearestHostile(4500) : null;
        if (fightingTooLong && combatSteps < 2600) {
          combatSteps = 2600;
          this.note('combat:disengaged');
        }
        if (threat) {
          if (!fights) this.note('combat:engaged');
          fights += 1;
          g.torusEngaged = false;
          finalRun = false;
          for (let i = 0; i < 8 && g.mode === 'flight'; i++) {
            this.combatStep(threat, 1 / 30);
            g.update(1 / 30, performance.now() / 1000 + i / 30);
            if (!threat.alive) break;
          }
          steps += 8;
          combatSteps += 8;
          this.checkInvariants();
          if (steps % 1500 === 0) await sleep(0);
          continue;
        }

        if (dist < 6000) {
          let nd = Infinity;
          for (const n of g.npcs) if (n.alive) nd = Math.min(nd, n.object.position.distanceTo(g.player.position));
          if (nd < 320) { g.player.speed = 0; this.step(10); steps += 10; continue; }
        }

        if (finalRun) {
          const before = dist;
          g.lookAlong(st.position.clone().sub(g.player.position));
          this.alignRoll();
          g.player.speed = 80;
          this.step(4); steps += 4;
          if (g.player.position.distanceTo(st.position) > before + 150) finalRun = false;
        } else if (dist > 6000) {
          g.lookAlong(gate.clone().sub(g.player.position));
          g.player.speed = 400;
          if (!g.massLocked()) g.torusEngaged = true;
          this.step(20); steps += 20;
        } else if (g.player.position.distanceTo(gate) > 60) {
          g.torusEngaged = false;
          g.lookAlong(gate.clone().sub(g.player.position));
          g.player.speed = Math.min(300, g.player.position.distanceTo(gate) * 0.5 + 40);
          this.step(6); steps += 6;
        } else {
          finalRun = true;
        }
        if (steps % 1500 === 0) await sleep(0);
      }
      if (g.mode !== 'docked' && g.mode !== 'dead') this.fail('failed to dock within step budget');
      return steps;
    },

    alignRoll() {
      const st = g.world.station;
      const qRel = st.quaternion.clone().invert().multiply(g.player.quaternion);
      const right = new V(1, 0, 0).applyQuaternion(qRel);
      g.player.quaternion.multiply(new Q().setFromAxisAngle(new V(0, 0, 1), -Math.atan2(right.y, right.x)));
    },

    /** Detour to any hermit we can see — exercises the encounter. */
    async visitHermitIfNear() {
      const hermit = g.npcs.find((n) => n.alive && n.role === 'hermit' &&
        n.object.position.distanceTo(g.player.position) < 20000);
      if (!hermit) return false;
      for (let i = 0; i < 900 && g.mode === 'flight'; i++) {
        const d = g.player.position.distanceTo(hermit.object.position);
        g.lookAlong(hermit.object.position.clone().sub(g.player.position));
        if (d > 3000) { g.player.speed = 400; if (!g.massLocked()) g.torusEngaged = true; }
        else { g.torusEngaged = false; g.player.speed = d > 500 ? 120 : 15; }
        this.step(6);
        if (g.hermitTrading) break;
      }
      if (g.hermitTrading) {
        this.note('encounter:hermit');
        g.input.injectPress('Escape');
        this.step(4);
        return true;
      }
      return false;
    },

    async jumpTo(index) {
      g.chart.targetIndex = index;
      g.startHyperspace();
      this.step(170);
      for (let tries = 0; g.witchspace && tries < 3; tries++) {
        this.note('encounter:witchspace');
        g.startHyperspace();
        for (let i = 0; i < 220 && g.mode === 'flight'; i++) {
          const t = this.nearestHostile(6000);
          if (t) this.combatStep(t, 1 / 30);
          g.update(1 / 30, performance.now() / 1000 + i / 30);
        }
        this.checkInvariants();
      }
    },

    // ---- the main loop --------------------------------------------------

    async run({ legs = 20, log = false } = {}) {
      const backup = localStorage.getItem('elite-web-commander');
      this.violations = [];
      this.seen = new Set();
      const history = [];
      const start = performance.now();

      try {
        localStorage.removeItem('elite-web-commander');
        g.respawn();
        let deaths = 0;

        for (let leg = 0; leg < legs; leg++) {
          if (g.mode === 'dead') {
            deaths += 1;
            this.note('death');
            g.input.injectPress('Enter');
            this.step(4);
          }
          if (g.mode !== 'docked') {
            await this.flyToStationAndDock();
            if (g.mode !== 'docked') { this.fail('stranded — abandoning run'); break; }
          }

          // --- station business ---
          const contract = this.takeContract();
          this.equip();
          // where next? contract destination, else a profitable neighbour
          let dest = contract ? contract.destination
            : g.commander.contracts[0]?.destination ?? null;
          if (dest === null || dest === g.commander.systemIndex) {
            const here = g.systems[g.commander.systemIndex];
            const reach = g.systems.filter((s) => {
              const dx = s.x - here.x, dy = (s.y - here.y) / 2;
              const d = Math.round(4 * Math.sqrt(dx * dx + dy * dy));
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
          await this.flyToStationAndDock();

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
        if (backup) localStorage.setItem('elite-web-commander', backup);
        else localStorage.removeItem('elite-web-commander');
        console.log('commander save restored — reload the page');
      }
    },
  };

  console.log('playtest agent loaded: await __playtest.run({ legs: 20 })');
})();
