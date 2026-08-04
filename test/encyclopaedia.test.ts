// The encyclopaedia page: that it is a complete document without JavaScript,
// that it obeys the two site invariants, and that the filter says what it means.
//
// The first of those is the load-bearing one. The page is chart-led, and a
// chart is invisible to a crawler and useless without JavaScript — so the
// document is built the other way up, with all 256 entries written into the
// HTML at build time and the chart layered over markup that is already
// complete. If that ever silently stops happening the page still LOOKS fine in
// a browser, which is exactly the kind of failure that needs a test rather
// than an eye.

import { readFileSync } from 'node:fs';
import { systemDescription } from '../src/galaxy/descriptions.ts';
import { entryFor, factsFor, entryHtml, slugFor } from '../src/encyclopaedia/entry.ts';
import {
  emptyFilter, matches, selectSlugs, facetsOf, isUntouched,
} from '../src/encyclopaedia/filters.ts';
import { TECH_MIN, TECH_MAX } from '../src/constants/tech-level.ts';
import { escapeHtml } from '../src/engine/escape-html.ts';
import { check, eq } from './harness.ts';
import { g1 } from './fixtures.ts';

console.log('\nthe galaxy encyclopaedia');

const entries = g1.map((s) => entryFor(s, 1));
const html = entries.map(entryHtml).join('\n');
const page = readFileSync(new URL('../encyclopaedia.html', import.meta.url), 'utf8');
const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const landing = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// --- the document is the encyclopaedia --------------------------------------

eq('one entry per world', entries.length, 256);

const missingName = entries.filter((e) => !html.includes(`>${escapeHtml(e.name)}</h3>`));
check(`every world's name is in the markup${missingName.length ? `: ${missingName[0].name}` : ''}`,
  missingName.length === 0);

// The prose is the reason the page is worth indexing at all, so assert it is
// actually there rather than assuming the entry template carries it.
const described = entries.filter((e) => e.description);
eq('every world has generated prose', described.length, 256);
const missingProse = described.filter((e) => !html.includes(escapeHtml(e.description!)));
check(`every description is in the markup${missingProse.length ? `: ${missingProse[0].name}` : ''}`,
  missingProse.length === 0);
const missingPeople = described.filter((e) => !html.includes(escapeHtml(e.inhabitants!)));
check('every inhabitants paragraph is in the markup', missingPeople.length === 0);

// ...and the 1984 line, which is the part that is NOT generated and must
// survive beside it.
check('every canon line is in the markup',
  entries.every((e) => html.includes(escapeHtml(e.canon))));

check('the page has the marker the build writes entries into',
  page.includes('<!--ENTRIES-->'));
check('the build plugin is wired up', viteConfig.includes('encyclopaediaEntries'));
check('the page is a vite entry, or it does not build',
  /encyclopaedia:\s*resolve/.test(viteConfig));

// --- invariant 1: "Elite" is never this project's NAME -----------------------

// It IS used in prose to say what this is a tribute to — nominative use, and
// the point. What it may never be is the name of the page, the site or the
// product. Nothing enforced this before; the encyclopaedia is a new public
// page and a good moment to start.
const title = /<title>([^<]*)<\/title>/.exec(page)?.[1] ?? '';
const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(page)?.[1]?.trim() ?? '';
const ogTitle = /property="og:title" content="([^"]*)"/.exec(page)?.[1] ?? '';

eq('the page is the Galactic Encyclopaedia', h1, 'Galactic Encyclopaedia');
check('the title does not name the game Elite', !/\bElite\b/.test(title));
check('the H1 does not name the game Elite', !/\bElite\b/.test(h1));
check('the Open Graph title does not name the game Elite', !/\bElite\b/.test(ogTitle));
check('...but the page still says what it is a tribute to', /tribute to Elite/.test(page));

// --- invariant 2: link WITHOUT .html ----------------------------------------

// Cloudflare 308-redirects /encyclopaedia.html to /encyclopaedia, so a
// canonical or sitemap entry ending in .html points at a redirect — an SEO
// error rather than a cosmetic one.
const canonical = /rel="canonical" href="([^"]*)"/.exec(page)?.[1] ?? '';
eq('the canonical omits .html', canonical, 'https://harmless.atomic14.com/encyclopaedia');
check('no internal link on the page ends in .html',
  ![...page.matchAll(/href="(\/[^"]*)"/g)].some((m) => m[1].endsWith('.html')));
check('the sitemap lists the encyclopaedia',
  sitemap.includes('https://harmless.atomic14.com/encyclopaedia<'));
check('no sitemap entry ends in .html', !/\.html<\/loc>/.test(sitemap));
check('the landing page links to it', landing.includes('href="/encyclopaedia"'));

// --- the render boundary ----------------------------------------------------

// TODO 58 found a literal `</br>` in a generated field. The committed file is
// checked, but this is the render boundary and does not get to assume that.
eq('markup in prose is escaped', escapeHtml('a</br>b'), 'a&lt;/br&gt;b');
eq('ampersands are escaped first, not twice', escapeHtml('a & <b>'), 'a &amp; &lt;b&gt;');
check('no entry emits a raw angle bracket from its prose',
  !html.includes('</br>'));

// --- slugs and deep links ---------------------------------------------------

const slugs = new Set(entries.map((e) => e.slug));
eq('every slug is distinct within the galaxy', slugs.size, entries.length);
eq('Lave slugs to lave', slugFor(g1[7]), 'lave');
check('every slug is URL-safe', entries.every((e) => /^[a-z0-9]+$/.test(e.slug)));
check('every entry is addressable by id', entries.every((e) => html.includes(`id="w-${e.slug}"`)));

// --- the filter -------------------------------------------------------------

// An empty set means "no constraint", which is the opposite of what a set
// normally means — a rail with nothing ticked shows everything, because that
// is what a person expects of a filter they have not touched.
const none = emptyFilter();
check('an untouched filter is untouched', isUntouched(none));
eq('an untouched filter matches every world', selectSlugs(entries, none).size, 256);

const anarchies = { ...emptyFilter(), governments: new Set([0]) };
check('ticking a government narrows', !isUntouched(anarchies));
const lit = selectSlugs(entries, anarchies);
check('...to fewer worlds than the galaxy holds', lit.size > 0 && lit.size < 256);
check('...and every one of them is that government',
  entries.filter((e) => lit.has(e.slug)).every((e) => e.government === 0));

const lave = entries.find((e) => e.slug === 'lave')!;
check('tech range excludes below the floor',
  !matches(lave, { ...emptyFilter(), techMin: lave.techLevel + 1 }));
check('tech range excludes above the ceiling',
  !matches(lave, { ...emptyFilter(), techMax: lave.techLevel - 1 }));
check('tech range includes the exact level',
  matches(lave, { ...emptyFilter(), techMin: lave.techLevel, techMax: lave.techLevel }));
check('search matches on part of a name',
  matches(lave, { ...emptyFilter(), search: 'av' }));
check('search is case-insensitive', matches(lave, { ...emptyFilter(), search: 'LAVE' }));
check('search excludes a world it does not name',
  !matches(lave, { ...emptyFilter(), search: 'zaonce' }));

// Two facets set is an AND, not an OR — a filter that widened as you added to
// it would be the opposite of what the rail looks like it does.
check('two facets narrow together',
  selectSlugs(entries, { ...emptyFilter(), governments: new Set([0]), economies: new Set([0]) }).size
  <= lit.size);

// --- the rail's own options -------------------------------------------------

const facets = facetsOf(entries);
eq('every economy in the galaxy is offered', facets.economies.length, 8);
eq('every government in the galaxy is offered', facets.governments.length, 8);
eq('the economy counts add up', facets.economies.reduce((n, o) => n + o.count, 0), 256);
eq('the government counts add up', facets.governments.reduce((n, o) => n + o.count, 0), 256);
eq('the species counts add up', facets.species.reduce((n, o) => n + o.count, 0), 256);
check('economies keep their 1984 order',
  facets.economies.every((o, i) => i === 0 || o.value > facets.economies[i - 1].value));
check('species are commonest first',
  facets.species.every((o, i) => i === 0 || o.count <= facets.species[i - 1].count));
check('the tech bounds cover every world',
  entries.every((e) => e.techLevel >= TECH_MIN && e.techLevel <= TECH_MAX));

// --- the page must not ship the prose twice ---------------------------------

// All 256 descriptions are already in the document, so the browser bundle must
// not carry them as well. `factsFor` is the runtime half and deliberately does
// NOT reach for `descriptions.ts`; `entryFor` is build-time only. If someone
// swaps the page back to `entryFor` the bundle silently grows by 261 kB, which
// nothing else would notice.
const facts = factsFor(g1[7], 1);
check('the runtime half carries no generated prose',
  facts.description === undefined && facts.inhabitants === undefined);
check('...but still carries everything the chart and rail need',
  facts.x === g1[7].x && facts.y === g1[7].y
  && facts.government === g1[7].government && facts.techLevel === g1[7].techLevel + 1);
check('the build-time half does carry the prose',
  typeof entryFor(g1[7], 1).description === 'string');
check('the page module does not import the descriptions',
  !readFileSync(new URL('../src/encyclopaedia/main.ts', import.meta.url), 'utf8')
    .includes('descriptions.ts'));

// --- the overlay is still optional ------------------------------------------

// The page must not have quietly made generated prose load-bearing. A world
// without an entry renders its statistics and its 1984 line and nothing else.
const bare = entryFor({ ...g1[7], index: 9999, name: 'Nowhere' } as never, 1);
check('a world with no generated prose still has an entry',
  entryHtml(bare).includes('Nowhere'));
check('...and simply omits the prose block',
  !entryHtml(bare).includes('entry-prose'));
check('the reader still returns undefined for an undescribed world',
  systemDescription({ ...g1[7], name: 'Nowhere' } as never, 1) === undefined);
