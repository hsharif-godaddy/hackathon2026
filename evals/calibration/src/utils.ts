import { access, readFile, writeFile } from 'node:fs/promises';

export function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

export function requiredArg(name: string): string {
  const value = readArg(name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

export function splitCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object';
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function loadSuiteScenarioKeys(suitePath: string): Promise<string[]> {
  const raw = await readFile(suitePath, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- key:'))
    .map((l) => l.replace(/^- key:\s*/, '').trim())
    .map((v) => v.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim())
    .filter(Boolean);
}
