/**
 * Text Editor Tool for AI-Lib
 *
 * Uses Anthropic's native text_editor_20250728 schema-less tool via the
 * Vercel AI SDK. The SDK's toolNameMapping handles bidirectional translation
 * The tool MUST be registered as "str_replace_based_edit_tool" in the tools
 * record — the SDK returns this name in tool_use responses and looks it up
 * by key. UI and history layers map both old ("textEditor") and new names.
 */

import { basename } from 'node:path';

import { anthropic } from '@ai-sdk/anthropic';
import type { Tool } from '@airo/ai-lib';
import type { AgentContext } from '@airo/ai-lib';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { isFileBlocked } from '../read-file.js';
import {
  isFileImmutable,
  validateNoApiPaths,
  resolveSourceFile,
  resolveFilePath
} from '../file-edit.js';
import {
  handleView,
  handleStrReplace,
  handleCreate,
  handleInsert
} from '../text-editor-handlers.js';

const appRepo = new AppRepository();

/**
 * Text Editor Tool — Native Anthropic text_editor_20250728
 *
 * The SDK sends this as a schema-less tool with type "text_editor_20250728"
 * and name "str_replace_based_edit_tool" to the API. The model has built-in
 * training for this tool interface.
 *
 * Commands: view, str_replace, create, insert
 */
export const textEditorAITool: Tool = anthropic.tools.textEditor_20250728({
  async execute({ command, path, view_range, old_str, new_str, file_text, insert_line, insert_text }, { experimental_context }) {
    const context = experimental_context as AgentContext | undefined;
    const appId = context?.metadata?.appId as string;
    if (!appId) {
      throw new Error('App ID is required for file operations');
    }

    const app = appRepo.findById(appId);
    if (!app) {
      throw new Error(`App '${appId}' not found`);
    }

    // Resolve full path with security checks
    const fullPath = resolveFilePath(app.path, path);

    // === SECURITY LAYER ===

    // 1. AI Guardrails - Block wasteful files on view
    if (command === 'view') {
      const blockCheck = isFileBlocked(path);
      if (blockCheck.blocked) {
        throw new Error(`File blocked: ${blockCheck.reason}`);
      }
    }

    // 2. Immutability checks on modifications (includes create since it can overwrite)
    if (['str_replace', 'create', 'insert'].includes(command)) {
      const immutable = await isFileImmutable(fullPath);
      if (immutable) {
        throw new Error(
          'This file is marked as immutable and cannot be edited. The file contains "TREAT AS IMMUTABLE" in its first line.'
        );
      }
    }

    // 3. API path validation - Prevent upload URLs in source
    if (['str_replace', 'create', 'insert'].includes(command)) {
      const content = new_str || file_text || insert_text || '';
      const validation = validateNoApiPaths(content, path);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
    }

    // 4. Upload resolution for create
    let resolvedFileText = file_text;
    let binaryCopied = false;
    if (command === 'create' && file_text !== undefined) {
      const resolvedFile = await resolveSourceFile(appId, path, file_text, fullPath);
      if (resolvedFile) {
        if (resolvedFile.binaryCopied) {
          binaryCopied = true;
        } else {
          resolvedFileText = resolvedFile.content;
        }
      }
    }

    // === EXECUTE COMMAND ===

    switch (command) {
      case 'view': {
        const range: [number, number] | undefined =
          view_range && view_range.length >= 2 ? [view_range[0]!, view_range[1]!] : undefined;
        return handleView(fullPath, range);
      }

      case 'str_replace':
        if (!old_str || new_str === undefined) {
          throw new Error('str_replace requires old_str and new_str');
        }
        return handleStrReplace(fullPath, old_str, new_str);

      case 'create':
        if (binaryCopied) {
          return `Successfully created ${basename(path)} (binary file auto-resolved from uploads)`;
        }
        if (resolvedFileText == null) {
          throw new Error('create requires file_text');
        }
        return handleCreate(fullPath, resolvedFileText);

      case 'insert':
        if (insert_line === undefined || !insert_text) {
          throw new Error('insert requires insert_line and insert_text');
        }
        return handleInsert(fullPath, insert_line, insert_text);

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }
}) as Tool;
