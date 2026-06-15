#!/usr/bin/env node
/**
 * Regenerate src/fonts/google-fonts-catalog.ts from two KEYLESS public sources:
 *   1. https://fonts.google.com/metadata/fonts        -> family, category, weights
 *   2. https://raw.githubusercontent.com/google/fonts/main/tags/all/families.csv -> tags
 *
 * No API key required. Run manually to refresh:
 *   node packages/shared/scripts/gen-google-fonts-catalog.mjs
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const META_URL = 'https://fonts.google.com/metadata/fonts';
const TAGS_URL = 'https://raw.githubusercontent.com/google/fonts/main/tags/all/families.csv';
const TAG_SCORE_THRESHOLD = 50;
const PREFERRED_WEIGHTS = ['300', '400', '500', '600', '700'];

const CATEGORY_MAP = {
  'sans serif': 'sans-serif',
  serif: 'serif',
  monospace: 'monospace',
  handwriting: 'cursive',
  display: 'sans-serif',
};

// CSV top-level group -> Google Fonts UI label. Dropped groups (Purpose, Quality,
// Seasonal, Special use) are not surfaced as filters.
const GROUP_LABEL = {
  Expressive: 'Feeling',
  Theme: 'Appearance',
  Monospace: 'Appearance',
  Script: 'Calligraphy',
  Serif: 'Serif',
  Slab: 'Serif',
  Sans: 'Sans Serif',
};

function mapCategory(metaCategory) {
  return CATEGORY_MAP[String(metaCategory).trim().toLowerCase()] ?? 'sans-serif';
}

/**
 * Keep only fonts the public Google Fonts CSS API actually serves. The metadata
 * endpoint also lists Google brand fonts (e.g. "Google Sans", "Product Sans") that
 * 404 on fonts.googleapis.com — excluding them keeps both the searchable catalog
 * and the example-font chips from referencing un-loadable families.
 */
function isPublic(m) {
  return m.isOpenSource !== false && !m.isBrandFont;
}

/** numeric weight keys from the metadata `fonts` map (drop italics like "400i"). */
function normalizeWeights(fontsObj) {
  const available = new Set(
    Object.keys(fontsObj ?? {}).filter((k) => /^\d+$/.test(k)),
  );
  const chosen = PREFERRED_WEIGHTS.filter((w) => available.has(w));
  // Don't force '400' onto families that don't ship it (Google silently ignores
  // the missing weight, but the catalog would then advertise a weight that 404s);
  // the ternary below already falls back to ['400'] only when nothing matched.
  return chosen.length ? [...new Set(chosen)] : ['400'];
}

/** Parse families.csv -> Map<family, Set<"UILabel/Tag">> keeping score >= threshold. */
function parseTags(csv) {
  const byFamily = new Map();
  for (const line of csv.split('\n')) {
    if (!line.trim()) continue;
    // family, axis, /Group/Tag, score  (family may contain no commas in this dataset)
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const family = parts[0].trim();
    const tagPath = parts[2].trim();
    const score = Number(parts[3]);
    if (!family || !tagPath.startsWith('/') || Number.isNaN(score)) continue;
    if (score < TAG_SCORE_THRESHOLD) continue;
    const segs = tagPath.split('/').filter(Boolean); // ["Group","Tag",...]
    if (segs.length < 2) continue;
    const label = GROUP_LABEL[segs[0]];
    if (!label) continue;
    const tag = `${label}/${segs[segs.length - 1]}`;
    if (!byFamily.has(family)) byFamily.set(family, new Set());
    byFamily.get(family).add(tag);
  }
  return byFamily;
}

const metaRes = await fetch(META_URL);
if (!metaRes.ok) { console.error(`metadata/fonts: ${metaRes.status}`); process.exit(1); }
let metaText = await metaRes.text();
metaText = metaText.replace(/^\)\]\}'\s*/, ''); // strip XSSI prefix if present
const { familyMetadataList } = JSON.parse(metaText);

const tagsRes = await fetch(TAGS_URL);
if (!tagsRes.ok) { console.error(`families.csv: ${tagsRes.status}`); process.exit(1); }
const tagsByFamily = parseTags(await tagsRes.text());

const catalog = familyMetadataList
  .filter(isPublic)
  .map((m) => ({
    family: m.family,
    category: mapCategory(m.category),
    weights: normalizeWeights(m.fonts),
    tags: [...(tagsByFamily.get(m.family) ?? [])].sort(),
  }))
  .sort((a, b) => a.family.localeCompare(b.family));

// Per-tag example font: the most popular family carrying each tag. Used to render
// each filter chip's label in a representative typeface. Iterate by popularity
// (lower rank = more popular) so the first family seen for a tag is its best-known
// example. Written to a SEPARATE small module so chips can render without pulling
// in the ~600 KB catalog.
const byPopularity = [...familyMetadataList]
  .filter((m) => tagsByFamily.has(m.family) && isPublic(m))
  .sort((a, b) => (a.popularity ?? 1e9) - (b.popularity ?? 1e9));
const tagExampleFonts = {};
for (const m of byPopularity) {
  for (const tag of tagsByFamily.get(m.family)) {
    if (!(tag in tagExampleFonts)) tagExampleFonts[tag] = m.family;
  }
}
const tagExampleFamilies = [...new Set(Object.values(tagExampleFonts))].sort();

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, '../src/fonts/google-fonts-catalog.ts');
const header =
  `// AUTO-GENERATED by scripts/gen-google-fonts-catalog.mjs — do not edit by hand.\n` +
  `// Keyless refresh: node packages/shared/scripts/gen-google-fonts-catalog.mjs\n` +
  `import type { GoogleFontEntry } from './types.js';\n\n` +
  `export const GOOGLE_FONTS_CATALOG: GoogleFontEntry[] = `;
await writeFile(outPath, `${header}${JSON.stringify(catalog, null, 2)};\n`, 'utf8');
const tagged = catalog.filter((c) => c.tags.length).length;
console.log(`Wrote ${catalog.length} fonts (${tagged} with tags) to ${outPath}`);

const exPath = path.resolve(here, '../src/fonts/tag-example-fonts.ts');
const exContent =
  `// AUTO-GENERATED by scripts/gen-google-fonts-catalog.mjs — do not edit by hand.\n` +
  `// Keyless refresh: node packages/shared/scripts/gen-google-fonts-catalog.mjs\n\n` +
  `/** Canonical "Group/Tag" -> the most popular Google font carrying that tag. */\n` +
  `export const TAG_EXAMPLE_FONTS: Record<string, string> = ${JSON.stringify(tagExampleFonts, null, 2)};\n\n` +
  `/** Unique example-font families, for a single preload <link>. */\n` +
  `export const TAG_EXAMPLE_FONT_FAMILIES: string[] = ${JSON.stringify(tagExampleFamilies, null, 2)};\n`;
await writeFile(exPath, exContent, 'utf8');
console.log(`Wrote ${Object.keys(tagExampleFonts).length} tag example fonts (${tagExampleFamilies.length} families) to ${exPath}`);
