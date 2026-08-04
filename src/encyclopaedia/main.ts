// The encyclopaedia page: chart, filter rail, detail panel.
//
// The document already holds all 256 entries when this runs — the Vite plugin
// in vite.config.ts wrote them at build time from `entryHtml()`. This file is
// the enhancement over a page that is already complete: with no JavaScript the
// reader still gets every world, correctly marked up, which is the whole
// reason the page is built in that order.
//
// Nothing here re-renders an entry. The detail panel shows the document's own
// markup, so this module never imports the descriptions and the page never
// ships the prose a second time.
//
// Everything platform-bound lives here and in chart.ts. entry.ts and
// filters.ts are pure and are what `npm run portability` counts.

import { generateGalaxy } from '../galaxy/galaxy.ts';
import { TECH_MIN, TECH_MAX } from '../constants/tech-level.ts';
import { factsFor, type Entry } from './entry.ts';
import {
  emptyFilter, facetsOf, selectSlugs, isUntouched, type Filter,
} from './filters.ts';
import { Chart } from './chart.ts';

const GALAXY = 1;

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`encyclopaedia: no #${id}`);
  return found as T;
};

const entries: Entry[] = generateGalaxy(GALAXY).map((s) => factsFor(s, GALAXY));
const bySlug = new Map(entries.map((e) => [e.slug, e]));
const filter: Filter = emptyFilter();

// The static articles the build wrote. Held by slug so filtering is a class
// toggle rather than a re-render — re-rendering 256 entries on every keystroke
// is the obvious way to write this and it janks badly.
const articles = new Map<string, HTMLElement>();
for (const node of document.querySelectorAll<HTMLElement>('#index .entry')) {
  const slug = node.dataset.slug;
  if (slug) articles.set(slug, node);
}

const detail = el('detail');
const count = el('count');
let chart: Chart;

// --- selection --------------------------------------------------------------

/**
 * Show one world, and put it in the URL so the view can be shared.
 *
 * The panel is filled from the DOCUMENT'S OWN entry — the markup the build
 * wrote — rather than by rendering a second copy. Two reasons, and the second
 * is the important one: the page would otherwise ship all 256 descriptions
 * twice, as markup and again as a 261 kB script chunk; and reading the same
 * markup both paths read is what makes "it works without JavaScript" true by
 * construction rather than by remembering to keep two renderings in step.
 *
 * `replaceState` rather than `pushState`: clicking twenty stars while reading
 * should not bury the page the reader arrived on under twenty back-button
 * presses. The URL is a shareable address here, not a history of browsing.
 */
function select(slug: string | null, updateUrl = true): void {
  const e = slug ? bySlug.get(slug) : undefined;
  const source = e ? articles.get(e.slug) : undefined;

  detail.innerHTML = source
    ? source.innerHTML
    : '<p class="detail-hint">Pick a world from the chart, or scroll for the full index.</p>';
  detail.classList.toggle('is-empty', !source);
  chart.select(e?.slug ?? null);

  for (const [s, node] of articles) node.classList.toggle('is-selected', s === e?.slug);

  if (updateUrl) {
    const url = new URL(window.location.href);
    if (e) url.searchParams.set('w', e.slug);
    else url.searchParams.delete('w');
    window.history.replaceState(null, '', url);
  }
}

// --- filtering --------------------------------------------------------------

function applyFilter(): void {
  const untouched = isUntouched(filter);
  const lit = untouched ? null : selectSlugs(entries, filter);

  chart.setLit(lit);
  for (const [slug, node] of articles) {
    node.hidden = !!lit && !lit.has(slug);
  }

  const n = lit ? lit.size : entries.length;
  count.textContent = `${n} of ${entries.length} worlds`;
  count.classList.toggle('is-narrowed', !untouched);
  el('reset').hidden = untouched;
}

/** A checkbox group in the rail. Returns nothing — it wires itself up. */
function buildGroup(
  host: HTMLElement,
  title: string,
  options: { value: string; label: string; count: number }[],
  set: Set<string | number>,
  cast: (v: string) => string | number,
): void {
  const group = document.createElement('fieldset');
  group.className = 'facet';
  group.innerHTML = `<legend>${title}</legend>`;
  for (const o of options) {
    const id = `f-${title}-${o.value}`.replace(/\W+/g, '-').toLowerCase();
    const row = document.createElement('label');
    row.className = 'facet-row';
    row.innerHTML = `<input type="checkbox" id="${id}" value="${o.value}"/>`
      + `<span class="facet-label">${o.label}</span>`
      + `<span class="facet-count">${o.count}</span>`;
    row.querySelector('input')!.addEventListener('change', (ev) => {
      const box = ev.target as HTMLInputElement;
      if (box.checked) set.add(cast(box.value));
      else set.delete(cast(box.value));
      applyFilter();
    });
    group.append(row);
  }
  host.append(group);
}

function buildRail(): void {
  const rail = el('facets');
  const f = facetsOf(entries);

  buildGroup(rail, 'Economy',
    f.economies.map((o) => ({ value: String(o.value), label: o.label, count: o.count })),
    filter.economies as Set<string | number>, Number);

  buildGroup(rail, 'Government',
    f.governments.map((o) => ({ value: String(o.value), label: o.label, count: o.count })),
    filter.governments as Set<string | number>, Number);

  buildGroup(rail, 'Inhabitants',
    f.species.map((o) => ({ value: o.value, label: o.value, count: o.count })),
    filter.species as Set<string | number>, String);

  // Tech level is a range, not a set — fifteen checkboxes for an ordered scale
  // would be a worse control than two numbers.
  const tech = document.createElement('fieldset');
  tech.className = 'facet';
  tech.innerHTML = `<legend>Tech level</legend>
    <div class="facet-range">
      <label>from <input type="number" id="tl-min" min="${TECH_MIN}" max="${TECH_MAX}" value="${TECH_MIN}"/></label>
      <label>to <input type="number" id="tl-max" min="${TECH_MIN}" max="${TECH_MAX}" value="${TECH_MAX}"/></label>
    </div>`;
  rail.append(tech);

  const clamp = (v: number) => Math.min(TECH_MAX, Math.max(TECH_MIN, v || TECH_MIN));
  for (const [id, key] of [['tl-min', 'techMin'], ['tl-max', 'techMax']] as const) {
    el<HTMLInputElement>(id).addEventListener('input', (ev) => {
      filter[key] = clamp(Number((ev.target as HTMLInputElement).value));
      applyFilter();
    });
  }

  el<HTMLInputElement>('search').addEventListener('input', (ev) => {
    filter.search = (ev.target as HTMLInputElement).value.trim();
    applyFilter();
  });

  el('reset').addEventListener('click', () => {
    filter.economies.clear();
    filter.governments.clear();
    filter.species.clear();
    filter.search = '';
    filter.techMin = TECH_MIN;
    filter.techMax = TECH_MAX;
    for (const box of document.querySelectorAll<HTMLInputElement>('#facets input[type=checkbox]')) {
      box.checked = false;
    }
    el<HTMLInputElement>('search').value = '';
    el<HTMLInputElement>('tl-min').value = String(TECH_MIN);
    el<HTMLInputElement>('tl-max').value = String(TECH_MAX);
    applyFilter();
  });
}

// --- start ------------------------------------------------------------------

chart = new Chart(el<HTMLCanvasElement>('chart'), entries, (slug) => select(slug));
buildRail();
applyFilter();

// Clicking a heading in the static index selects it on the chart too, so the
// two halves of the page are one thing rather than a map and a list that
// happen to sit together.
for (const [slug, node] of articles) {
  node.querySelector('.entry-name')?.addEventListener('click', () => {
    select(slug);
    el('chart').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

el('zoom-out').addEventListener('click', () => chart.reset());

// `?w=lave` opens on Lave. Read once at start; nothing writes history, so
// there is no popstate to answer.
const wanted = new URL(window.location.href).searchParams.get('w');
select(wanted && bySlug.has(wanted) ? wanted : null, false);

document.body.classList.add('is-interactive');
