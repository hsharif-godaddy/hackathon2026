import { describe, it, expect, vi, beforeEach } from 'vitest'

import { runWithProfile } from '../../profiles/profile-context.js'
import type { ProfileData } from '../../profiles/types.js'

const mockGetModel = vi.hoisted(() => vi.fn())
const mockGetModelInfo = vi.hoisted(() => vi.fn())
const mockGetActiveModelOverride = vi.hoisted(() => vi.fn())
const mockIsAnthropicAvailable = vi.hoisted(() => vi.fn())
const mockIsOpenAIAvailable = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@airo/ai-lib', () => ({
  getModel: mockGetModel,
  getModelInfo: mockGetModelInfo,
  getActiveModelOverride: mockGetActiveModelOverride,
}))

vi.mock('../../logging/index.js', () => ({
  logger: mockLogger,
}))

vi.mock('ai', () => ({
  wrapLanguageModel: vi.fn((opts: any) => opts.model),
}))

vi.mock('@ai-sdk/devtools', () => ({
  devToolsMiddleware: vi.fn(),
}))

import { getAgentModel, getAgentModelWithName } from '../model-selection.js'

const fakeModel = { modelId: 'fake-model' } as any
const fakeModelInfo = {
  shortName: 'opus',
  fullName: 'claude-opus-4-6',
  provider: 'anthropic',
  usingProxy: false,
  isSupported: true,
}

const profileWithModel: ProfileData = {
  name: 'test-profile',
  description: 'Test',
  properties: { 'model.default': 'claude-opus-4-6' },
}

const profileWithoutModel: ProfileData = {
  name: 'no-model-profile',
  description: 'Test',
  properties: { 'feature.something': true },
}

describe('model-selection profile integration', function suite() {
  beforeEach(function reset() {
    vi.clearAllMocks()
    mockGetActiveModelOverride.mockReturnValue(null)
    mockIsAnthropicAvailable.mockReturnValue(true)
    mockIsOpenAIAvailable.mockReturnValue(false)
    mockGetModel.mockResolvedValue(fakeModel)
    mockGetModelInfo.mockReturnValue(fakeModelInfo)
    process.env.ENABLE_AI_DEVTOOLS = 'false'
    delete process.env.AI_MODEL_OVERRIDE
  })

  describe('getAgentModel', function getAgentModelTests() {
    it('uses profile model.default when profile is active', async function usesProfileModel() {
      await runWithProfile(profileWithModel, async () => {
        const result = await getAgentModel('full')
        expect(mockGetModel).toHaveBeenCalledWith('claude-opus-4-6')
        expect(result).toBe(fakeModel)
        expect(mockLogger.info).toHaveBeenCalledWith(
          'model.profile.active',
          expect.objectContaining({ profileModel: 'claude-opus-4-6' }),
        )
      })
    })

    it('falls back to default when profile has no model.default', async function noProfileModel() {
      await runWithProfile(profileWithoutModel, async () => {
        const result = await getAgentModel('full')
        expect(mockLogger.info).not.toHaveBeenCalledWith(
          'model.profile.active',
          expect.anything(),
        )
        expect(result).toBe(fakeModel)
      })
    })

    it('falls back to default selection when profile model fails', async function profileModelFails() {
      mockGetModel
        .mockRejectedValueOnce(new Error('Model not found'))
        .mockResolvedValueOnce(fakeModel)

      await runWithProfile(profileWithModel, async () => {
        const result = await getAgentModel('full')
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'model.profile.failure',
          expect.objectContaining({
            profileModel: 'claude-opus-4-6',
            message: 'Falling back to default model selection',
          }),
        )
        expect(result).toBe(fakeModel)
      })
    })

    it('does not use profile model when no profile is active', async function noProfile() {
      await getAgentModel('full')
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        'model.profile.active',
        expect.anything(),
      )
    })
  })

  describe('getAgentModelWithName', function getAgentModelWithNameTests() {
    it('uses profile model.default when profile is active', async function usesProfileModel() {
      await runWithProfile(profileWithModel, async () => {
        const result = await getAgentModelWithName('full')
        expect(mockGetModel).toHaveBeenCalledWith('claude-opus-4-6')
        expect(result.modelName).toBe('claude-opus-4-6')
      })
    })

    it('falls back to default when profile model fails', async function profileModelFails() {
      mockGetModel
        .mockRejectedValueOnce(new Error('Model not found'))
        .mockResolvedValueOnce(fakeModel)

      await runWithProfile(profileWithModel, async () => {
        const result = await getAgentModelWithName('full')
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'model.profile.failure',
          expect.objectContaining({ profileModel: 'claude-opus-4-6' }),
        )
        expect(result.model).toBe(fakeModel)
      })
    })
  })
})
