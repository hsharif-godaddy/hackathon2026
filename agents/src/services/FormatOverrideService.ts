import fs from 'node:fs/promises';
import path from 'node:path';

import { AppRepository } from '../database/repositories/AppRepository.js';
import type { App } from '../database/schema.js';
import { logger } from '../logging/index.js';
import { type GitCommandResult, GitUtils } from '../utils/git.js';
import { createForWorkspace } from '../workspace/index.js';

export type FormatOverrideSourceKind = 'bound-expression' | 'content-key' | 'content-key-template';

export interface FormatOverrideTarget {
  file: string;
  tagName: string;
  sourceKind: FormatOverrideSourceKind;
  contentKey?: string | null;
  contentKeyTemplate?: string | null;
  expressionHash?: string | null;
}

export interface FormatOverrideMarks {
  bold?: boolean;
  italic?: boolean;
  color?: string | null;
}

export interface FormatOverrideUpdateRequest {
  devId: string;
  target: FormatOverrideTarget;
  marks: FormatOverrideMarks;
}

export interface FormatOverrideUpdateResponse {
  success: boolean;
  commitHash?: string;
  removed?: boolean;
  error?: string;
}

interface NormalizedFormatOverrideTarget {
  file: string;
  tagName: string;
  sourceKind: FormatOverrideSourceKind;
  contentKey: string | null;
  contentKeyTemplate: string | null;
  expressionHash: string | null;
}

interface NormalizedFormatOverrideMarks {
  bold: boolean;
  italic: boolean;
  color: string | null;
}

interface FormatOverrideEntry {
  target: NormalizedFormatOverrideTarget;
  marks: NormalizedFormatOverrideMarks;
  updatedAt: string;
}

interface NormalizedFormatOverrideUpdateRequest {
  devId: string;
  target: NormalizedFormatOverrideTarget;
  marks: NormalizedFormatOverrideMarks;
}

interface FormatOverrideSidecar {
  version: 1;
  overrides: Record<string, FormatOverrideEntry>;
}

interface FormatOverrideScope {
  key: string;
  relativePath: string;
}

type AppRepositoryReader = Pick<AppRepository, 'findById'>;

const SIDECAR_DIRNAME = 'format-overrides';
const SOURCE_KINDS = new Set<FormatOverrideSourceKind>(['bound-expression', 'content-key', 'content-key-template']);
const EXPRESSION_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DEV_ID_PATTERN = /^[0-9a-f]{6}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const SUPPORTED_MARKS = new Set(['bold', 'italic', 'color']);
const sidecarLocks = new Map<string, Promise<void>>();

export class FormatOverrideValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatOverrideValidationError';
  }
}

export class FormatOverrideNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatOverrideNotFoundError';
  }
}

class FormatOverrideSidecarReadError extends Error {
  constructor() {
    super('Format override sidecar is invalid');
    this.name = 'FormatOverrideSidecarReadError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new FormatOverrideValidationError(`${field} is required`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FormatOverrideValidationError(`${field} is required`);
  }
  return value.trim();
}

function requireDevId(value: unknown): string {
  const devId = requireString(value, 'devId');
  if (!DEV_ID_PATTERN.test(devId)) {
    throw new FormatOverrideValidationError('devId must be a 6-character hex id');
  }
  return devId;
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeColor(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
    throw new FormatOverrideValidationError('marks.color must be a 6-digit hex color');
  }
  return value.toLowerCase();
}

function normalizeSourceFile(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  const srcIndex = normalized.indexOf('/src/');
  if (srcIndex !== -1) return normalized.slice(srcIndex + 1);
  return normalized.replace(/^\/+/, '');
}

function parseSourceKind(value: unknown): FormatOverrideSourceKind {
  if (!SOURCE_KINDS.has(value as FormatOverrideSourceKind)) {
    throw new FormatOverrideValidationError('target.sourceKind is invalid');
  }
  return value as FormatOverrideSourceKind;
}

function normalizeTarget(value: unknown): NormalizedFormatOverrideTarget {
  const target = requireRecord(value, 'target');
  const sourceKind = parseSourceKind(target.sourceKind);
  const normalized: NormalizedFormatOverrideTarget = {
    file: normalizeSourceFile(requireString(target.file, 'target.file')),
    tagName: requireString(target.tagName, 'target.tagName').toLowerCase(),
    sourceKind,
    contentKey: normalizeNullableString(target.contentKey),
    contentKeyTemplate: normalizeNullableString(target.contentKeyTemplate),
    expressionHash: normalizeNullableString(target.expressionHash),
  };

  if (sourceKind === 'bound-expression' && !normalized.expressionHash) {
    throw new FormatOverrideValidationError('target.expressionHash is required for bound-expression format overrides');
  }
  if (normalized.expressionHash && !EXPRESSION_HASH_PATTERN.test(normalized.expressionHash)) {
    throw new FormatOverrideValidationError('target.expressionHash must be a sha256 hash');
  }
  if (sourceKind === 'content-key' && !normalized.contentKey) {
    throw new FormatOverrideValidationError('target.contentKey is required for content-key format overrides');
  }
  if (sourceKind === 'content-key-template' && !normalized.contentKeyTemplate) {
    throw new FormatOverrideValidationError('target.contentKeyTemplate is required for content-key-template format overrides');
  }

  return normalized;
}

function normalizeMarks(value: unknown): NormalizedFormatOverrideMarks {
  const marks = requireRecord(value, 'marks');
  for (const key of Object.keys(marks)) {
    if (!SUPPORTED_MARKS.has(key)) {
      throw new FormatOverrideValidationError(`marks.${key} is not supported`);
    }
  }
  if (marks.bold !== undefined && typeof marks.bold !== 'boolean') {
    throw new FormatOverrideValidationError('marks.bold must be a boolean');
  }
  if (marks.italic !== undefined && typeof marks.italic !== 'boolean') {
    throw new FormatOverrideValidationError('marks.italic must be a boolean');
  }

  return {
    bold: marks.bold === true,
    italic: marks.italic === true,
    color: normalizeColor(marks.color),
  };
}

function normalizeRequest(value: unknown): NormalizedFormatOverrideUpdateRequest {
  const request = requireRecord(value, 'request');
  return {
    devId: requireDevId(request.devId),
    target: normalizeTarget(request.target),
    marks: normalizeMarks(request.marks),
  };
}

function hasMarks(marks: NormalizedFormatOverrideMarks): boolean {
  return marks.bold || marks.italic || marks.color !== null;
}

function toSafePagePath(rawPagePath: string): string | null {
  const segments = rawPagePath.split('/');
  if (segments.some((segment) => !/^[a-zA-Z0-9_-]+$/.test(segment))) return null;

  return segments.map((segment) => segment.toLowerCase()).join('/');
}

function deriveFormatOverrideScope(file: string): FormatOverrideScope {
  // Keep this scope derivation in sync with app-templates/v8/src/lib/format-overrides.ts.
  // The server writes by target.file and the runtime reads by the same derived scope key.
  const normalized = normalizeSourceFile(file);
  const pageMatch = /^src\/pages\/(.+)\.[jt]sx?$/.exec(normalized);
  if (!pageMatch?.[1]) {
    return { key: 'shared', relativePath: path.posix.join(SIDECAR_DIRNAME, 'shared.json') };
  }

  const pagePath = toSafePagePath(pageMatch[1]);
  if (!pagePath) {
    return { key: 'shared', relativePath: path.posix.join(SIDECAR_DIRNAME, 'shared.json') };
  }

  return {
    key: `pages/${pagePath}`,
    relativePath: path.posix.join(SIDECAR_DIRNAME, 'pages', `${pagePath}.json`),
  };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

function normalizedPayloadMatches(
  entry: FormatOverrideEntry | undefined,
  target: NormalizedFormatOverrideTarget,
  marks: NormalizedFormatOverrideMarks,
): boolean {
  if (!entry) return false;
  return stableStringify({ target: entry.target, marks: entry.marks }) === stableStringify({ target, marks });
}

function createEmptySidecar(): FormatOverrideSidecar {
  return { version: 1, overrides: {} };
}

async function runWithSidecarLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = sidecarLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  sidecarLocks.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (sidecarLocks.get(key) === tail) {
      sidecarLocks.delete(key);
    }
  }
}

function parseStoredEntry(value: unknown): FormatOverrideEntry | null {
  if (!isRecord(value) || typeof value.updatedAt !== 'string') return null;

  try {
    const target = normalizeTarget(value.target);
    const marks = normalizeMarks(value.marks);
    const entry = { target, marks, updatedAt: value.updatedAt };

    // Stored sidecars should already be in the explicit normalized v1 shape
    // written by this service. If not, treat the whole sidecar as stale input.
    return stableStringify(entry) === stableStringify(value) ? entry : null;
  } catch {
    return null;
  }
}

function parseStoredOverrides(overrides: Record<string, unknown>): Record<string, FormatOverrideEntry> | null {
  const parsedEntries: Array<[string, FormatOverrideEntry]> = [];
  for (const [devId, entry] of Object.entries(overrides)) {
    if (!DEV_ID_PATTERN.test(devId)) return null;
    const parsedEntry = parseStoredEntry(entry);
    if (!parsedEntry) return null;
    parsedEntries.push([devId, parsedEntry]);
  }
  return Object.fromEntries(parsedEntries);
}

function logGitCommandFailure(
  appId: string,
  stage: 'add' | 'commit',
  result: GitCommandResult,
  relativeFiles: string[],
): void {
  logger.warn('formatOverrides.gitCommit.failed', {
    appId,
    stage,
    relativeFiles,
    command: result.command,
    exitCode: result.exitCode,
    stderr: result.stderr,
    stdout: result.stdout,
    timedOut: result.timedOut,
  });
}

export class FormatOverrideService {
  constructor(private readonly appRepository: AppRepositoryReader = new AppRepository()) {}

  async update(appId: string, rawRequest: unknown): Promise<FormatOverrideUpdateResponse> {
    const app = this.resolveApp(appId);
    const request = normalizeRequest(rawRequest);
    const scope = deriveFormatOverrideScope(request.target.file);
    return runWithSidecarLock(`${appId}:${scope.relativePath}`, () => this.applyUpdate(app, request, scope));
  }

  private async applyUpdate(
    app: App,
    request: NormalizedFormatOverrideUpdateRequest,
    scope: FormatOverrideScope,
  ): Promise<FormatOverrideUpdateResponse> {
    const sidecarPath = path.join(app.path, scope.relativePath);
    const sidecar = await this.readSidecar(sidecarPath);
    const existingEntry = sidecar.overrides[request.devId];
    const shouldWriteEntry = hasMarks(request.marks);

    if (shouldWriteEntry) {
      if (normalizedPayloadMatches(existingEntry, request.target, request.marks)) {
        return { success: true };
      }

      sidecar.overrides[request.devId] = {
        target: request.target,
        marks: request.marks,
        updatedAt: new Date().toISOString(),
      };
    } else {
      if (!existingEntry) {
        return { success: true, removed: true };
      }
      delete sidecar.overrides[request.devId];
    }

    await this.writeSidecar(sidecarPath, sidecar);
    const commitHash = await this.commitSidecar(app.id, app.path, [scope.relativePath]);

    return {
      success: true,
      ...(commitHash ? { commitHash } : {}),
      ...(!shouldWriteEntry ? { removed: true } : {}),
    };
  }

  private resolveApp(appId: string): App {
    const app = this.appRepository.findById(appId);
    if (!app) {
      throw new FormatOverrideNotFoundError('App not found');
    }
    return app;
  }

  private async readSidecar(sidecarPath: string): Promise<FormatOverrideSidecar> {
    try {
      const parsed = JSON.parse(await fs.readFile(sidecarPath, 'utf-8')) as unknown;
      if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.overrides)) {
        logger.warn('formatOverrides.sidecar.invalid', {
          sidecarPath,
          version: isRecord(parsed) ? parsed.version : undefined,
        });
        throw new FormatOverrideSidecarReadError();
      }

      const overrides = parseStoredOverrides(parsed.overrides);
      if (!overrides) {
        logger.warn('formatOverrides.sidecar.invalid', {
          sidecarPath,
          version: parsed.version,
        });
        throw new FormatOverrideSidecarReadError();
      }

      return { version: 1, overrides };
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        return createEmptySidecar();
      }
      if (error instanceof SyntaxError) {
        logger.warn('formatOverrides.sidecar.readFailed', {
          sidecarPath,
          error: error.message,
        });
        throw new FormatOverrideSidecarReadError();
      }

      throw error;
    }
  }

  private async writeSidecar(sidecarPath: string, sidecar: FormatOverrideSidecar): Promise<void> {
    if (Object.keys(sidecar.overrides).length === 0) {
      await fs.rm(sidecarPath, { force: true });
      return;
    }

    const sidecarDir = path.dirname(sidecarPath);
    const tempPath = path.join(
      sidecarDir,
      `.${path.basename(sidecarPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
    );

    await fs.mkdir(sidecarDir, { recursive: true });
    try {
      await fs.writeFile(tempPath, stableStringify({ version: 1, overrides: sidecar.overrides }));
      await fs.rename(tempPath, sidecarPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
  }

  private async commitSidecar(appId: string, appPath: string, relativeFiles: string[]): Promise<string | undefined> {
    try {
      const workspace = createForWorkspace(appId, 'preview');
      if (!workspace) return undefined;

      const gitUtils = new GitUtils(workspace.tasks);
      const addResult = await gitUtils.addFiles(appPath, relativeFiles);
      if (!addResult.success) {
        logGitCommandFailure(appId, 'add', addResult, relativeFiles);
        return undefined;
      }

      const commitResult = await gitUtils.commitFiles(appPath, 'Update format overrides', relativeFiles);
      if (!commitResult.success) {
        logGitCommandFailure(appId, 'commit', commitResult, relativeFiles);
        return undefined;
      }

      return await gitUtils.getCurrentCommit(appPath);
    } catch (error) {
      logger.warn('formatOverrides.gitCommit.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
