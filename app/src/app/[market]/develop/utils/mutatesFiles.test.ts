/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'

import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { mutatesFiles } from './mutatesFiles'

describe('mutatesFiles', function mutatesFilesTests() {
  function makeTc(overrides: Partial<ToolCall> = {}): ToolCall {
    return {
      id: 'tc-1',
      name: 'textEditor',
      status: 'running',
      input: { command: 'str_replace', path: 'src/pages/index.tsx' },
      ...overrides,
    }
  }

  it('returns true for str_replace_based_edit_tool with a non-view command', function strReplaceCreate() {
    expect(
      mutatesFiles(
        makeTc({
          name: 'str_replace_based_edit_tool',
          input: { command: 'create', path: 'src/foo.ts' },
        }),
      ),
    ).toBe(true)
  })

  it('returns true for textEditor with a non-view command', function textEditorNonView() {
    expect(mutatesFiles(makeTc({ input: { command: 'create', path: 'src/foo.ts' } }))).toBe(true)
  })

  it('returns true for fileEdit with no command field', function fileEditNoCommand() {
    expect(mutatesFiles(makeTc({ name: 'fileEdit', input: { path: 'src/components/Header.tsx' } }))).toBe(true)
  })

  it('returns false for str_replace_based_edit_tool with command view', function strReplaceView() {
    expect(
      mutatesFiles(
        makeTc({
          name: 'str_replace_based_edit_tool',
          input: { command: 'view', path: 'src/pages/index.tsx' },
        }),
      ),
    ).toBe(false)
  })

  it('returns false for textEditor with command view', function textEditorView() {
    expect(mutatesFiles(makeTc({ input: { command: 'view', path: 'src/pages/index.tsx' } }))).toBe(false)
  })

  it('returns false for an unrelated tool name', function unrelatedTool() {
    expect(mutatesFiles(makeTc({ name: 'search_tool', input: { query: 'x' } }))).toBe(false)
  })

  it('returns false for a tool with no input object', function noInput() {
    expect(
      mutatesFiles({
        id: 'tc-2',
        name: 'search_tool',
        status: 'running',
      } as ToolCall),
    ).toBe(false)
  })
})
