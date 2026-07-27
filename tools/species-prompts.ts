// Build image prompts for the inhabitants of every system.
//
//   node --experimental-strip-types tools/species-prompts.ts [galaxy] [--style crt] [--json]
//
// Writes nothing by default — prints a sample so the prompts can be eyeballed
// before anyone spends GPU time. With --json it emits the full manifest that
// tools/generate-species.py consumes.
//
// Everything here derives from the 1984 seeds, so the manifest is reproducible:
// same galaxy in, same prompts and seeds out. No model runs at build time and
// none can — the game deploys as a static site, so the images are generated
// offline and committed.

import {
  generateGalaxy, speciesName, ECONOMY_NAMES, GOVERNMENT_NAMES, type StarSystem,
} from '../src/galaxy/galaxy.ts';
import { planetDescription } from '../src/galaxy/goatsoup.ts';

export interface SpeciesPrompt {
  index: number;
  system: string;
  species: string;
  economy: string;
  government: string;
  techLevel: number;
  /** deterministic per system, so a rerun reproduces the same image */
  seed: number;
  prompt: string;
  negative: string;
}

/**
 * Deterministic choice from a list, keyed on the system's own seed.
 *
 * Without this, every "poor agricultural anarchy" world got byte-identical
 * wording: 256 systems produced only 175 distinct visual descriptions, and 124
 * worlds shared theirs with at least one other — eight of them all reading
 * "Human Colonials, Mainly Industrial, Feudal". The images still differed,
 * because the generation seed is per-system, but the wardrobe did not.
 *
 * `slot` keeps the clauses from correlating: without it a world that drew the
 * first economy phrase would always draw the first government phrase too, and
 * the variants would collapse back into three fixed outfits.
 */
function pickVariant<T>(sys: StarSystem, slot: number, options: readonly T[]): T {
  let h = Math.imul(sys.seed[0] ^ 0x9e3779b1, 0x85ebca6b);
  h = Math.imul(h ^ sys.seed[1], 0xc2b2ae35);
  h = Math.imul(h ^ sys.seed[2], 0x27d4eb2f);
  h = Math.imul(h ^ (slot + 1), 0x165667b1);
  // The murmur3 finalizer is not decoration. The first version xor-ed the
  // multiplied words and took `% n` directly, which reads the LOW bits — and
  // every multiplier here is odd, so the low bit of the hash was just the
  // parity of the three seed words. The 1984 generator takes alternate
  // iterations of its twist, which leaves a parity invariant across systems,
  // so `% 2` returned the same answer for all 256 worlds: the galaxy came out
  // 256 men and none women. Three-way splits looked fine and hid it. Avalanche
  // the bits before reducing.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return options[(h >>> 0) % options.length];
}

/**
 * Clothing, never a noun for the wearer.
 *
 * This is load-bearing, not style. When these read "a grimy factory hand in
 * worn overalls", Tibedied — Harmless Slimy Lobsters — came back as a
 * photograph of a man in overalls: the human noun competed with the species
 * for the subject and won, being much the more ordinary request. Describe the
 * clothes and the species keeps the subject uncontested.
 */
const ECONOMY_DRESS: Record<string, readonly string[]> = {
  richAgri: [
    'wearing heavy woven farm clothing, prosperous and well fed',
    'wearing thick embroidered harvest robes, comfortable and well kept',
    'wearing a quilted coat of good cloth over clean farm dress',
  ],
  poorAgri: [
    'wearing patched sun-worn farm clothing, weathered by subsistence work',
    'wearing threadbare field clothing, sun-bleached and much mended',
    'wearing a frayed work smock over dust-stained cloth',
  ],
  agri: [
    'wearing practical homespun work clothing',
    'wearing simple undyed cloth and a heavy leather work apron',
    'wearing sturdy plain farm dress, clean but well used',
  ],
  richInd: [
    'wearing sharply tailored expensive dress',
    'wearing a precisely cut suit of fine dark cloth',
    'wearing immaculate tailored clothing with fine metal fastenings',
  ],
  poorInd: [
    'wearing worn grimy factory overalls',
    'wearing oil-stained coveralls patched at the elbows',
    'wearing a soot-marked work jacket over rough cloth',
  ],
  ind: [
    'wearing utilitarian industrial coveralls',
    'wearing a heavy-duty work jacket and a tool harness',
    'wearing standard-issue factory clothing with a chest badge',
  ],
};

const GOVERNMENT_DRESS: Record<string, readonly string[]> = {
  Anarchy: [
    'armed, wary, improvised gear',
    'scavenged armour plates strapped over the clothing, watchful',
    'a weapon harness across the chest, hard suspicious look',
  ],
  Feudal: [
    'rigid caste dress, ornamental rank markings',
    'stiff formal robes with hereditary rank braid',
    'a ceremonial sash and engraved caste tokens',
  ],
  Dictatorship: [
    'uniform military styling, severe expression',
    'state uniform with a hard collar, unsmiling',
    'martial cut clothing, disciplined and grim',
  ],
  // Singular, like everything else here: "identical state-issue uniforms"
  // quietly asked for more than one wearer.
  Communist: [
    'identical state-issue uniform',
    'plain collective-issue clothing, no personal ornament',
    'a standard state garment with a collective badge',
  ],
  'Corporate State': [
    'corporate insignia, immaculate and cold',
    'a company crest at the collar, groomed and expressionless',
    'branded corporate dress, spotless and impersonal',
  ],
  Democracy: [
    'varied civilian dress, open expression',
    'ordinary everyday clothing, relaxed and open',
    'individual civilian dress, unguarded expression',
  ],
  Confederacy: [
    'mixed regional dress, travelling gear',
    'layered clothing from several regions, a pack strap at the shoulder',
    'eclectic dress with regional tokens, road-worn',
  ],
  // Multi-Government was missing from this chain once, so those worlds
  // silently lost their whole political flavour — eight governments, seven
  // branches. Keep every key present.
  'Multi-Government': [
    'clashing factional dress, competing insignia',
    'mismatched factional colours and rival badges',
    'contradictory insignia from several factions at once',
  ],
};

const TECH_DRESS: readonly (readonly string[])[] = [
  [ // primitive
    'primitive equipment, hand-made and crude',
    'crude hand-made tools, rope and hammered metal',
    'rough improvised equipment, nothing manufactured',
  ],
  [ // serviceable
    'serviceable technology, tools and simple devices',
    'practical tools and sturdy machinery, nothing elaborate',
    'workmanlike equipment, honest engineering',
  ],
  [ // advanced
    'advanced technology, implants and fine instruments',
    'neural implants at the temple, precise miniature instruments',
    'sophisticated devices, fine optics, subtle augmentation',
  ],
];

/**
 * What the world does to the people on it. The species tables give us a body;
 * the economy, government and tech level give us a life — and that is what
 * stops 256 portraits looking like 256 rolls on the same table.
 */
function environmentPhrase(sys: StarSystem): string {
  const econ = ECONOMY_NAMES[sys.economy];
  const gov = GOVERNMENT_NAMES[sys.government];
  const agri = econ.includes('Agricultural');
  const key = econ.startsWith('Rich') ? (agri ? 'richAgri' : 'richInd')
    : econ.startsWith('Poor') ? (agri ? 'poorAgri' : 'poorInd')
      : (agri ? 'agri' : 'ind');

  const tl = sys.techLevel + 1;
  const band = tl >= 10 ? 2 : tl >= 6 ? 1 : 0;

  return [
    pickVariant(sys, 0, ECONOMY_DRESS[key]),
    pickVariant(sys, 1, GOVERNMENT_DRESS[gov] ?? GOVERNMENT_DRESS.Democracy),
    pickVariant(sys, 2, TECH_DRESS[band]),
  ].join(', ');
}

/**
 * Hand-written descriptions for the worlds that carry the game's identity.
 *
 * The generated clauses are good enough for 250 systems nobody will linger on.
 * These dozen are where the effort gets seen: the world you launch from, the
 * two ends of the famous trade runs, the anarchy everyone tells stories about,
 * and the graveyard. They replace the economy/government/tech and homeworld
 * clauses entirely, but not the species or the style — so a hero world still
 * gets its 1984 species, and still renders in whatever style is selected.
 *
 * Same rule as the generated clauses, for the same reason: no noun for the
 * wearer on non-human worlds, or it beats the species.
 */
const HEROES: Record<string, string> = {
  Lave: 'wearing heavy woven plantation cloth with a hard uniform collar and a '
    + 'dictatorship insignia, humid air, a rich green world of vast rain forests '
    + 'and the notorious Lavian tree grub',
  Diso: 'sleek black fur above plain homespun work cloth, calm and open, an old '
    + 'farming democracy of ancient corn plantations under a restless sun',
  Leesti: 'a cheap but immaculate corporate uniform, company crest at the collar, '
    + 'shift-tired eyes, a thin hard-worked industrial world at the near end of '
    + 'the richest trade run in the galaxy',
  Zaonce: 'a sharp corporate uniform fitted awkwardly to a rodent frame, glossy '
    + 'damp hide, precise instruments clipped at the chest, the banking polish of '
    + 'a world that counts other worlds money',
  Riedquat: 'improvised armour plate strapped over patched farm cloth, a weapon '
    + 'harness across the chest, wary sidelong look, a lawless feuding world where '
    + 'the law is whoever is still flying',
  Tionisla: 'sombre dark formal dress over dry scaled hide, quiet and unhurried, a '
    + 'world best known for the vast orbital graveyard of derelict ships that '
    + 'circles it',
  Reorte: 'coarse patched field cloth strained over a heavy black-furred frame, '
    + 'severe martial styling, the hard discipline of an agricultural dictatorship',
  Ensoreus: 'expensive tailored corporate dress, immaculate and cold, groomed black '
    + 'fur, fine augmentation at the temple, a rich industrial world of glass towers',
};

const article = (word: string): string => (/^[AEIOU]/i.test(word) ? 'an' : 'a');

/**
 * "Harmless Felines" -> "harmless feline".
 *
 * Diso kept coming back as a group portrait — five cats in dungarees — and no
 * amount of negative prompting was going to fix it, because the prompt asked
 * for it three times over: a plural species ("felines"), a plural population
 * ("inhabitants of Diso") and a plural occupation ("agricultural workers").
 * Negating "multiple figures" while requesting three plurals is not a contest.
 *
 * Every species in the 1984 tables is a plain -s plural (Rodents, Lobsters,
 * Felines, Humanoids...), so this is as simple as it looks.
 */
const singular = (name: string): string =>
  (name.endsWith('s') && !name.endsWith('ss') ? name.slice(0, -1) : name);

/**
 * Colour words become minerals on humanoid worlds.
 *
 * The 1984 table offers Green, Red, Yellow, Blue and Black. On a lizard or a
 * feline these are plainly an animal's colouring. On a humanoid — a
 * human-shaped subject — "black" is read as an ethnicity, and paired with
 * "fierce" the result is a caricature. Naming a mineral instead keeps the
 * species description intact while making it unmistakably not a human one.
 */
const MINERAL: Record<string, string> = {
  black: 'obsidian-skinned',
  green: 'jade-skinned',
  red: 'crimson-skinned',
  blue: 'azure-skinned',
  yellow: 'amber-skinned',
};

const alienise = (name: string): string =>
  name.split(' ').map((w) => MINERAL[w.toLowerCase()] ?? w).join(' ');

/** The goat-soup line, trimmed to the evocative clause. */
function habitatPhrase(sys: StarSystem): string {
  const d = planetDescription(sys)
    .replace(/^.*? is (?:most )?/i, '')
    .replace(/\.$/, '');
  return d.length > 90 ? d.slice(0, 90) : d;
}

/**
 * How much of the look to ask the model for.
 *
 * Z-Image is strong enough to render the era itself, so the honest split is
 * not "model makes images, post makes the look" — it is: the model owns
 * LIGHTING, BACKGROUND and RENDERING STYLE, and post owns only the palette
 * lock and the resolution. Those last two cannot move: 256 portraits ship in
 * a static site and must sit in the game's three greens exactly, which no
 * generator will hit to the byte.
 *
 * The failed first attempt is still instructive, and the boundary it teaches
 * is precise. Asking for "minimal detail, simple bold shapes" told the model
 * to REMOVE information, and it obliged with a flat white silhouette — 2 grey
 * levels against 210 for a lit bust. Asking for dramatic lighting or engraved
 * linework instead RESTRUCTURES the information, putting it into edges and
 * large tonal masses, which is exactly what survives 96px and four tones.
 * Restructure, never suppress.
 */
export type Style = 'crt' | 'lit' | 'ink' | 'boxart' | 'pixel' | 'plain';

const STYLES: Record<Style, { look: string[]; negative: string[] }> = {
  // Ask for the finished article: green phosphor on black. If the model can
  // do this well, post-processing drops to a palette snap.
  // Describes the IMAGE, never the device. The first version said "CRT monitor
  // image ... retro computer terminal readout" and the model did exactly as
  // asked: it rendered a photograph of a television set, bezel, curved glass
  // and all, with the portrait shrunk inside it. Naming a display in a prompt
  // gets you a picture of the display. So: the qualities of phosphor, and an
  // explicit negative against the hardware.
  crt: {
    look: [
      'monochrome green image, glowing bright green on a pure black background',
      'strong key light on the face, deep black shadows, sharp visible facial features',
      'high contrast, subject fills the whole image edge to edge',
    ],
    negative: [
      // Not "frame", "border" or "device": the prompt says the subject fills
      // the frame, and the tech-level clause says "tools and simple devices".
      // Negating a word the prompt relies on is the ink-style bug again.
      'television set, monitor, screen, bezel, plastic casing, photograph of a screen',
      'white background, grey backdrop, studio lighting, full colour, washed out, flat lighting',
    ],
  },
  // The safe big win: keep the model's photoreal strength, just light it the
  // way a CRT works — subject lit out of darkness rather than pasted on a wall.
  lit: {
    look: [
      'single dramatic key light from the front left, subject lit out of near-total darkness',
      'black background, deep shadows, strong rim light along the jaw and shoulders',
      'detailed, sharp focus, clearly visible eyes and facial features',
    ],
    negative: ['white background, grey backdrop, bright evenly lit room, flat lighting'],
  },
  // Linework survives a hard downsample better than fur does: it is already
  // edges. Worth trying if photoreal texture keeps dithering into speckle.
  ink: {
    look: [
      'black and white engraved illustration, bold confident linework and crosshatching',
      // NOT "clear silhouette against plain background", which is what this
      // said first: every style also negative-prompts "silhouette", because a
      // flat black shape is the exact failure mode here. Asking for one and
      // forbidding it in the same breath leaves the model to split the
      // difference, and it splits it badly.
      'woodcut print style, strong dark outlines, clean separation from a plain background',
      'sharply defined facial features',
    ],
    negative: ['photograph, soft focus, gradient shading, colour'],
  },
  // The visual world Elite actually shipped into: airbrushed science fiction
  // cover illustration. Strong tonal modelling and theatrical lighting, which
  // is precisely what survives sixteen tones — and it is period-correct
  // without being a pastiche of the game's own graphics.
  boxart: {
    look: [
      'airbrushed 1980s science fiction paperback cover illustration',
      'dramatic theatrical lighting, bold modelled forms, strong rim light, deep shadow',
      'painted poster art, confident brushwork, sharply detailed face and eyes',
    ],
    negative: ['photograph, snapshot, flat lighting, pixelation, colour photography'],
  },
  // The literal reading of "1980s video game", and the one to be sceptical
  // about. Asked for chunky pixels, the model paints FAKE ones at whatever
  // grid it fancies, at 512px — which we then downsample to 256 and quantise
  // on our own grid. Two retro grids that do not align give moiré and mush,
  // and we would be paying the model to imitate the thing posterise.py does
  // exactly. Included because it should be settled by looking, not by me
  // being confident in a comment.
  pixel: {
    look: [
      'retro video game character portrait, chunky visible square pixels, limited palette',
      'clean readable sprite art, strong dark outline, bold simple shading',
      'clearly defined eyes and face',
    ],
    negative: ['photograph, soft focus, anti-aliasing, smooth gradients, blurry pixels'],
  },
  // Neutral: a good photograph and nothing else, leaving every decision to post.
  plain: {
    look: [
      'detailed, sharp focus, clearly lit, natural full tonal range',
      'plain uncluttered background, centred head and shoulders portrait',
    ],
    negative: [],
  },
};

export function buildPrompt(sys: StarSystem, style: Style = 'crt'): SpeciesPrompt {
  const species = speciesName(sys);
  // "Human Colonials" describes a people, not a body — say so plainly rather
  // than asking for a creature.
  // Non-human species need saying twice and defending in the negative. The
  // species tables ask for things like "Harmless Slimy Lobsters", and a lobster
  // in factory overalls is a far stranger request than a person in factory
  // overalls — so any human-shaped hint elsewhere in the prompt will win unless
  // the species is stated as the subject outright.
  const human = species === 'Human Colonials';
  // Humanoids get the alien treatment too, which reverses an earlier call.
  //
  // The reasoning then was that a humanoid should look like one, so it was
  // exempted from the anti-human negative. The result is that the model draws
  // a person — and the 1984 colour table then reads as an ethnicity rather
  // than a skin. "Fierce Black Bony Humanoids" rendered as a human is a racial
  // caricature, and there are 117 humanoid worlds across the eight galaxies,
  // 26 of them with Black in the name.
  //
  // So humanoids are pushed firmly non-human, and their colour word is
  // remapped to a mineral (below). The species NAME is untouched — galaxy.ts
  // is byte-matched to 1984 and the game still shows what it always showed.
  // This only changes what we ask the image model for.
  const humanoid = species.toLowerCase().includes('humanoid');
  // Nothing said, so the model produced 256 men. Seeded like everything else,
  // so it stays reproducible and a rerun does not reshuffle the galaxy.
  //
  // "female"/"male" as adjectives rather than "a woman"/"a man" deliberately:
  // the 108 non-human worlds carry "man, woman, ordinary person" in their
  // negative to stop the species being replaced by a human, and asking for a
  // woman while forbidding one is the contradiction this file already has a
  // check for.
  const sex = pickVariant(sys, 3, ['female', 'male'] as const);
  const creature = humanoid
    ? alienise(singular(species.toLowerCase()))
    : singular(species.toLowerCase());
  const subject = human
    ? `a single ${sex} human colonist`
    : `a single ${sex} ${humanoid ? 'alien' : 'anthropomorphic'} ${creature} creature`;

  const prompt = [
    `head and shoulders portrait of ${subject}, one individual alone`,
    ...(human ? [] : humanoid
      ? [`clearly an alien species, non-human anatomy and facial structure`]
      : [`clearly a ${sex} ${creature}, animal head and face`]),
    `an inhabitant of ${sys.name}, ${article(ECONOMY_NAMES[sys.economy])} ` +
      `${ECONOMY_NAMES[sys.economy].toLowerCase()} ${GOVERNMENT_NAMES[sys.government].toLowerCase()} world`,
    HEROES[sys.name] ?? environmentPhrase(sys),
    ...(HEROES[sys.name] ? [] : [`homeworld ${habitatPhrase(sys)}`]),
    ...STYLES[style].look,
  ].join(', ');

  return {
    index: sys.index,
    system: sys.name,
    species,
    economy: ECONOMY_NAMES[sys.economy],
    government: GOVERNMENT_NAMES[sys.government],
    techLevel: sys.techLevel + 1,
    seed: (sys.seed[0] ^ (sys.seed[1] << 3) ^ (sys.seed[2] << 7)) >>> 0,
    prompt,
    // "silhouette" and "backlit" earn their place: that is the exact failure
    // the first prompt produced, and the crt/lit styles push towards it.
    negative: [
      'silhouette, featureless, solid black shape, face in shadow',
      'text, watermark, signature, blurry, busy background, full body',
      'multiple figures, two people, group portrait, crowd, background characters',
      ...(human ? [] : ['human face, ordinary person, man, woman']),
      ...(humanoid ? ['human ethnicity, racial caricature, ordinary human skin'] : []),
      ...STYLES[style].negative,
    ].join(', '),
  };
}

// --- CLI --------------------------------------------------------------------

const galaxy = Number(process.argv[2]) || 1;
const asJson = process.argv.includes('--json');
const styleArg = process.argv.find((a) => a.startsWith('--style'));
const style = ((styleArg?.includes('=')
  ? styleArg.split('=')[1]
  : styleArg && process.argv[process.argv.indexOf(styleArg) + 1]) || 'crt') as Style;
if (!(style in STYLES)) {
  console.error(`unknown --style ${style}; try ${Object.keys(STYLES).join(', ')}`);
  process.exit(1);
}
const systems = generateGalaxy(galaxy);

/**
 * A term must never appear in both a prompt and its own negative.
 *
 * Twice now this has been a real bug rather than a theoretical one: `ink`
 * asked for a "clear silhouette" while negating "silhouette", and `crt`
 * negated "frame" and "device" while the prompt said the subject fills the
 * frame and the tech-level clause said "tools and simple devices". Both slip
 * past a read-through, because the two halves are written far apart and the
 * collision comes from a clause generated per system.
 *
 * So it is checked over every style against every system, which is cheap and
 * exhaustive where spot-checking one world is neither.
 */
function checkNoContradictions(): void {
  const bad: string[] = [];
  for (const s of Object.keys(STYLES) as Style[]) {
    for (const sys of systems) {
      const p = buildPrompt(sys, s);
      const positive = p.prompt.split(',').map((t) => t.trim().toLowerCase());
      for (const term of p.negative.split(',').map((t) => t.trim().toLowerCase())) {
        if (positive.some((t) => t.split(/\s+/).includes(term))) {
          bad.push(`  ${s}/${sys.name}: negative "${term}" also appears in the prompt`);
        }
      }
    }
  }
  if (bad.length) {
    console.error('prompt contradicts its own negative:');
    console.error([...new Set(bad)].slice(0, 10).join('\n'));
    process.exit(1);
  }
}
checkNoContradictions();

/**
 * Every hero name must match a real system, or the override silently does
 * nothing and the world quietly falls back to generated clauses — a typo that
 * looks exactly like success.
 *
 * Only checked for galaxy 1: these are galaxy 1 names, and generating galaxy 2
 * legitimately has none of them.
 */
if (galaxy === 1) {
  const names = new Set(systems.map((s) => s.name));
  const missing = Object.keys(HEROES).filter((n) => !names.has(n));
  if (missing.length) {
    console.error(`hero worlds not in galaxy 1: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const prompts = systems.map((s) => buildPrompt(s, style));

if (asJson) {
  console.log(JSON.stringify({ galaxy, style, count: prompts.length, prompts }, null, 2));
} else {
  // a spread: the famous ones, plus the extremes of the environment axes
  const picks = [
    systems[7], // Lave
    systems.find((s) => s.name === 'Diso')!,
    systems.find((s) => s.name === 'Riedquat')!,
    systems.find((s) => s.government === 0)!, // an anarchy
    systems.find((s) => s.economy === 0 && s.techLevel >= 9)!, // rich industrial, high TL
    systems.find((s) => s.economy === 7)!, // poor agricultural
  ].filter(Boolean);
  for (const sys of picks) {
    const p = buildPrompt(sys);
    console.log(`\n=== ${p.system} — ${p.species} (${p.economy}, ${p.government}, TL ${p.techLevel})`);
    console.log(p.prompt);
  }
  console.log(`\n${prompts.length} systems in galaxy ${galaxy}; ` +
    `${new Set(prompts.map((p) => p.species)).size} distinct species; style '${style}'.`);
  console.log(`styles: ${Object.keys(STYLES).join(', ')} (--style ink)`);
}
