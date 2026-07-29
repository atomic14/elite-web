/**
 * Can a commander survive an organised gang? — measured in the real game.
 *
 *   fetch('/test/gang-trial.js').then(r => r.text()).then(eval)
 *   await __gangTrial.run({ trials: 20 })
 *   await __gangTrial.run({ trials: 20, gang: 4 })
 *   await __gangTrial.run({ trials: 20, organised: false })   // solo-brain control
 *
 * Why this exists when train/survivability.ts already answers it: because that
 * answer is built on two approximations pointing in opposite directions, and
 * neither is small.
 *
 * The sim UNDERSTATES the gang. `src/ai-training/core.ts` only models two pirate
 * hulls, pirateCobra (hp 1.1) and pirateSidewinder (0.55), and has no
 * missiles. A real tier-2 gang flies Fer-de-Lance, Asp and Python — hp 1.3 to
 * 1.8, turn rates up to 1.2 — and every one of them carries missiles, which do
 * 1.3 damage a hit against a commander who soaks about 3.0 in total.
 *
 * The sim OVERSTATES it too, in the other direction: its defender is a
 * traderCobra with hp 1.0 and no shields at all, where the player has fore and
 * aft shields plus an energy bank.
 *
 * So the honest thing is to stop approximating and fly it. This spawns real
 * gangs with the real hull table (imported, not copied, so it cannot drift),
 * flies the player with the same trained defence policy the tournament used,
 * and steps the actual game loop.
 *
 * Still not a human: the defence brain does not use ECM, missiles, the energy
 * bomb or the torus drive, and never runs away. Every one of those favours a
 * real player, so read the survival figure as a floor.
 *
 * Backs up the commander to localStorage under a separate key and restores it
 * at the end — a key, not a variable, so it survives a page reload. Death here
 * is real: with an escape pod fitted, dying calls enterDocked(), which SAVES.
 */
(async () => {
  const g = window.__game;
  const kit = window.__policyKit;
  if (!g || !kit) { console.error('open the game first'); return; }

  const V = g.player.position.clone().constructor;
  const Q = g.player.quaternion.clone().constructor;
  const { pirateSpecForTier } = await import('/src/game/npc.ts');
  const { memberTier } = await import('/src/game/contracts.ts');

  const SLOT = 'elite-web-commander:' + (localStorage.getItem('elite-web-slot') ?? '1');
  const BACKUP = 'claude-backup:' + SLOT;

  const gt = window.__gangTrial = {
    backup() {
      if (!localStorage.getItem(BACKUP)) localStorage.setItem(BACKUP, localStorage.getItem(SLOT));
      return localStorage.getItem(BACKUP) !== null;
    },
    restore() {
      const b = localStorage.getItem(BACKUP);
      if (b === null) return false;
      localStorage.setItem(SLOT, b);
      localStorage.removeItem(BACKUP);
      return true;
    },

    clearWorld() {
      for (const n of g.npcs) g.scene.remove(n.object);
      g.npcs.length = 0;
    },

    /**
     * Get into flight properly. Setting `mode = 'flight'` by hand is not
     * enough — the first trial reported a death on frame one with full
     * shields, because a docked game puts the mode straight back and the
     * loop read that as "no longer flying".
     */
    ensureFlying() {
      if (g.mode === 'docked') {
        g.launch();
        for (let i = 0; i < 120; i++) g.update(1 / 60, performance.now() / 1000 + i / 60);
      }
    },

    /** One fight, to the death or to `maxT` seconds. */
    trial({ gang, organised, seed, maxT }) {
      this.ensureFlying();
      this.clearWorld();
      // Well away from the station: its guns, its police and its docking
      // trigger would all otherwise join in and this is meant to measure the
      // gang, not the navy.
      g.player.position.copy(g.world.station.position).add(new V(90000, 40000, 90000));
      g.player.quaternion.identity();
      g.player.speed = 200;
      // full shields and a full energy bank: the best case a commander gets
      g.foreShield = 1; g.aftShield = 1; g.energy = 4;
      g.laserTemp = 0; g.laserCooldown = 0;

      // only the ships we spawned count — the game keeps seeding traffic of
      // its own during a 45s fight, and one early trial reported 4 of 3 alive
      const mine = [];
      for (let i = 0; i < gang; i++) {
        const a = (i / gang) * Math.PI * 2 + seed * 0.7;
        const d = 1500 + ((seed * 37 + i * 113) % 1200);
        // RELATIVE to the player. Absolute coordinates put the gang 130,000
        // units away from a commander parked out by the station, and three
        // trials passed in perfect silence before that showed up — no damage
        // either way, which is the shape of a broken harness, not a result.
        const pos = g.player.position.clone()
          .add(new V(Math.cos(a) * d, ((seed + i) % 7 - 3) * 120, Math.sin(a) * d));
        // ringleaders first, then the hangers-on — exactly as game.ts does it
        const mt = memberTier(2, i);
        const npc = g.spawnNpc('pirate', pos, seed * 10 + i, pirateSpecForTier(mt, seed * 10 + i));
        npc.organised = organised;
        npc.threatTier = mt;
        mine.push(npc);
      }

      const dt = 1 / 60;
      const obsBuf = new Float32Array(32);
      const scratch = kit.makeScratch();
      // `cls` is required by observe() — it normalises speeds and turn rates
      // by the ship's own limits. Same values playtest.js uses: the player as
      // traderCobra (what jameson-defend was trained flying), the attacker as
      // a fast pirate. Filled per-target below from the real hull.
      const me = { pos: new V(), quat: new Q(), speed: 0, cls: { maxSpeed: 220, turnRate: 0.5 },
        laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0 };
      const tv = { pos: new V(), quat: new Q(), speed: 280, cls: { maxSpeed: 300, turnRate: 1.1 },
        laserTemp: 0, laserCooldown: 0, pitchRate: 0, rollRate: 0 };
      let cPitch = 0, cRoll = 0, control = null, cTimer = 0;
      let t = 0;
      const t0 = performance.now() / 1000;

      while (t < maxT) {
        // nearest living pirate is the target
        let target = null, best = Infinity;
        for (const n of mine) {
          if (!n.alive) continue;
          const d = n.object.position.distanceTo(g.player.position);
          if (d < best) { best = d; target = n; }
        }
        if (!target) break;                      // all dead: the commander won

        cTimer -= dt;
        if (!control || cTimer <= 0) {
          cTimer = 0.1;
          me.pos.copy(g.player.position); me.quat.copy(g.player.quaternion);
          me.speed = g.player.speed; me.laserTemp = g.laserTemp; me.laserCooldown = g.laserCooldown;
          me.pitchRate = cPitch; me.rollRate = cRoll;
          tv.pos.copy(target.object.position); tv.quat.copy(target.object.quaternion);
          tv.speed = target.speed ?? 280;
          tv.cls.maxSpeed = target.spec?.maxSpeed ?? 300;
          tv.cls.turnRate = target.spec?.turnRate ?? 1.1;
          control = kit.act(kit.defendBrain, kit.observe(me, tv, obsBuf), scratch);
        }
        const maxPitch = 0.7, maxRoll = 1.2;
        const ramp = (cur, tgt, active) => {
          const nx = cur + (tgt - cur) * Math.min(1, (active ? 4 : 5) * dt);
          return Math.abs(nx) < 0.001 && !active ? 0 : nx;
        };
        cPitch = ramp(cPitch, control.pitch * maxPitch, control.pitch !== 0);
        cRoll = ramp(cRoll, control.roll * maxRoll, control.roll !== 0);
        if (control.throttle > 0) g.player.speed = Math.min(300, g.player.speed + 120 * dt);
        if (control.throttle < 0) g.player.speed = Math.max(0, g.player.speed - 120 * dt);
        if (cRoll) g.player.quaternion.multiply(new Q().setFromAxisAngle(new V(0, 0, 1), cRoll * dt));
        if (cPitch) g.player.quaternion.multiply(new Q().setFromAxisAngle(new V(1, 0, 0), cPitch * dt));
        if (control.fire) g.fireLaser();

        g.update(dt, t0 + t);
        t += dt;
        if (g.mode !== 'flight') break;          // dead, or the pod launched us
      }

      const killed = mine.filter((n) => !n.alive).length;
      const alive = mine.filter((n) => n.alive).length;
      return { died: g.mode !== 'flight', t, killed, alive, shield: g.foreShield, energy: g.energy };
    },

    async run({ trials = 12, gang = 3, organised = true, maxT = 30 } = {}) {
      if (!this.backup()) { console.error('could not back up the commander — aborting'); return; }
      const hadPod = g.commander.equipment.escapePod;
      // A pod turns a death into a docking, which both hides the result and
      // SAVES. Off for the duration; the backup puts it back.
      g.commander.equipment.escapePod = false;

      const out = [];
      // Progress is published because these runs are slow enough to look
      // hung: each trial steps the real game loop maxT*60 times, and the game
      // is doing all its NPC, collision and effects work every one of them.
      const prog = window.__gangProgress = { done: 0, of: trials, secsPerTrial: 0 };
      try {
        for (let i = 0; i < trials; i++) {
          const t0 = performance.now();
          out.push(this.trial({ gang, organised, seed: i + 1, maxT }));
          prog.done = i + 1;
          prog.secsPerTrial = ((performance.now() - t0) / 1000).toFixed(1);
          await new Promise((r) => setTimeout(r, 0));   // let the tab breathe
        }
      } finally {
        g.commander.equipment.escapePod = hadPod;
        this.clearWorld();
        this.restore();
      }

      const deaths = out.filter((r) => r.died);
      const wins = out.filter((r) => !r.died && r.alive === 0);
      const mean = (a, f) => (a.length ? a.reduce((s, r) => s + f(r), 0) / a.length : 0);
      const report = {
        config: `gang of ${gang}, ${organised ? 'pack brain (organised)' : 'solo brain (control)'}`,
        trials,
        commanderDied: `${((deaths.length / trials) * 100).toFixed(0)}%`,
        meanTimeToDeath: deaths.length ? mean(deaths, (r) => r.t).toFixed(1) + 's' : '—',
        gangWipedOut: `${((wins.length / trials) * 100).toFixed(0)}%`,
        meanPiratesKilled: mean(out, (r) => r.killed).toFixed(1) + ' of ' + gang,
        survivorsMeanEnergy: mean(out.filter((r) => !r.died), (r) => r.energy).toFixed(2) + ' of 4',
        commanderRestored: localStorage.getItem(BACKUP) === null,
      };
      console.table(report);
      this.last = out;
      return report;
    },
  };

  console.log('__gangTrial ready — await __gangTrial.run({ trials: 20 })');
})();
