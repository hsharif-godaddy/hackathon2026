/**
 * Text Editor Tool for AI-Lib
 *
 * Provides two variants:
 * - Anthropic native text_editor_20250728 (schema-less, Claude has built-in training)
 * - Zod-schema-based (works with any OpenAI-compatible model)
 *
 * The native Anthropic tool carries a fallback (via PROVIDER_TOOL_FALLBACK,
 * exported from @airo/ai-lib) pointing to the schema variant. AgentWrapper
 * auto-swaps when switching providers. Register as "str_replace_based_edit_tool"
 * — the SDK returns this name in tool_use responses and looks it up by key.
 */

import { basename } from 'node:path';

import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { createTool, PROVIDER_TOOL_FALLBACK } from '@airo/ai-lib';
import type { Tool, AgentContext } from '@airo/ai-lib';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { translateDockerPath } from '../../utils/path-helper.js';
import { DevSupervisorError } from '../../services/DevSupervisorClient.js';
import { runPostEditHandlers } from './post-edit-handlers.js';
import { isFileBlocked } from '../read-file.js';
import {
  isProtectedWorkspacePath,
  validateNoApiPaths,
  resolveSourceFile,
  resolveFilePath
} from '../file-edit-utils.js';
import {
  handleView,
  handleStrReplace,
  handleCreate,
  handleInsert,
} from '../text-editor-workspace.js';
import { createForWorkspace } from '../../workspace/index.js';
import type { WorkspaceFiles } from '../../workspace/files.js';

const appRepo = new AppRepository();

interface TextEditorInput {
  command: 'view' | 'str_replace' | 'create' | 'insert';
  path: string;
  view_range?: number[];
  old_str?: string;
  new_str?: string;
  file_text?: string;
  insert_line?: number;
  insert_text?: string;
}

function resolveViewRange(viewRange: number[] | undefined): [number, number] | undefined {
  if (!viewRange) {
    return undefined;
  }

  const [start, end] = viewRange;
  if (
    viewRange.length !== 2 ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start! < 1 ||
    (end !== -1 && end! < 1)
  ) {
    throw new Error('view_range must be [start_line, end_line], where start_line is 1-indexed and end_line is -1 or a 1-indexed line number');
  }

  if (end !== -1 && end! < start!) {
    throw new Error(`view_range [${start}, ${end}] is invalid: end_line must be >= start_line, or -1 to read to end of file`);
  }

  return [start!, end!];
}

async function isFileImmutableViaWorkspace(
  files: WorkspaceFiles,
  path: string,
): Promise<boolean> {
  try {
    const result = await files.view({ path, limit: 1 });
    if (result.encoding === 'base64') return false;
    const firstLine = result.content.split('\n')[0] ?? '';
    return firstLine.includes('TREAT AS IMMUTABLE');
  } catch (err: unknown) {
    if (err instanceof DevSupervisorError && err.code === 'not_found') {
      return false;
    }
    throw err;
  }
}

async function executeTextEditor(input: TextEditorInput, context: AgentContext | undefined): Promise<string> {
  const { command, path: rawPath, view_range, old_str, new_str, file_text, insert_line, insert_text } = input;

  // Normalize agent-supplied paths to workspace-relative. Models often pass an
  // absolute or container-style path ("/app/public/x", "/public/x" — primed by the
  // many "/airo-assets/…", "/brand-tokens.css" URLs around the showcase). The raw
  // path is forwarded to the dev-supervisor, which treats absolute paths literally
  // and rejects anything not under /app ("path escapes base directory /app").
  // translateDockerPath strips a leading "/app/" or "/" so the path resolves inside
  // the workspace; "../" traversal is still blocked downstream by resolveFilePath and
  // the dev-supervisor. Use this normalized path for every command and check below.
  const path = translateDockerPath(rawPath);

  const appId = context?.metadata?.appId as string;
  if (!appId) {
    throw new Error('App ID is required for file operations');
  }

  const app = appRepo.findById(appId);
  if (!app) {
    throw new Error(`App '${appId}' not found`);
  }

  const fullPath = resolveFilePath(app.path, path);

  // Get workspace files API
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    throw new Error('Workspace not available for this app');
  }
  const { files } = workspace;

  // === SECURITY LAYER ===

  if (['view', 'str_replace', 'insert'].includes(command)) {
    const blockCheck = isFileBlocked(path);
    if (blockCheck.blocked) {
      throw new Error(`File blocked: ${blockCheck.reason} Do not retry — use a different approach.`);
    }
  }

  if (['str_replace', 'create', 'insert'].includes(command)) {
    if (isProtectedWorkspacePath(fullPath, app.path)) {
      throw new Error(`${path} is in a protected directory and cannot be modified.`);
    }
  }

  if (['str_replace', 'create', 'insert'].includes(command)) {
    const immutable = await isFileImmutableViaWorkspace(files, path);
    if (immutable) {
      throw new Error('File is immutable (contains "TREAT AS IMMUTABLE") — cannot edit.');
    }
  }

  if (['str_replace', 'create', 'insert'].includes(command)) {
    const content = new_str || file_text || insert_text || '';
    const validation = validateNoApiPaths(content, path);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
  }

  let resolvedFileText = file_text;
  let binaryCopied = false;
  if (command === 'create' && file_text !== undefined) {
    const resolvedFile = await resolveSourceFile(appId, path, file_text, files);
    if (resolvedFile) {
      if (resolvedFile.binaryCopied) {
        binaryCopied = true;
      } else {
        resolvedFileText = resolvedFile.content;
      }
    }
  }

  switch (command) {
    case 'view': {
      return handleView(files, path, resolveViewRange(view_range));
    }

    case 'str_replace':
      if (!old_str || new_str === undefined) {
        throw new Error('str_replace requires old_str and new_str');
      }
      return await runPostEditHandlers(
        { fullPath, filePath: path, appPath: app.path, command },
        await handleStrReplace(files, path, old_str, new_str),
      );

    case 'create':
      if (binaryCopied) {
        return `Created ${basename(path)} (binary auto-resolved from uploads)`;
      }
      if (resolvedFileText == null) {
        throw new Error('create requires file_text');
      }
      return await runPostEditHandlers(
        { fullPath, filePath: path, appPath: app.path, command },
        await handleCreate(files, path, resolvedFileText),
      );

    case 'insert':
      if (insert_line === undefined || !insert_text) {
        throw new Error('insert requires insert_line and insert_text');
      }
      return await runPostEditHandlers(
        { fullPath, filePath: path, appPath: app.path, command },
        await handleInsert(files, path, insert_line, insert_text),
      );

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/**
 * Anthropic native text_editor_20250728 — schema-less, Claude has built-in training.
 */
export const textEditorAITool: Tool = anthropic.tools.textEditor_20250728({
  async execute(input, { experimental_context }) {
    return executeTextEditor(input, experimental_context as AgentContext | undefined);
  }
}) as Tool;

const textEditorSchema = z.object({
  command: z.enum(['view', 'str_replace', 'create', 'insert']).describe(
    'The command to execute: view (read file/directory), str_replace (replace exact text), create (create/overwrite file), insert (insert text at line)'
  ),
  path: z.string().describe('Path to the file (relative to app root)'),
  view_range: z.array(z.number().int()).length(2).optional().describe(
    'For view: [start_line, end_line] range (1-indexed). start_line must be >= 1; end_line must be >= 1 or -1 to read to end of file.'
  ),
  old_str: z.string().optional().describe(
    'For str_replace: the EXACT text to find and replace. Must match exactly once in the file.'
  ),
  new_str: z.string().optional().describe(
    'For str_replace: the new text to replace old_str with.'
  ),
  file_text: z.string().optional().describe(
    'For create: the full content of the file to create.'
  ),
  insert_line: z.number().int().min(0).optional().describe(
    'For insert: the 0-indexed line number to insert text before (unlike view_range which is 1-indexed).'
  ),
  insert_text: z.string().optional().describe(
    'For insert: the text to insert at the specified line.'
  ),
});

/**
 * Zod-schema-based text editor — works with any OpenAI-compatible model.
 * Same execute logic as the Anthropic native variant.
 */
export const textEditorSchemaAITool: Tool = createTool(
  `File editor with four commands:
- view: Read a file's contents (optionally a line range) or list a directory
- str_replace: Replace an exact text match in a file (must match exactly once)
- create: Create a new file or overwrite an existing one
- insert: Insert text before a specific line number

RULES:
1. For str_replace, the old_str must match file content EXACTLY (whitespace, indentation). Read the file first if unsure.
2. str_replace old_str must match exactly ONCE. Include more context lines to disambiguate if needed.
3. For create, provide the complete file content in file_text.`,
  textEditorSchema,
  async (input, context) => executeTextEditor(input, context),
);

// withModel auto-swaps provider-specific tools when switching providers.
// The native Anthropic tool can't be serialized for OpenAI-compatible providers,
// so we attach the schema-based variant as a fallback.
(textEditorAITool as any)[PROVIDER_TOOL_FALLBACK] = textEditorSchemaAITool;
