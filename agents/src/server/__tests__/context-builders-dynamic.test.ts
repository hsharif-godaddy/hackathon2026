import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../database/connection.js', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn(),
  })),
}))

vi.mock('../../logging/index.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: class {
    findById(): null { return null }
  },
}))

vi.mock('@airo/ai-grants', () => ({
  BudgetOverride: class {},
}))

vi.mock('../../services/TodoContextManager.js', () => ({
  getTodoContextManager: vi.fn(),
}))

vi.mock('../../services/memory-singletons.js', () => ({
  memoryContextProvider: {},
}))

vi.mock('../../utils/todo-list-id-from-context-attachments.js', () => ({
  todoListIdFromContextAttachments: vi.fn(),
}))

import { logger } from '../../logging/index.js'
import { buildDynamicDataMessage } from '../context-builders.js'

describe('buildDynamicDataMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes conversation language for non-English markets', () => {
    const msg = buildDynamicDataMessage({ market: 'fr-FR', appId: 'test123456' })
    expect(msg.content).toContain('Conversation language: French')
    expect(msg.content).toContain('Respond to the user in French in chat and progress messages')
    expect(msg.content).toContain('this does not change the language of generated site content')
  })

  it('includes conversation language for region-less markets', () => {
    const msg = buildDynamicDataMessage({ market: 'fr', appId: 'test123456' })
    expect(msg.content).toContain('Conversation language: French')
    expect(msg.content).toContain('Respond to the user in French in chat and progress messages')
  })

  it('includes conversation language for English markets', () => {
    const msg = buildDynamicDataMessage({ market: 'en-US', appId: 'test123456' })
    expect(msg.content).toContain('Conversation language: English')
  })

  it('handles Vietnamese market', () => {
    const msg = buildDynamicDataMessage({ market: 'vi-VN', appId: 'test123456' })
    expect(msg.content).toContain('Conversation language: Vietnamese')
    expect(msg.content).toContain('Respond to the user in Vietnamese in chat and progress messages')
  })

  it('handles Spanish market', () => {
    const msg = buildDynamicDataMessage({ market: 'es-MX', appId: 'test123456' })
    expect(msg.content).toContain('Conversation language: Spanish')
  })

  it('does not include language when market is missing', () => {
    const msg = buildDynamicDataMessage({ appId: 'test123456' })
    expect(msg.content).not.toContain('Conversation language')
  })

  it('omits language for unknown language code without aborting', () => {
    const msg = buildDynamicDataMessage({ market: 'zzz-ZZ', appId: 'test123456' })
    expect(msg.content).not.toContain('Conversation language')
    expect(msg.content).toContain('## Dynamic Context')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('omits language for malformed market and logs lookup failure', () => {
    const msg = buildDynamicDataMessage({ market: 'x', appId: 'test123456' })
    expect(msg.content).not.toContain('Conversation language')
    expect(msg.content).toContain('## Dynamic Context')
    expect(logger.warn).toHaveBeenCalledWith(
      'context.dynamic.language_lookup_failed',
      expect.objectContaining({ market: 'x' }),
    )
  })

  it('includes date and timezone alongside language', () => {
    const msg = buildDynamicDataMessage({ market: 'fr-FR', userTimezone: 'Europe/Paris', appId: 'test123456' })
    expect(msg.content).toContain("User's timezone: Europe/Paris")
    expect(msg.content).toContain('Conversation language: French')
  })
})
