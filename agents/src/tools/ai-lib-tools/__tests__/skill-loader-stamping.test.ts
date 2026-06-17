/**
 * Pins the skill.names stamping path in skill-loader.ts for both the `load`
 * action (after onLoad) and the `install` action (after onInstall).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let capturedExecute: ((input: unknown, context?: unknown) => Promise<unknown>) | undefined

vi.mock('@airo/ai-lib', () => ({
  createTool: vi.fn((_desc: unknown, _schema: unknown, fn: typeof capturedExecute) => {
    capturedExecute = fn
    return {}
  }),
}))

const { mockAddSkillNameToSpan } = vi.hoisted(() => ({
  mockAddSkillNameToSpan: vi.fn(() => true),
}))

vi.mock('@airo/ai-transport', () => ({
  addSkillNameToSpan: mockAddSkillNameToSpan,
}))

const mockLoadSkill = vi.fn()
const mockInstallTemplates = vi.fn()
vi.mock('../../skill-loader-tool.js', () => ({
  SkillLoaderTool: vi.fn(function () {
    return {
      loadSkill: mockLoadSkill,
      installTemplates: mockInstallTemplates,
      isSkillAvailableInMarket: vi.fn(() => true),
    }
  }),
}))

const mockRunHook = vi.fn()
const mockRegisterSkill = vi.fn()
vi.mock('../../skill-tool-manager.js', () => ({
  skillToolManager: {
    runHook: mockRunHook,
    registerSkill: mockRegisterSkill,
    getPinnedSkills: vi.fn(() => []),
  },
}))

const { mockFindById } = vi.hoisted(() => ({
  mockFindById: vi.fn(() => null as { id: string; path: string } | null),
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(function () {
    return { findById: mockFindById }
  }),
}))

vi.mock('../../applied-skills-registry.js', () => ({
  appliedSkillsRegistry: { recordInstall: vi.fn() },
}))

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  Logger: { create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })) },
}))

await import('../skill-loader.js')

import { addSkillNameToSpan } from '@airo/ai-transport'

describe('skill-loader load action — skill.names stamping (onLoad)', () => {
  const CONV_ID = 'conv-stamp-test'

  beforeEach(() => {
    vi.clearAllMocks()
    mockAddSkillNameToSpan.mockReturnValue(true)
    mockLoadSkill.mockResolvedValue({ success: true, skill: 'online-appointments', instructions: '' })
    mockRunHook.mockResolvedValue(undefined)
    mockRegisterSkill.mockReturnValue({ success: true, tools: ['online-appointments__getBookingConfig'] })
  })

  it('calls addSkillNameToSpan with conversationId and skill name after onLoad', async () => {
    await capturedExecute!(
      { action: 'load', skill: 'online-appointments' },
      { metadata: { conversationId: CONV_ID } }
    )

    expect(vi.mocked(addSkillNameToSpan)).toHaveBeenCalledWith(CONV_ID, 'online-appointments')
  })

  it('passes the correct skill name for any skill', async () => {
    mockLoadSkill.mockResolvedValue({ success: true, skill: 'database', instructions: '' })
    mockRegisterSkill.mockReturnValue({ success: true, tools: ['database__listTables'] })

    await capturedExecute!(
      { action: 'load', skill: 'database' },
      { metadata: { conversationId: CONV_ID } }
    )

    expect(vi.mocked(addSkillNameToSpan)).toHaveBeenCalledWith(CONV_ID, 'database')
  })

  it('emits agent_span.not_found warn when addSkillNameToSpan returns false', async () => {
    mockAddSkillNameToSpan.mockReturnValue(false)
    const { logger } = await import('../../../logging/index.js')

    await capturedExecute!(
      { action: 'load', skill: 'online-appointments' },
      { metadata: { conversationId: CONV_ID } }
    )

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'skill.load.agent_span.not_found',
      expect.objectContaining({ skillName: 'online-appointments', conversationId: CONV_ID })
    )
  })

  it('does not call addSkillNameToSpan or warn when conversationId is absent', async () => {
    const { logger } = await import('../../../logging/index.js')

    await capturedExecute!(
      { action: 'load', skill: 'online-appointments' },
      { metadata: {} }
    )

    expect(vi.mocked(addSkillNameToSpan)).not.toHaveBeenCalled()
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalledWith(
      'skill.load.agent_span.not_found',
      expect.anything()
    )
  })
})

describe('skill-loader install action — skill.names stamping (onInstall)', () => {
  const CONV_ID = 'conv-install-test'
  const APP_ID = 'testapp123'
  const APP_PATH = '/tmp/app/preview'

  beforeEach(() => {
    vi.clearAllMocks()
    mockAddSkillNameToSpan.mockReturnValue(true)
    mockFindById.mockReturnValue({ id: APP_ID, path: APP_PATH })
    mockInstallTemplates.mockResolvedValue({ success: true, filesInstalled: 5, filesSkipped: 0 })
    mockRunHook.mockResolvedValue(undefined)
  })

  it('calls addSkillNameToSpan with conversationId and skill name after onInstall', async () => {
    await capturedExecute!(
      { action: 'install', skill: 'online-appointments' },
      { metadata: { conversationId: CONV_ID, appId: APP_ID } }
    )

    expect(vi.mocked(addSkillNameToSpan)).toHaveBeenCalledWith(CONV_ID, 'online-appointments')
  })

  it('passes the correct skill name for any installed skill', async () => {
    await capturedExecute!(
      { action: 'install', skill: 'database' },
      { metadata: { conversationId: CONV_ID, appId: APP_ID } }
    )

    expect(vi.mocked(addSkillNameToSpan)).toHaveBeenCalledWith(CONV_ID, 'database')
  })

  it('emits agent_span.not_found warn when addSkillNameToSpan returns false', async () => {
    mockAddSkillNameToSpan.mockReturnValue(false)
    const { logger } = await import('../../../logging/index.js')

    await capturedExecute!(
      { action: 'install', skill: 'online-appointments' },
      { metadata: { conversationId: CONV_ID, appId: APP_ID } }
    )

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'skill.install.agent_span.not_found',
      expect.objectContaining({ skillName: 'online-appointments', conversationId: CONV_ID })
    )
  })

  it('does not call addSkillNameToSpan when conversationId is absent', async () => {
    await capturedExecute!(
      { action: 'install', skill: 'online-appointments' },
      { metadata: { appId: APP_ID } }
    )

    expect(vi.mocked(addSkillNameToSpan)).not.toHaveBeenCalled()
  })
})
