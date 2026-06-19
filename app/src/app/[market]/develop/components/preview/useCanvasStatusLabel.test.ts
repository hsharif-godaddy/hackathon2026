/**
 * @vitest-environment jsdom
 */
/* eslint-disable react-hooks/rules-of-hooks -- renderHookWithProviders callbacks trigger this rule */
import { beforeEach, describe, expect, it } from 'vitest'

import { useCanvasStatusLabel } from '@/app/[market]/develop/components/preview/useCanvasStatusLabel'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { renderHookWithProviders } from '@/tests/test-utils'

describe('useCanvasStatusLabel', function useCanvasStatusLabelTests() {
  beforeEach(function resetStore() {
    useStreamingConversationStore.setState({
      activeStream: null,
      messages: [],
    })
  })

  it('returns working when processing without a running tool', function processingWorking() {
    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(false, true))

    expect(result.current).toBe('Working')
  })

  it('returns working when idle', function idleWorking() {
    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(false, false))

    expect(result.current).toBe('Working')
  })

  it('returns updating project when mutating files without a running tool and not processing', function mutatingUpdating() {
    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, false))

    expect(result.current).toBe('Updating your project')
  })

  it('returns working when mutating files without a running tool while still processing', function mutatingWorkingGap() {
    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Working')
  })

  it('returns updating project when a file edit tool is running', function fileEditTool() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'fileEdit',
            input: { path: 'src/pages/index.tsx' },
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Updating your project')
  })

  it('returns checking project when grepSearch is running without mutation override', function grepSearch() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'grepSearch',
            input: { query: 'hero' },
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(false, true))

    expect(result.current).toBe('Checking your project')
  })

  it('returns building when awaitAgents is running', function awaitAgents() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'awaitAgents',
            input: { jobIds: ['job-1', 'job-2'] },
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(false, true))

    expect(result.current).toBe('Building')
    expect(result.current).not.toContain('2')
  })

  it('returns checking project when validateCode is running during file mutations', function validateCodeDuringMutations() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'validateCode',
            input: {},
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Checking your project')
    expect(result.current).not.toBe('Updating your project')
  })

  it('returns checking project when validateCode is running', function validateCodeTool() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'validateCode',
            input: {},
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(false, true))

    expect(result.current).toBe('Checking your project')
  })

  it('returns adding styles when colorScheme is running during file mutations', function stylesDuringMutations() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'colorScheme',
            input: {},
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Adding styles')
    expect(result.current).not.toBe('Updating your project')
  })

  it('returns wrapping up when returnToParent is running during file mutations', function wrappingUpDuringMutations() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'returnToParent',
            input: {},
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Wrapping up a task')
    expect(result.current).not.toBe('Updating your project')
  })

  it('returns building when awaitAgents is running during file mutations', function awaitAgentsDuringMutations() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'awaitAgents',
            input: { jobIds: ['job-1'] },
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Building')
    expect(result.current).not.toBe('Updating your project')
  })

  it('returns updating project when terminalCommand is running during file mutations', function terminalDuringMutations() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'terminalCommand',
            input: { command: 'npm test' },
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Updating your project')
  })

  it('returns updating project when restore is running during file mutations', function restoreDuringMutations() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'restore',
            input: {},
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Updating your project')
    expect(result.current).not.toBe('Restoring')
  })

  it('returns updating project when appPlan is running during file mutations', function planningDuringMutations() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'appPlan',
            input: {},
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Updating your project')
    expect(result.current).not.toBe('Planning')
  })

  it('returns updating project when an unmapped tool is running during file mutations', function unmappedDuringMutations() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'commerce__execute_tool',
            input: {},
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Updating your project')
    expect(result.current).not.toBe('Working')
  })

  it('returns checking project after a completed edit when a read tool is running', function readAfterEdit() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'fileEdit',
            input: { path: 'src/pages/index.tsx' },
            status: 'completed',
          },
          {
            id: 'tc-2',
            name: 'grepSearch',
            input: { query: 'hero' },
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(true, true))

    expect(result.current).toBe('Checking your project')
    expect(result.current).not.toBe('Updating your project')
  })

  it('returns working for unmapped tools', function unmappedWorking() {
    useStreamingConversationStore.setState({
      activeStream: {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        segments: [],
        toolCalls: [
          {
            id: 'tc-1',
            name: 'commerce__execute_tool',
            input: {},
            status: 'running',
          },
        ],
        timestamp: new Date(),
        isComplete: false,
      },
    })

    const { result } = renderHookWithProviders(() => useCanvasStatusLabel(false, true))

    expect(result.current).toBe('Working')
  })
})
