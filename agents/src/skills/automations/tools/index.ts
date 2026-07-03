/**
 * Automations Skill Tools
 *
 * Server-side CRUD for reusable automation jobs stored under `.airo/jobs/`.
 * UUID generation happens here — never via a terminal command the LLM might
 * hallucinate from conversation history.
 *
 *   automations__create      — create a new automation and return its UUID
 *   automations__list        — list all saved automations
 *   automations__update      — update name, description, or body of an automation
 *   automations__delete      — tombstone a job file and remove it from the index
 *   automations__getHistory  — list run history summaries for an automation
 */

import { randomUUID } from 'node:crypto';

import matter from 'gray-matter';
import { z } from 'zod';

import type { SkillToolDefinition } from '@airo/ai-skills';
import { isDevSupervisorNotFound } from '../../../services/DevSupervisorClient.js';
import { logger } from '../../../logging/index.js';
import { createForWorkspace } from '../../../workspace/index.js';
import type { WorkspaceFiles } from '../../../workspace/files.js';

const INDEX_PATH = '.airo/jobs/index.json';
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_BODY_LENGTH = 10_000;

function jobFilePath(uuid: string): string {
  return `.airo/jobs/${uuid}/${uuid}.md`;
}

function serializeJob(name: string, description: string | undefined, body: string): string {
  const frontmatter: Record<string, string> = { name };
  if (description) frontmatter.description = description;
  return matter.stringify(body, frontmatter);
}

async function readIndex(files: WorkspaceFiles): Promise<string[]> {
  try {
    return JSON.parse(await files.readText({ path: INDEX_PATH })) as string[];
  } catch (err) {
    if (isDevSupervisorNotFound(err)) return [];
    throw err;
  }
}

async function writeIndex(files: WorkspaceFiles, uuids: string[]): Promise<void> {
  await files.write({ path: INDEX_PATH, content: JSON.stringify(uuids) });
}

function requireWorkspace(appId: string): WorkspaceFiles {
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    throw new Error('Workspace unavailable — the preview supervisor is not running.');
  }
  return workspace.files;
}

export const createTool: SkillToolDefinition = {
  name: 'create',
  description:
    'Create a new automation (saved prompt). ' +
    'Returns the UUID of the created automation. ' +
    'Call this instead of writing job files or generating UUIDs manually.',

  parameters: z.object({
    name: z
      .string()
      .max(MAX_NAME_LENGTH)
      .describe('Display name for the automation (max 100 chars)'),
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .optional()
      .describe('Optional short description (max 300 chars)'),
    body: z
      .string()
      .max(MAX_BODY_LENGTH)
      .describe('The prompt template text that will run when this automation is triggered (max 10 000 chars)'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;
    if (!appId) throw new Error('App ID required');

    const files = requireWorkspace(appId);
    const uuid = randomUUID();
    const content = serializeJob(input.name, input.description, input.body);

    await files.write({ path: jobFilePath(uuid), content });

    let index: string[];
    try {
      index = await readIndex(files);
    } catch (err) {
      // Index is present but unparseable — tombstone the just-written job to avoid orphans
      await files.write({ path: jobFilePath(uuid), content: '' });
      logger.error('automations.create.index_corrupt', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(
        'Your automations index appears to be corrupt. ' +
        'The partially-written job file has been removed to avoid an orphan. ' +
        'Please contact support or manually inspect `.airo/jobs/index.json`.',
      );
    }

    index.push(uuid);
    try {
      await writeIndex(files, index);
    } catch (err) {
      await files.write({ path: jobFilePath(uuid), content: '' });
      logger.error('automations.create.index_write_failed', {
        appId,
        uuid,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(
        'Could not save the automation — the index update failed. ' +
        'The job file has been removed to keep things consistent. Please try again.',
      );
    }

    logger.info('automations.create.success', { appId, uuid, name: input.name });
    return {
      success: true,
      uuid,
      name: input.name,
      message: `Automation '${input.name}' saved. Please refresh the Automations panel to see it.`,
    };
  },

  config: { requiresApp: true },
};

export const listTool: SkillToolDefinition = {
  name: 'list',
  description: 'List all saved automations for this app.',

  parameters: z.object({}),

  async execute(_input, context) {
    const appId = context?.metadata?.appId as string;
    if (!appId) throw new Error('App ID required');

    const files = requireWorkspace(appId);

    let index: string[];
    try {
      index = await readIndex(files);
    } catch (err) {
      logger.error('automations.list.index_corrupt', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(
        'Your automations index appears to be corrupt. ' +
        'Please contact support or manually inspect `.airo/jobs/index.json`.',
      );
    }

    if (index.length === 0) {
      return { success: true, automations: [] };
    }

    const automations: Array<{ uuid: string; name: string; description?: string }> = [];
    const warnings: string[] = [];

    for (const uuid of index) {
      try {
        const content = await files.readText({ path: jobFilePath(uuid) });
        if (!content.trim()) {
          // Tombstoned — skip silently
          continue;
        }
        const parsed = matter(content);
        const name = parsed.data.name as string | undefined;
        if (!name) {
          warnings.push(`Automation ${uuid} is indexed but appears malformed (no name) — it may be damaged.`);
          continue;
        }
        automations.push({
          uuid,
          name,
          ...(parsed.data.description ? { description: parsed.data.description as string } : {}),
        });
      } catch (err) {
        if (isDevSupervisorNotFound(err)) {
          warnings.push(`Automation ${uuid} is indexed but its file could not be read — it may be damaged.`);
        } else {
          throw err;
        }
      }
    }

    return { success: true, automations, ...(warnings.length > 0 ? { warnings } : {}) };
  },

  config: { requiresApp: true },
};

export const updateTool: SkillToolDefinition = {
  name: 'update',
  description:
    'Update an existing automation. ' +
    'Provide only the fields you want to change — omitted fields are left as-is.',

  parameters: z.object({
    uuid: z.string().uuid().describe('UUID of the automation to update'),
    name: z
      .string()
      .max(MAX_NAME_LENGTH)
      .optional()
      .describe('New name (max 100 chars)'),
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
      .optional()
      .describe('New description (max 300 chars, pass empty string to clear)'),
    body: z
      .string()
      .max(MAX_BODY_LENGTH)
      .optional()
      .describe('New prompt body (max 10 000 chars)'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;
    if (!appId) throw new Error('App ID required');

    const files = requireWorkspace(appId);
    const path = jobFilePath(input.uuid);

    let existing: matter.GrayMatterFile<string>;
    try {
      const content = await files.readText({ path });
      if (!content.trim()) {
        throw new Error(`Automation ${input.uuid} not found.`);
      }
      existing = matter(content);
    } catch (err) {
      if (isDevSupervisorNotFound(err)) {
        throw new Error(`Automation ${input.uuid} not found.`);
      }
      throw err;
    }

    const name = input.name ?? (existing.data.name as string);
    const description = input.description !== undefined
      ? (input.description || undefined)
      : (existing.data.description as string | undefined);
    const body = input.body ?? existing.content;

    await files.write({ path, content: serializeJob(name, description, body) });

    logger.info('automations.update.success', { appId, uuid: input.uuid, name });
    return {
      success: true,
      uuid: input.uuid,
      name,
      message: `Automation '${name}' updated. Please refresh the Automations panel.`,
    };
  },

  config: { requiresApp: true },
};

export const getHistoryTool: SkillToolDefinition = {
  name: 'getHistory',
  description:
    'List run history summaries for a saved automation, newest first. ' +
    'Call this when the user asks about previous runs, run history, or results.',

  parameters: z.object({
    uuid: z.string().uuid().describe('UUID of the automation'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of runs to return (default 10)'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;
    if (!appId) throw new Error('App ID required');

    const files = requireWorkspace(appId);
    const runsDir = `.airo/jobs/${input.uuid}/runs`;
    const limit = input.limit ?? 10;

    let tree: Awaited<ReturnType<WorkspaceFiles['tree']>>;
    try {
      tree = await files.tree({ path: runsDir, kindFilter: 'file', recursive: false });
    } catch (err) {
      if (isDevSupervisorNotFound(err)) {
        return { success: true, runs: [], message: 'No runs recorded yet for this automation.' };
      }
      throw err;
    }

    if (tree.entries.length === 0) {
      return { success: true, runs: [], message: 'No runs recorded yet for this automation.' };
    }

    // Filenames are `{timestamp}_{conversationId}_summary.md` — sort descending by modifiedAt
    const sorted = [...tree.entries].sort(
      (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
    );
    const page = sorted.slice(0, limit);

    const runs: Array<{
      file: string;
      automationId?: string;
      conversationId?: string;
      timestamp?: string;
      status?: string;
      summary: string;
    }> = [];

    for (const entry of page) {
      try {
        const content = await files.readText({ path: entry.path });
        const parsed = matter(content);
        runs.push({
          file: entry.path,
          automationId: parsed.data.automationId as string | undefined,
          conversationId: parsed.data.conversationId as string | undefined,
          timestamp: parsed.data.timestamp as string | undefined,
          status: parsed.data.status as string | undefined,
          summary: parsed.content.trim(),
        });
      } catch (err) {
        if (isDevSupervisorNotFound(err)) {
          logger.warn('automations.getHistory.run_file_missing', { appId, uuid: input.uuid, path: entry.path });
        } else {
          throw err;
        }
      }
    }

    return {
      success: true,
      runs,
      total: tree.entries.length,
      ...(tree.entries.length > limit ? { truncated: true, showing: limit } : {}),
    };
  },

  config: { requiresApp: true },
};

export const deleteTool: SkillToolDefinition = {
  name: 'delete',
  description: 'Delete a saved automation by UUID.',

  parameters: z.object({
    uuid: z.string().uuid().describe('UUID of the automation to delete'),
  }),

  async execute(input, context) {
    const appId = context?.metadata?.appId as string;
    if (!appId) throw new Error('App ID required');

    const files = requireWorkspace(appId);

    // Read index first — fail before any destructive write if it is corrupt or unreadable
    let index: string[];
    try {
      index = await readIndex(files);
    } catch (err) {
      logger.error('automations.delete.index_corrupt', {
        appId,
        uuid: input.uuid,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(
        'Your automations index appears to be corrupt. ' +
        'No files were modified. ' +
        'Please contact support or manually inspect `.airo/jobs/index.json`.',
      );
    }

    // Read name before tombstoning for the confirmation message
    let name: string = input.uuid;
    try {
      const content = await files.readText({ path: jobFilePath(input.uuid) });
      const parsed = matter(content);
      if (parsed.data.name) name = parsed.data.name as string;
    } catch {
      // Best-effort — proceed even if we can't read the name
    }

    // Tombstone the file (no delete API available)
    await files.write({ path: jobFilePath(input.uuid), content: '' });

    await writeIndex(files, index.filter(id => id !== input.uuid));

    logger.info('automations.delete.success', { appId, uuid: input.uuid, name });
    return {
      success: true,
      uuid: input.uuid,
      name,
      message: `Automation '${name}' deleted. Please refresh the Automations panel.`,
    };
  },

  config: { requiresApp: true },
};
