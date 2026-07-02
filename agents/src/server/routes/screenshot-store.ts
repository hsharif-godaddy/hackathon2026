import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { basename, join, normalize, resolve, sep } from 'path';

import type { App } from '../../database/index.js';
import { createForWorkspace, type WorkspaceClient } from '../../workspace/index.js';
import { collectBoundedBuffer } from '../../workspace/files.js';
import { logger } from '../../logging/index.js';

/**
 * Abstraction for screenshot storage. Two implementations:
 * - HostScreenshotStore: direct fs writes to an agent-controlled directory
 *   (used when SCREENSHOT_DIR is set, or in local-dev for preview workspaces)
 * - WorkspaceScreenshotStore: routes writes through the Workspace API / dev-supervisor
 *   (used when the screenshot belongs in the customer workspace)
 */
export interface ScreenshotStore {
  write(appId: string, buffer: Buffer): Promise<{ location: string }>;
  read(appId: string): Promise<Buffer>;
  exists(appId: string): Promise<boolean>;
  /**
   * Absolute host path for use with res.sendFile(), enabling efficient
   * streaming without buffering the file into memory. Returns null for
   * workspace-backed stores where no host path exists.
   */
  resolvePath(appId: string): string | null;
}

function screenshotFilename(appId: string): string {
  return `${appId}-screenshot.png`;
}

/**
 * Resolves screenshot storage directory on the host filesystem.
 * Preserves the original routing logic from the removed screenshot-paths.ts.
 */
function resolveHostDir(appPath: string): string {
  if (process.env.SCREENSHOT_DIR) {
    return process.env.SCREENSHOT_DIR;
  }

  const normalizedAppPath: string = normalize(appPath);

  if (basename(normalizedAppPath) === 'preview') {
    return `${resolve(normalizedAppPath, '..')}${sep}agent`;
  }

  return normalizedAppPath;
}

/**
 * Validates that a resolved file path stays within the expected directory.
 * Prevents path-traversal via malformed appId values.
 */
function isWithinDir(filePath: string, dir: string): boolean {
  const resolved: string = resolve(filePath);
  const resolvedDir: string = resolve(dir);
  return resolved.startsWith(resolvedDir + sep);
}

class HostScreenshotStore implements ScreenshotStore {
  private readonly dir: string;

  constructor(appPath: string) {
    this.dir = resolveHostDir(appPath);
  }

  async write(appId: string, buffer: Buffer): Promise<{ location: string }> {
    const filePath: string = join(this.dir, screenshotFilename(appId));
    if (!isWithinDir(filePath, this.dir)) {
      throw new Error(`Screenshot path escapes allowed directory: ${appId}`);
    }
    await mkdir(this.dir, { recursive: true });
    await writeFile(filePath, buffer);
    return { location: filePath };
  }

  async read(appId: string): Promise<Buffer> {
    const filePath: string = join(this.dir, screenshotFilename(appId));
    if (!isWithinDir(filePath, this.dir)) {
      throw new Error(`Screenshot path escapes allowed directory: ${appId}`);
    }
    return readFile(filePath);
  }

  async exists(appId: string): Promise<boolean> {
    const filePath: string = join(this.dir, screenshotFilename(appId));
    if (!isWithinDir(filePath, this.dir)) return false;
    return existsSync(filePath);
  }

  resolvePath(appId: string): string | null {
    const filePath: string = join(this.dir, screenshotFilename(appId));
    if (!isWithinDir(filePath, this.dir)) return null;
    return filePath;
  }
}

class WorkspaceScreenshotStore implements ScreenshotStore {
  private readonly workspace: WorkspaceClient;

  constructor(workspace: WorkspaceClient) {
    this.workspace = workspace;
  }

  async write(appId: string, buffer: Buffer): Promise<{ location: string }> {
    const path: string = screenshotFilename(appId);
    await this.workspace.files.upload({ path, data: buffer });
    return { location: path };
  }

  async read(appId: string): Promise<Buffer> {
    const path: string = screenshotFilename(appId);
    const { stream, contentLength } = await this.workspace.files.download({ path });
    return collectBoundedBuffer(stream, contentLength);
  }

  async exists(appId: string): Promise<boolean> {
    const path: string = screenshotFilename(appId);
    const result = await this.workspace.files.stat({ paths: [path] });
    const entry = result.entries[0];
    return entry !== undefined && !('error' in entry && entry.error !== undefined);
  }

  resolvePath(_appId: string): string | null {
    return null;
  }
}

/**
 * Whether the screenshot for this app should be stored on the host
 * (agent-controlled directory) or routed through the workspace API.
 */
function shouldUseHost(appPath: string): boolean {
  if (process.env.SCREENSHOT_DIR) return true;
  if (basename(normalize(appPath)) === 'preview') return true;
  return false;
}

/**
 * Factory: returns the appropriate ScreenshotStore for the given app.
 * Falls back to HostScreenshotStore if the workspace is unavailable.
 */
export function getScreenshotStore(app: App): ScreenshotStore {
  if (shouldUseHost(app.path)) {
    return new HostScreenshotStore(app.path);
  }

  const workspace: WorkspaceClient | null = createForWorkspace(app.id, 'preview');
  if (!workspace) {
    logger.warn('screenshotStore.workspaceUnavailable.fallback', { appId: app.id });
    return new HostScreenshotStore(app.path);
  }

  return new WorkspaceScreenshotStore(workspace);
}
