// "Goat soup" — the original's procedural planet descriptions.
//
// Elite generated a sentence per planet from a recursive token grammar
// driven by a 4-byte RNG seeded from the system's own seed words. Tokens
// 0x81-0xA4 each pick one of five options (which may themselves contain
// tokens); 0xB0/0xB1/0xB2 expand to the planet name, its "-ian" adjective,
// and a random Elite-style name. The whole thing hangs off one root string:
//
//     "<planet phrase> is <description>."
//
// It is named for one possible output: "...its inhabitants' ancient mating
// traditions and its exotic goat soup".

import type { StarSystem } from './galaxy.ts';

// Options for tokens 0x81…0xA4, in order. \x?? escapes are nested tokens.
const DESC_LIST: string[][] = [
  /* 81 */ ['fabled', 'notable', 'well known', 'famous', 'noted'],
  /* 82 */ ['very', 'mildly', 'most', 'reasonably', ''],
  /* 83 */ ['ancient', '\x95', 'great', 'vast', 'pink'],
  /* 84 */ ['\x9E \x9D plantations', 'mountains', '\x9C', '\x94 forests', 'oceans'],
  /* 85 */ ['shyness', 'silliness', 'mating traditions', 'loathing of \x86', 'love for \x86'],
  /* 86 */ ['food blenders', 'tourists', 'poetry', 'discos', '\x8E'],
  /* 87 */ ['talking tree', 'crab', 'bat', 'lobst', '\xB2'],
  /* 88 */ ['beset', 'plagued', 'ravaged', 'cursed', 'scourged'],
  /* 89 */ ['\x96 civil war', '\x9B \x98 \x99s', 'a \x9B disease', '\x96 earthquakes', '\x96 solar activity'],
  /* 8A */ ['its \x83 \x84', 'the \xB1 \x98 \x99', "its inhabitants' \x9A \x85", '\xA1', 'its \x8D \x8E'],
  /* 8B */ ['juice', 'brandy', 'water', 'brew', 'gargle blasters'],
  /* 8C */ ['\xB2', '\xB1 \x99', '\xB1 \xB2', '\xB1 \x9B', '\x9B \xB2'],
  /* 8D */ ['fabulous', 'exotic', 'hoopy', 'unusual', 'exciting'],
  /* 8E */ ['cuisine', 'night life', 'casinos', 'sit coms', ' \xA1 '],
  /* 8F */ ['\xB0', 'The planet \xB0', 'The world \xB0', 'This planet', 'This world'],
  /* 90 */ ['n unremarkable', ' boring', ' dull', ' tedious', ' revolting'],
  /* 91 */ ['planet', 'world', 'place', 'little planet', 'dump'],
  /* 92 */ ['wasp', 'moth', 'grub', 'ant', '\xB2'],
  /* 93 */ ['poet', 'arts graduate', 'yak', 'snail', 'slug'],
  /* 94 */ ['tropical', 'dense', 'rain', 'impenetrable', 'exuberant'],
  /* 95 */ ['funny', 'weird', 'unusual', 'strange', 'peculiar'],
  /* 96 */ ['frequent', 'occasional', 'unpredictable', 'dreadful', 'deadly'],
  /* 97 */ ['\x82 \x81 for \x8A', '\x82 \x81 for \x8A and \x8A', '\x88 by \x89',
            '\x82 \x81 for \x8A but \x88 by \x89', 'a\x90 \x91'],
  /* 98 */ ['\x9B', 'mountain', 'edible', 'tree', 'spotted'],
  /* 99 */ ['\x9F', '\xA0', '\x87oid', '\x93', '\x92'],
  /* 9A */ ['ancient', 'exceptional', 'eccentric', 'ingrained', '\x95'],
  /* 9B */ ['killer', 'deadly', 'evil', 'lethal', 'vicious'],
  /* 9C */ ['parking meters', 'dust clouds', 'ice bergs', 'rock formations', 'volcanoes'],
  /* 9D */ ['plant', 'tulip', 'banana', 'corn', '\xB2weed'],
  /* 9E */ ['\xB2', '\xB1 \xB2', '\xB1 \x9B', 'inhabitant', '\xB1 \xB2'],
  /* 9F */ ['shrew', 'beast', 'bison', 'snake', 'wolf'],
  /* A0 */ ['leopard', 'cat', 'monkey', 'goat', 'fish'],
  /* A1 */ ['\x8C \x8B', '\xB1 \x9F \xA2', 'its \x8D \xA0 \xA2', '\xA3 \xA4', '\x8C \x8B'],
  /* A2 */ ['meat', 'cutlet', 'steak', 'burgers', 'soup'],
  /* A3 */ ['ice', 'mud', 'Zero-G', 'vacuum', '\xB1 ultra'],
  /* A4 */ ['hockey', 'cricket', 'karate', 'polo', 'tennis'],
];

// Digraph table for the random-name token. The original used a separate
// (and, in the C reference, out-of-bounds-indexed) table here, so the
// nonsense names differ slightly from any given port — everything else in
// the grammar reproduces exactly, including Lave's canonical description.
const PAIRS = '..LEXEGEZACEBISOUSESARMAINDIREA.ERATENBERALAVETIEDORQUANTEISRION';

/** The original's 4-byte description RNG. */
class SoupRng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(sys: StarSystem) {
    // seeded from the system's second and third seed words, low byte first
    // (verified: this is what reproduces Lave's canonical description)
    this.a = sys.seed[1] & 0xff;
    this.b = (sys.seed[1] >> 8) & 0xff;
    this.c = sys.seed[2] & 0xff;
    this.d = (sys.seed[2] >> 8) & 0xff;
  }

  next(): number {
    const x = (this.a * 2) & 0xff;
    let a = x + this.c;
    if (this.a > 127) a += 1;
    this.a = a & 0xff;
    this.c = x;
    a = Math.floor(a / 256); // carry
    const b = this.b;
    a = (a + b + this.d) & 0xff;
    this.b = a;
    this.d = b;
    return a;
  }
}

/** Title-case a generated system name the way the original prints it. */
function properName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/** "Lave" → "Lavian", dropping a trailing E/I as the original does. */
function ianName(name: string): string {
  const upper = name.toUpperCase();
  let out = upper.charAt(0);
  for (let i = 1; i < upper.length; i++) {
    const isLast = i === upper.length - 1;
    if (!isLast || (upper[i] !== 'E' && upper[i] !== 'I')) out += upper[i].toLowerCase();
  }
  return `${out}ian`;
}

function randomName(rng: SoupRng): string {
  let out = '';
  const len = rng.next() & 3;
  for (let i = 0; i <= len; i++) {
    const x = rng.next() & 0x3e;
    if (PAIRS[x] !== '.') out += PAIRS[x];
    if (PAIRS[x + 1] !== '.') out += PAIRS[x + 1];
  }
  return properName(out || 'Ma');
}

function expand(source: string, sys: StarSystem, rng: SoupRng): string {
  let out = '';
  for (const ch of source) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      out += ch;
    } else if (code >= 0x81 && code <= 0xa4) {
      // pick one of five options, weighted exactly as the original
      const r = rng.next();
      const pick = (r >= 0x33 ? 1 : 0) + (r >= 0x66 ? 1 : 0) + (r >= 0x99 ? 1 : 0) + (r >= 0xcc ? 1 : 0);
      out += expand(DESC_LIST[code - 0x81][pick], sys, rng);
    } else if (code === 0xb0) {
      out += properName(sys.name);
    } else if (code === 0xb1) {
      out += ianName(sys.name);
    } else if (code === 0xb2) {
      out += randomName(rng);
    }
  }
  return out;
}

/**
 * The planet's description, e.g. "This planet is mildly noted for its
 * ancient Ma Corn plantations but beset by frequent solar activity."
 * Deterministic per system — the same seeds always tell the same story.
 */
export function planetDescription(sys: StarSystem): string {
  const text = expand('\x8F is \x97.', sys, new SoupRng(sys));
  // tidy the double spaces that empty options ("very"/"") can leave behind
  return text.replace(/\s+/g, ' ').replace(/ \./g, '.');
}
