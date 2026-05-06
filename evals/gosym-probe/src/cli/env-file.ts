import { readFile, writeFile } from 'node:fs/promises';

export type EnvLine =
  | { kind: 'comment'; raw: string }
  | { kind: 'blank'; raw: string }
  | { kind: 'entry'; key: string; value: string };

export const SENSITIVE_KEYS = ['OPENAI_API_KEY'];

const ENTRY_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function parseValue(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

function serializeValue(value: string): string {
  if (value === '' || /[\s"#]/.test(value)) {
    return `"${value}"`;
  }
  return value;
}

export function parseEnvFile(content: string): EnvLine[] {
  return content.split('\n').map((raw): EnvLine => {
    if (raw.trim() === '') return { kind: 'blank', raw };
    if (raw.trimStart().startsWith('#')) return { kind: 'comment', raw };
    const m = raw.match(ENTRY_RE);
    if (m) {
      return { kind: 'entry', key: m[1]!, value: parseValue(m[2]!) };
    }
    return { kind: 'comment', raw };
  });
}

export function serializeEnvFile(lines: EnvLine[]): string {
  return lines
    .map((line) => {
      if (line.kind === 'entry') {
        return `${line.key}=${serializeValue(line.value)}`;
      }
      return line.raw;
    })
    .join('\n');
}

export function getEnvValue(
  lines: EnvLine[],
  key: string,
): string | undefined {
  const entry = lines.find(
    (l): l is Extract<EnvLine, { kind: 'entry' }> =>
      l.kind === 'entry' && l.key === key,
  );
  return entry?.value;
}

export function getEnvEntries(
  lines: EnvLine[],
): Record<string, string> {
  return Object.fromEntries(
    lines
      .filter(
        (l): l is Extract<EnvLine, { kind: 'entry' }> =>
          l.kind === 'entry',
      )
      .map((l) => [l.key, l.value]),
  );
}

export function setEnvValue(
  lines: EnvLine[],
  key: string,
  value: string,
): EnvLine[] {
  let found = false;
  const updated = lines.map((line): EnvLine => {
    if (line.kind === 'entry' && line.key === key) {
      found = true;
      return { kind: 'entry', key, value };
    }
    return line;
  });
  if (!found) {
    updated.push({ kind: 'entry', key, value });
  }
  return updated;
}

export async function readEnvFile(filePath: string): Promise<EnvLine[]> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8') as string;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  return parseEnvFile(content);
}

export async function writeEnvFile(
  filePath: string,
  lines: EnvLine[],
): Promise<void> {
  await writeFile(filePath, serializeEnvFile(lines), 'utf8');
}
