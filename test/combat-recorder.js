/**
 * Combat recorder — telemetry from a fight a HUMAN actually flew.
 *
 *   fetch('/test/combat-recorder.js').then(r => r.text()).then(eval)
 *   __rec.start()        // then go and get shot at
 *   __rec.report()       // readable summary
 *   __rec.json()         // the raw log, for analysis
 *   __rec.stop()
 *
 * Why this exists: every combat measurement in docs/TRAINING-LOG.md was taken
 * with a bot flying the player's ship, and the bot kept being the thing that
 * decided the answer. Flying straight made freighter-trained brains look good.
 * Flying the defence policy made everything look survivable, because that
 * policy evades superbly and shoots badly. A real player does neither.
 *
 * Read-only. It wraps three functions, writes nothing to the commander, and
 * touches no localStorage. Stopping restores everything it patched.
 */
(() => {
  const g = window.__game;
  if (!g) { console.error('open the game first'); return; }

  const rec = window.__rec = {
    running: false,
    t: 0,
    /** per-frame samples of every hostile, at SAMPLE_HZ */
    samples: [],
    events: [],
    playerShots: 0,
    playerHits: 0,
    npcShots: 0,
    npcHitsOnPlayer: 0,
    damageTaken: 0,
    damageDealt: 0,
    kills: 0,
    startedAt: null,

    start() {
      if (this.running) { console.log('already recording'); return; }
      this.reset();
      this.running = true;
      this.startedAt = new Date().toISOString();
      patch();
      console.log('%crecording combat — go and find trouble. __rec.report() when done.',
        'color:#4dff5c');
    },

    stop() {
      if (!this.running) return;
      this.running = false;
      unpatch();
      console.log('stopped after ' + this.t.toFixed(0) + 's of flight');
      return this.report();
    },

    reset() {
      this.samples = []; this.events = []; this.t = 0;
      this.playerShots = 0; this.playerHits = 0; this.npcShots = 0;
      this.npcHitsOnPlayer = 0; this.damageTaken = 0; this.damageDealt = 0; this.kills = 0;
    },

    report() {
      const s = this.samples;
      const engaged = s.filter((x) => x.hostiles > 0);
      const secs = engaged.length / SAMPLE_HZ;
      const pct = (n, d) => (d ? (n / d * 100).toFixed(0) + '%' : 'n/a');
      const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

      // per-hostile rows, so "lined up" means what it means in npc.ts
      const rows = [];
      for (const x of engaged) for (const h of x.each) rows.push(h);
      const inRange = rows.filter((r) => r.dist < 3500);
      const linedUp = rows.filter((r) => r.facing < 14.3);
      const eligible = rows.filter((r) => r.dist < 3500 && r.facing < 14.3 && r.dist > 220);

      const out = {
        flightTime: this.t.toFixed(0) + 's',
        timeUnderAttack: secs.toFixed(0) + 's',
        YOU: {
          shots: this.playerShots,
          hits: this.playerHits,
          accuracy: pct(this.playerHits, this.playerShots),
          damageDealt: this.damageDealt.toFixed(2),
          kills: this.kills,
        },
        THEM: {
          shots: this.npcShots,
          hitsOnYou: this.npcHitsOnPlayer,
          accuracy: pct(this.npcHitsOnPlayer, this.npcShots),
          damageToYou: this.damageTaken.toFixed(2),
          shotsPerMinutePerShip: rows.length
            ? (this.npcShots / (rows.length / SAMPLE_HZ / 60)).toFixed(1) : '0',
        },
        THEIR_GEOMETRY: {
          withinLaserRange: pct(inRange.length, rows.length),
          linedUpOnYou: pct(linedUp.length, rows.length),
          eligibleToFire: pct(eligible.length, rows.length),
          meanDistance: mean(rows.map((r) => r.dist)).toFixed(0),
          meanFacingError: mean(rows.map((r) => r.facing)).toFixed(1) + ' deg',
        },
        events: this.events.slice(-25),
      };
      console.log(JSON.stringify(out, null, 1));
      return out;
    },

    json() { return JSON.stringify({ samples: this.samples, events: this.events }); },
  };

  const SAMPLE_HZ = 10;
  let sampleAccum = 0;
  let origUpdate = null, npcProto = null, origApply = null, origFire = null;

  const hostiles = () => g.npcs.filter((n) => n.alive
    && (n.role === 'pirate' || n.role === 'thargoid' || n.role === 'thargon'
        || ((n.role === 'police' || n.role === 'hunter') && n.provoked))
    && n.object.position.distanceTo(g.player.position) < 9000);

  function patch() {
    // damage to the player
    origApply = g.applyPlayerDamage.bind(g);
    g.applyPlayerDamage = (amt, from) => {
      if (rec.running) { rec.npcHitsOnPlayer++; rec.damageTaken += amt; }
      return origApply(amt, from);
    };

    // the player's own trigger: count a hit by watching hostile hp fall
    origFire = g.fireLaser.bind(g);
    g.fireLaser = (...a) => {
      if (!rec.running) return origFire(...a);
      const before = g.npcs.map((n) => ({ n, hp: n.hp, alive: n.alive }));
      const r = origFire(...a);
      rec.playerShots++;
      for (const b of before) {
        if (b.n.hp < b.hp) { rec.playerHits++; rec.damageDealt += b.hp - b.n.hp; }
        if (b.alive && !b.n.alive) {
          rec.kills++;
          rec.events.push({ t: +rec.t.toFixed(1), what: 'you destroyed ' + (b.n.def?.name ?? b.n.role) });
        }
      }
      return r;
    };

    // one game frame: sample geometry, and count NPC shots via their fire events
    const origGameUpdate = g.update.bind(g);
    origUpdate = origGameUpdate;
    g.update = (dt, elapsed) => {
      if (rec.running && g.mode === 'flight') {
        // lazily wrap the NPC prototype the moment a real NPC exists
        if (!npcProto && g.npcs.length) {
          npcProto = Object.getPrototypeOf(g.npcs[0]);
          const orig = npcProto.update;
          npcProto.__origUpdate = orig;
          npcProto.update = function (...args) {
            const ev = orig.apply(this, args);
            if (rec.running && ev && ev.at === 'player') rec.npcShots++;
            return ev;
          };
        }
        rec.t += dt;
        sampleAccum += dt;
        if (sampleAccum >= 1 / SAMPLE_HZ) {
          sampleAccum = 0;
          const hs = hostiles();
          rec.samples.push({
            t: +rec.t.toFixed(1),
            hostiles: hs.length,
            speed: Math.round(g.player.speed),
            fore: +g.foreShield.toFixed(2),
            aft: +g.aftShield.toFixed(2),
            energy: +g.energy.toFixed(2),
            each: hs.map((n) => ({
              ship: n.def?.name ?? n.role,
              dist: Math.round(n.object.position.distanceTo(g.player.position)),
              facing: +(n.facing(g.player.position) * 180 / Math.PI).toFixed(1),
            })),
          });
        }
      }
      return origGameUpdate(dt, elapsed);
    };
  }

  function unpatch() {
    if (origApply) g.applyPlayerDamage = origApply;
    if (origFire) g.fireLaser = origFire;
    if (origUpdate) g.update = origUpdate;
    if (npcProto && npcProto.__origUpdate) {
      npcProto.update = npcProto.__origUpdate;
      delete npcProto.__origUpdate;
    }
    npcProto = null;
  }

  console.log('%c__rec ready — __rec.start(), fly, then __rec.report()', 'color:#ffb444');
})();
