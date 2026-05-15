import { describe, expect, it } from 'vitest';

import type { ToolCall } from '@/stores/useStreamingConversationStore';
import { extractNewPageRoute } from './utils';

function toolCall(overrides: Partial<ToolCall> & Pick<ToolCall, 'name' | 'input'>): ToolCall {
  return {
    id: 'tc-1',
    status: 'completed',
    ...overrides,
  }
}

describe('extractNewPageRoute', function extract() {
  describe('textEditor tool', function textEditorTests() {
    it('should return route for a created page file', function create() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/about.tsx' } }),
      ])

      expect(result).toBe('/about')
    })

    it('should return route for str_replace_based_edit_tool (native Anthropic name)', function nativeName() {
      const result = extractNewPageRoute([
        toolCall({ name: 'str_replace_based_edit_tool', input: { command: 'create', path: 'src/pages/about.tsx' } }),
      ])

      expect(result).toBe('/about')
    })

    it('should return null when command is str_replace (edit, not create)', function strReplace() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'str_replace', path: 'src/pages/about.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null when command is view (read, not create)', function view() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'view', path: 'src/pages/about.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should handle absolute paths', function absolutePath() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: '/workspace/app/src/pages/contact.tsx' } }),
      ])

      expect(result).toBe('/contact')
    })

    it('should return null for Windows-style backslash paths (agent runs on Linux)', function windowsPath() {
      // Agents run in Linux containers where paths always use forward slashes.
      // Backslash paths won't be produced by any tool and should not match.
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src\\pages\\services.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null for files outside src/pages/', function outsidePages() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/components/About.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null for files in subdirectories of src/pages/', function subdir() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/components/Button.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should lowercase the route', function lowercase() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/About.tsx' } }),
      ])

      expect(result).toBe('/about')
    })

    it('should support .jsx extension', function jsx() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/contact.jsx' } }),
      ])

      expect(result).toBe('/contact')
    })

    it('should support .js extension', function js() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/team.js' } }),
      ])

      expect(result).toBe('/team')
    })

    it('should support .ts extension', function ts() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/api.ts' } }),
      ])

      expect(result).toBe('/api')
    })
  })

  describe('create_file tool', function createFileTests() {
    it('should return route using path field', function pathField() {
      const result = extractNewPageRoute([
        toolCall({ name: 'create_file', input: { path: 'src/pages/about.tsx' } }),
      ])

      expect(result).toBe('/about')
    })

    it('should return route using file_path field as fallback', function filePathField() {
      const result = extractNewPageRoute([
        toolCall({ name: 'create_file', input: { file_path: 'src/pages/contact.tsx' } }),
      ])

      expect(result).toBe('/contact')
    })

    it('should prefer path over file_path', function pathPriority() {
      const result = extractNewPageRoute([
        toolCall({ name: 'create_file', input: { path: 'src/pages/about.tsx', file_path: 'src/pages/contact.tsx' } }),
      ])

      expect(result).toBe('/about')
    })
  })

  describe('write_file tool', function writeFileTests() {
    it('should return route for a page file', function pagePath() {
      const result = extractNewPageRoute([
        toolCall({ name: 'write_file', input: { path: 'src/pages/services.tsx' } }),
      ])

      expect(result).toBe('/services')
    })

    it('should return null for a non-page file', function nonPage() {
      const result = extractNewPageRoute([
        toolCall({ name: 'write_file', input: { path: 'src/lib/utils.ts' } }),
      ])

      expect(result).toBeNull()
    })
  })

  describe('fileEdit batch tool', function fileEditTests() {
    it('should return route for a create operation on a page file', function createOp() {
      const result = extractNewPageRoute([
        toolCall({
          name: 'fileEdit',
          input: {
            operations: [
              { type: 'create', path: 'src/pages/about.tsx', content: '...' },
            ],
          },
        }),
      ])

      expect(result).toBe('/about')
    })

    it('should ignore non-create operations in a batch', function nonCreateOps() {
      const result = extractNewPageRoute([
        toolCall({
          name: 'fileEdit',
          input: {
            operations: [
              { type: 'modify', path: 'src/pages/about.tsx' },
              { type: 'delete', path: 'src/pages/old.tsx' },
            ],
          },
        }),
      ])

      expect(result).toBeNull()
    })

    it('should handle a batch with both create and modify operations', function mixedOps() {
      const result = extractNewPageRoute([
        toolCall({
          name: 'fileEdit',
          input: {
            operations: [
              { type: 'modify', path: 'src/routes.tsx' },
              { type: 'create', path: 'src/pages/contact.tsx', content: '...' },
            ],
          },
        }),
      ])

      expect(result).toBe('/contact')
    })

    it('should return null when operations is not an array', function noOps() {
      const result = extractNewPageRoute([
        toolCall({ name: 'fileEdit', input: { operations: null } }),
      ])

      expect(result).toBeNull()
    })
  })

  describe('excluded page names', function excludedTests() {
    it('should return null for index.tsx (home page)', function indexPage() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/index.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null for _404.tsx', function notFoundPage() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/_404.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null for _error.tsx', function errorPage() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/_error.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null for dynamic route files like [id].tsx', function dynamicRoute() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/[id].tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null for optional catch-all routes like [[...slug]].tsx', function catchAll() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/[[...slug]].tsx' } }),
      ])

      expect(result).toBeNull()
    })
  })

  describe('tool call status and errors', function statusTests() {
    it('should return null when tool call status is running', function running() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/about.tsx' }, status: 'running' }),
      ])

      expect(result).toBeNull()
    })

    it('should return null when tool call status is incomplete', function incomplete() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/about.tsx' }, status: 'incomplete' }),
      ])

      expect(result).toBeNull()
    })

    it('should return null when tool call status is error', function error() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/about.tsx' }, status: 'error' }),
      ])

      expect(result).toBeNull()
    })

    it('should return null when tool call has an error field even if status is completed', function errorField() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create', path: 'src/pages/about.tsx' }, error: 'Write failed' }),
      ])

      expect(result).toBeNull()
    })
  })

  describe('multiple tool calls in one turn', function multipleTests() {
    it('should return the last created page route when multiple pages are created', function multiplePages() {
      const result = extractNewPageRoute([
        toolCall({ id: 'tc-1', name: 'textEditor', input: { command: 'create', path: 'src/pages/services.tsx' } }),
        toolCall({ id: 'tc-2', name: 'textEditor', input: { command: 'create', path: 'src/pages/about.tsx' } }),
      ])

      expect(result).toBe('/about')
    })

    it('should skip failed tool calls and return the last successful page', function skipFailed() {
      const result = extractNewPageRoute([
        toolCall({ id: 'tc-1', name: 'textEditor', input: { command: 'create', path: 'src/pages/services.tsx' } }),
        toolCall({ id: 'tc-2', name: 'textEditor', input: { command: 'create', path: 'src/pages/about.tsx' }, status: 'error' }),
      ])

      expect(result).toBe('/services')
    })

    it('should ignore non-page tool calls mixed in with a page creation', function nonPageMixed() {
      const result = extractNewPageRoute([
        toolCall({ id: 'tc-1', name: 'textEditor', input: { command: 'create', path: 'src/routes.tsx' } }),
        toolCall({ id: 'tc-2', name: 'textEditor', input: { command: 'create', path: 'src/pages/contact.tsx' } }),
        toolCall({ id: 'tc-3', name: 'textEditor', input: { command: 'str_replace', path: 'src/layouts/Header.tsx' } }),
      ])

      expect(result).toBe('/contact')
    })

    it('should return null when no tool calls are page creations', function noneMatch() {
      const result = extractNewPageRoute([
        toolCall({ id: 'tc-1', name: 'textEditor', input: { command: 'str_replace', path: 'src/pages/index.tsx' } }),
        toolCall({ id: 'tc-2', name: 'textEditor', input: { command: 'create', path: 'src/components/Button.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null when index.tsx is created alongside other pages (index wins)', function indexWithOthers() {
      const result = extractNewPageRoute([
        toolCall({ id: 'tc-1', name: 'textEditor', input: { command: 'create', path: 'src/pages/coming-soon.tsx' } }),
        toolCall({ id: 'tc-2', name: 'textEditor', input: { command: 'create', path: 'src/pages/index.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null when index.tsx is created first followed by another page', function indexFirst() {
      const result = extractNewPageRoute([
        toolCall({ id: 'tc-1', name: 'textEditor', input: { command: 'create', path: 'src/pages/index.tsx' } }),
        toolCall({ id: 'tc-2', name: 'textEditor', input: { command: 'create', path: 'src/pages/coming-soon.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null when fileEdit batch contains an index.tsx create operation', function fileEditWithIndex() {
      const result = extractNewPageRoute([
        toolCall({
          name: 'fileEdit',
          input: {
            operations: [
              { type: 'create', path: 'src/pages/coming-soon.tsx' },
              { type: 'create', path: 'src/pages/index.tsx' },
            ],
          },
        }),
      ])

      expect(result).toBeNull()
    })
  })

  describe('edge cases', function edgeCaseTests() {
    it('should return null for an empty tool call list', function empty() {
      expect(extractNewPageRoute([])).toBeNull()
    })

    it('should return null for an unrecognised tool name', function unknownTool() {
      const result = extractNewPageRoute([
        toolCall({ name: 'someOtherTool', input: { path: 'src/pages/about.tsx' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null when input has no path fields', function noPath() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: { command: 'create' } }),
      ])

      expect(result).toBeNull()
    })

    it('should return null when input is empty', function emptyInput() {
      const result = extractNewPageRoute([
        toolCall({ name: 'textEditor', input: {} }),
      ])

      expect(result).toBeNull()
    })
  })
})
