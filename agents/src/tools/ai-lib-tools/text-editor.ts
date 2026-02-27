/**
 * Text Editor Tool for AI-Lib
 *
 * Implements a simple command-based interface for file operations inspired by
 * Anthropic's text_editor_20250728 tool. While not schema-less, this provides
 * a clearer interface than the batch tool with command-based operations.
 */

import { basename } from 'node:path';

import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
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
 * Text Editor Tool - Command-based file operations
 *
 * Provides four commands for file manipulation:
 * - view: Read file contents or list directory
 * - str_replace: Replace exact text match (must be unique)
 * - create: Create new file
 * - insert: Insert text at specific line number
 */
export const textEditorAITool: Tool = createTool(
  `Command-based file editor with four operations:

**view** - Read file or list directory contents
  Required: path
  Optional: view_range (array of [start_line, end_line])

**str_replace** - Replace exact text (must match exactly once)
  Required: path, old_str, new_str
  CRITICAL: You MUST read the file with readFile BEFORE using str_replace to get the exact current content.
  The old_str parameter must match the file content EXACTLY (including all whitespace, indentation, line breaks).
  If old_str doesn't match exactly, the operation will fail.

**create** - Create new file
  Required: path, file_text

**insert** - Insert text at line number
  Required: path, insert_line, insert_text

MANDATORY WORKFLOW for str_replace:
1. First call readFile to see the exact current content
2. Then call textEditor with str_replace using the EXACT text from readFile

For multiple independent files, invoke all textEditor calls simultaneously.`,

  z.object({
    command: z.enum(['view', 'str_replace', 'create', 'insert'])
      .describe('Operation to perform: view, str_replace, create, or insert'),

    path: z.string()
      .describe('File path relative to app root'),

    view_range: z.tuple([z.number(), z.number()]).optional()
      .describe('Optional [start_line, end_line] for view command (1-indexed). Use -1 for end to read to EOF'),

    old_str: z.string().optional()
      .describe('Exact text to find for str_replace (must match exactly once in file). You MUST read the file first with readFile to get this exact content.'),

    new_str: z.string().optional()
      .describe('Replacement text for str_replace'),

    file_text: z.string().optional()
      .describe('Full file content for create command'),

    insert_line: z.number().optional()
      .describe('Line number after which to insert text. Use 0 to insert at the beginning of the file.'),

    insert_text: z.string().optional()
      .describe('Text to insert at insert_line')
  }),

  async (input, context) => {
    const appId = context?.metadata?.appId as string;
    if (!appId) {
      throw new Error('App ID is required for file operations');
    }

    const app = appRepo.findById(appId);
    if (!app) {
      throw new Error(`App '${appId}' not found`);
    }

    const { command, path, view_range, old_str, new_str, file_text, insert_line, insert_text } = input;

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

    // 2. Immutability checks on modifications
    if (['str_replace', 'insert'].includes(command)) {
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
      case 'view':
        return handleView(fullPath, view_range);

      case 'str_replace':
        if (!old_str || new_str === undefined) {
          throw new Error('str_replace requires old_str and new_str');
        }
        return handleStrReplace(fullPath, old_str, new_str);

      case 'create':
        if (binaryCopied) {
          return `Successfully created ${basename(path)} (binary file auto-resolved from uploads)`;
        }
        if (!resolvedFileText) {
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
);
