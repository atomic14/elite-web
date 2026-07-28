/**
 * Combat arena — fly waves against bots, and capture how YOU fly.
 *
 *   fetch('/test/combat-recorder.js').then(r => r.text()).then(eval)
 *   fetch('/test/arena.js').then(r => r.text()).then(eval)
 *
 *   __arena.wave()                 // 2 tier-0 pirates, shipped brain
 *   __arena.wave({ n: 3, tier: 1 })
 *   __arena.wave({ n: 3, tier: 2, brain: 'sharp' })
 *   __arena.report()               // every wave so far
 *   __arena.envelope()             // YOUR flight envelope, for training
 *
 * Two jobs.
 *
 * The obvious one: a repeatable fight, so "are these pirates any good" stops
 * depending on whether a reception happened to spawn.
 *
 * The one that matters: `envelope()` measures how the commander actually
 * flies — speed distribution, turn rates used, the ranges fights happen at,
 * how long you hold a firing line. Every brain in this project was trained
 * against CLASSES.traderCobra, a freighter at 220 with half the player's
 * agility, and that mismatch is why pirates weave instead of shooting
 * (docs/TRAINING-LOG.md run 10). The envelope replaces the guess with your
 * numbers, and the trainer can fit an opponent to it.
 *
 * A note on what this can and cannot do. Evolution needs on the order of
 * 150,000 episodes per run; a human flies perhaps thirty an hour. Training a
 * policy directly from waves you fly is not possible. What IS possible is
 * using your play to define the opponent the policy trains against, and to
 * judge the result. That is the loop this supports.
 *
 * What it touches: it clears other NPCs from the system so the wave is the
 * only thing in the sky, and it sets __sharpPirates for the chosen brain. It
 * does NOT move you, heal you, or write to your commander, and it writes
 * nothing to localStorage. Your shields and energy carry between waves, so
 * dock and repair if you want a clean run.
 */
(() => {
  const g = window.__game;
  if (!g) { console.error('open the game first'); return; }
  if (!window.__rec) { console.error('load test/combat-recorder.js first'); return; }

  const V = g.player.position.clone().constructor;

  const arena = window.__arena = {
    waves: [],
    /** samples of the player's own flying, gathered during every wave */
    flight: [],

    async wave({ n = 2, tier = 0, brain = 'shipped', seconds = 90, distance = 1600 } = {}) {
      const mod = await import('/src/game/npc.ts');
      window.__sharpPirates = brain === 'sharp' ? true : brain === 'pro' ? 'pro' : undefined;

      if (g.mode === 'docked') g.launch();
      if (g.mode !== 'flight') { console.error('need to be flying'); return; }

      // clear the sky so the wave is the only thing in it
      for (const x of g.npcs) g.scene.remove(x.object);
      g.npcs.length = 0;

      const spawned = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const pos = g.player.position.clone()
          .add(new V(Math.cos(a) * distance, (i % 3 - 1) * 200, Math.sin(a) * distance));
        const npc = g.spawnNpc('pirate', pos, 100 + i + this.waves.length * 7,
          mod.pirateSpecForTier(tier, 100 + i + this.waves.length * 7));
        npc.threatTier = tier;
        npc.organised = false;
        spawned.push(npc);
      }

      const before = {
        shots: __rec.playerShots, hits: __rec.playerHits, kills: __rec.kills,
        taken: __rec.damageTaken, dealt: __rec.damageDealt,
        npcShots: __rec.npcShots, t: __rec.t,
      };
      if (!__rec.running) __rec.start();

      const label = `wave ${this.waves.length + 1}: ${n}x tier-${tier}, ${brain} brain`;
      console.log('%c' + label + ' — fight! (' + seconds + 's or until clear)', 'color:#ff4d4d');

      // sample the player's own flying while the wave runs
      const sampler = setInterval(() => {
        if (g.mode !== 'flight') return;
        const nearest = spawned.filter((x) => x.alive)
          .map((x) => x.object.position.distanceTo(g.player.position))
          .sort((a, b) => a - b)[0];
        this.flight.push({
          speed: Math.round(g.player.speed),
          pitch: +Math.abs(g.player.pitchRate ?? 0).toFixed(2),
          roll: +Math.abs(g.player.rollRate ?? 0).toFixed(2),
          range: nearest === undefined ? null : Math.round(nearest),
        });
      }, 100);

      const t0 = performance.now();
      await new Promise((resolve) => {
        const tick = setInterval(() => {
          const over = spawned.every((x) => !x.alive)
            || (performance.now() - t0) / 1000 > seconds
            || g.mode !== 'flight';
          if (over) { clearInterval(tick); resolve(); }
        }, 250);
      });
      clearInterval(sampler);

      const result = {
        wave: this.waves.length + 1, ships: n, tier, brain,
        seconds: +((performance.now() - t0) / 1000).toFixed(0),
        youKilled: __rec.kills - before.kills,
        of: n,
        yourShots: __rec.playerShots - before.shots,
        yourHits: __rec.playerHits - before.hits,
        yourAccuracy: (__rec.playerShots - before.shots)
          ? Math.round((__rec.playerHits - before.hits) / (__rec.playerShots - before.shots) * 100) + '%'
          : 'n/a',
        theirShots: __rec.npcShots - before.npcShots,
        damageToYou: +(__rec.damageTaken - before.taken).toFixed(2),
        youSurvived: g.mode === 'flight',
      };
      this.waves.push(result);
      console.table(result);
      return result;
    },

    report() {
      console.table(this.waves);
      return this.waves;
    },

    /**
     * How the commander actually flies. This is the input the trainer needs:
     * a target that moves like you, instead of the freighter every brain has
     * been fitted against.
     */
    envelope() {
      const f = this.flight;
      if (!f.length) { console.log('fly a wave first'); return null; }
      const q = (xs, p) => {
        const s = [...xs].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(s.length * p))];
      };
      const speeds = f.map((x) => x.speed);
      const ranges = f.map((x) => x.range).filter((x) => x !== null);
      const out = {
        samples: f.length,
        speed: { median: q(speeds, 0.5), p90: q(speeds, 0.9), max: Math.max(...speeds) },
        pitchRate: { median: q(f.map((x) => x.pitch), 0.5), p90: q(f.map((x) => x.pitch), 0.9) },
        rollRate: { median: q(f.map((x) => x.roll), 0.5), p90: q(f.map((x) => x.roll), 0.9) },
        engagementRange: ranges.length
          ? { median: q(ranges, 0.5), p10: q(ranges, 0.1), p90: q(ranges, 0.9) } : null,
        forTheTrainer: 'compare with CLASSES.traderCobra (220 speed, 0.70 pitch, 1.20 roll)',
      };
      console.log(JSON.stringify(out, null, 1));
      return out;
    },
  };

  console.log('%c__arena ready — __arena.wave() to start, __arena.envelope() when you have flown a few',
    'color:#ffb444');
})();
