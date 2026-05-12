export interface ParsedReleaseLine {
  icon: string;
  label: string;
  url: string | null;
}

export interface ParsedPr {
  number: string;
  title: string;
  author: string;
}

export interface ParsedRelease {
  tag: string;
  published_at: string;
  age: string;
  author: string;
  html_url: string;
  diff_url: string | null;
  prs: ParsedPr[];
  slack_url: string | null;
  test: ParsedReleaseLine[];
  prod: ParsedReleaseLine[];
}

const PR_LINE = /^[•\-*]\s+#(\d+)\s+(.*?)\s+\u2014\s+@(\S+)/;
const SECTION_HEADER = /^\*{1,2}([A-Z][A-Z\s]+?)\*{1,2}$/;
const VIEW_RUN = /\s*\u2014\s*View Run\b/i;

export function ago(publishedAt: string): string {
  if (!publishedAt) return '';
  const t = new Date(publishedAt).getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return 'just now';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 8) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function firstCompareUrl(lines: string[]): string | null {
  const head = lines.slice(0, 5);
  for (const line of head) {
    const re = /\[([^\]]+)\]\((https?:\/\/[^)]+compare[^)]+)\)/;
    const m2 = re.exec(line);
    if (m2) return m2[2] ?? null;
  }
  return null;
}

function parseSlackUrl(body: string): string | null {
  for (const line of body.split('\n')) {
    const mSl = /\[([^\]]*[Ss]lack[^\]]*)\]\((https?:\/\/[^)]*slack\.com[^)]*)\)/.exec(line);
    if (mSl) return mSl[2] ?? null;
    const mPlain = /[Ss]lack[^\n]*?(https?:\/\/[^\s]*slack\.com[^\s]*)/.exec(line);
    if (mPlain) return mPlain[1] ?? null;
  }
  return null;
}

export function parseRelease(rel: Record<string, unknown>): ParsedRelease {
  const tag = typeof rel.tag_name === 'string' ? rel.tag_name : 'unknown';
  const published = typeof rel.published_at === 'string' ? rel.published_at : '';
  const authorObj = rel.author && typeof rel.author === 'object' ? (rel.author as Record<string, unknown>) : null;
  const author = typeof authorObj?.login === 'string' ? authorObj.login : 'unknown';
  const bodyRaw = rel.body;
  const body = typeof bodyRaw === 'string' ? bodyRaw : '';
  const html_url = typeof rel.html_url === 'string' ? rel.html_url : '';

  const prs: ParsedPr[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    const m = PR_LINE.exec(line);
    if (m) {
      prs.push({ number: m[1] ?? '', title: (m[2] ?? '').trim(), author: m[3] ?? '' });
    }
  }

  const diff_url = firstCompareUrl(body.split('\n'));

  const sections: Record<string, ParsedReleaseLine[]> = {};
  let current: string | null = null;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\u00a0/g, ' ').trim();
    if (!line) continue;
    const m3 = SECTION_HEADER.exec(line);
    if (m3) {
      const name = m3[1]?.replace(/\s+/g, ' ').trim() ?? '';
      if (name === 'TEST' || name === 'PROD') {
        current = name;
        sections[current] = [];
        continue;
      }
    }
    if (line.startsWith('---')) {
      current = null;
      continue;
    }
    if (!current || !(current in sections)) continue;

    const urlSingle = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(line);
    let icon = '';
    if (line.startsWith('✅')) icon = '✅';
    else if (line.startsWith('❌')) icon = '❌';
    else if (line.startsWith('⏩')) icon = '⏩';

    let clean = line.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1');
    clean = clean.replace(/[*`]/g, '');
    clean = clean.replace(/^[✅⏩❌]\s*/, '').trim();
    clean = clean.replace(VIEW_RUN, '').trim();

    sections[current].push({
      icon,
      label: clean,
      url: urlSingle?.[2] ?? null,
    });
  }

  return {
    tag,
    published_at: published,
    age: ago(published),
    author,
    html_url,
    diff_url,
    prs,
    slack_url: parseSlackUrl(body),
    test: sections.TEST ?? [],
    prod: sections.PROD ?? [],
  };
}
