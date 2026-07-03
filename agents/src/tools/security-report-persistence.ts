import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { type VulnerabilityScannerResult } from './vulnerability-scanner-tool.js';

const MAX_REPORTS = 10;

export interface SecurityReportEntry {
  id: string;
  scannedAt: string;
  executionTime: number;
  result: VulnerabilityScannerResult;
}

export interface SecurityReportFile {
  version: number;
  reports: SecurityReportEntry[];
}

// Per-appPath write queue — serializes concurrent read-modify-write calls so a
// second scan finishing while the first is still writing doesn't clobber it.
const writeQueue = new Map<string, Promise<void>>();

async function writeReportFile(appPath: string, result: VulnerabilityScannerResult): Promise<void> {
  const airoDir = path.join(appPath, '.airo');
  const reportPath = path.join(airoDir, 'security-report.json');

  await fs.mkdir(airoDir, { recursive: true });

  let existing: SecurityReportFile = { version: 1, reports: [] };
  try {
    const raw = await fs.readFile(reportPath, 'utf-8');
    existing = JSON.parse(raw) as SecurityReportFile;
  } catch {
    // file doesn't exist yet — start fresh
  }

  const entry: SecurityReportEntry = {
    id: nanoid(8),
    scannedAt: new Date().toISOString(),
    executionTime: result.executionTime,
    result,
  };

  existing.reports = [entry, ...existing.reports].slice(0, MAX_REPORTS);

  await fs.writeFile(reportPath, JSON.stringify(existing, null, 2), 'utf-8');
}

export function appendSecurityReport(appPath: string, result: VulnerabilityScannerResult): Promise<void> {
  const prior = writeQueue.get(appPath) ?? Promise.resolve();
  const next = prior.then(() => writeReportFile(appPath, result));
  writeQueue.set(appPath, next.catch(() => {}));
  return next;
}
