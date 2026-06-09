import { readFile } from 'node:fs/promises';

export interface TaxonomyRow {
  evaluatorKey: string;
  name: string | null;
  description: string | null;
  evaluatorType: string | null;
  scoreType: string | null;
  model: string | null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function loadTaxonomy(htmlPath: string): Promise<Map<string, TaxonomyRow>> {
  const html = await readFile(htmlPath, 'utf8');
  const map = new Map<string, TaxonomyRow>();

  const rowRe =
    /<tr[^>]*onclick="location\.href='\/ui\/report\/evaluator\/([^']+)'[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const evaluatorKey = m[1]!;
    const rowHtml = m[2] ?? '';
    const tds = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((x) => x[1] ?? '');
    if (tds.length < 2) continue;

    const name = tds[0] ? decodeEntities(stripTags(tds[0])) : null;
    const description = tds[1] ? decodeEntities(stripTags(tds[1])) : null;
    const evaluatorType = tds[2] ? decodeEntities(stripTags(tds[2])) : null;
    const scoreType = tds[3] ? decodeEntities(stripTags(tds[3])) : null;
    const model = tds[4] ? decodeEntities(stripTags(tds[4])) : null;

    map.set(evaluatorKey, {
      evaluatorKey,
      name,
      description,
      evaluatorType,
      scoreType,
      model,
    });
  }

  return map;
}

export function requiresScreenshots(params: { taxonomyDescription: string | null; evaluatorId: string }): boolean {
  const d = (params.taxonomyDescription ?? '').toLowerCase();

  // Use taxonomy description as primary signal.
  // We prefer false-negatives over false-positives? In calibration, false-negative is worse
  // because the judge may miss critical visual evidence. So err slightly toward true.
  const hits = [
    'screenshot',
    'screenshots',
    'visual',
    'layout',
    'appearance',
    'design',
    'aesthetic',
    'above the fold',
    'ui',
    'ux',
    'usability',
    'broken',
    'overlap',
    'spacing',
    'typography',
    'color',
    'contrast',
    'hierarchy',
    'look',
  ];
  if (hits.some((h) => d.includes(h))) return true;

  // Some metrics are inherently artifact-visual even if the short description omits keywords.
  const id = params.evaluatorId.toLowerCase();
  if (id.includes('visual')) return true;
  if (id.includes('usability')) return true;
  if (id.includes('layout')) return true;

  return false;
}

