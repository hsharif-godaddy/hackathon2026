import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssessmentTaskType } from '../types.js'

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  getEmbeddingModel: vi.fn(),
  generateEmbeddings: vi.fn(),
  llmMetadataContextRun: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }))

vi.mock('@airo/ai-lib', () => ({
  getEmbeddingModel: mocks.getEmbeddingModel,
  generateEmbeddings: mocks.generateEmbeddings,
}))

vi.mock('@airo/ai-common', () => ({
  llmMetadataContext: { run: mocks.llmMetadataContextRun },
}))

vi.mock('@airo/ai-grants', () => ({
  BudgetOverride: { AssessAgent: 'airo-builder:assess-agent' },
  LlmCallSource: { AgentAssessment: 'agent:assessment' },
}))

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build 1536-dimension weights that produce a predictable output.
 *
 * weights[0] = 1, rest = 0
 * embedding[0] = embeddingValue, rest = 0
 * L2-norm of embedding = |embeddingValue|
 * normalized[0] = sign(embeddingValue)
 * dot = sign(embeddingValue) * 1
 * sigmoid(dot + bias)
 */
function makeWeights(bias: number): number[] {
  const w = new Array(1536).fill(0) as number[]
  w[0] = 1
  return w
}

/** `threshold: 'omit'` drops the key so runtime falls back to 0.5. */
function makeArtifact(
  bias: number,
  weights?: number[],
  threshold: number | 'omit' = 0.52
): string {
  const metadata: Record<string, unknown> = {
    trainSize: 100,
    accuracy: 0.95,
    cvAccuracy: 0.95,
    f1Fix: 0.90,
    f1General: 0.96,
    regularizationC: 1.0,
    pcaDimensions: null,
    pcaVarianceRetained: null,
    trainedAt: '2024-01-01T00:00:00Z',
  }
  if (threshold !== 'omit') {
    metadata.threshold = threshold
  }
  return JSON.stringify({
    weights: weights ?? makeWeights(bias),
    bias,
    pca: null,
    metadata,
  })
}

/** Embedding that places all weight in dimension 0 (magnitude = |val|) */
function makeEmbedding(val: number): number[] {
  const e = new Array(1536).fill(0) as number[]
  e[0] = val
  return e
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LRClassifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: valid artifact with bias=-5 (probFix≈0.007 → confident General)
    mocks.readFile.mockResolvedValue(makeArtifact(-5))
    mocks.getEmbeddingModel.mockResolvedValue({ modelId: 'text-embedding-3-small' })
    mocks.llmMetadataContextRun.mockImplementation(
      async (_meta: unknown, fn: () => Promise<unknown>) => fn()
    )
  })

  describe('#initialize', () => {
    it('should load weights and embedding model on first call', async () => {
      const { LRClassifier } = await import('../lr-classifier.js')
      const classifier = new LRClassifier()
      await classifier.initialize()

      expect(mocks.readFile).toHaveBeenCalledOnce()
      expect(mocks.getEmbeddingModel).toHaveBeenCalledWith('text-embedding-3-small')
      expect(classifier.isReady()).toBe(true)
    })

    it('should only call readFile once on repeated initialize calls', async () => {
      const { LRClassifier } = await import('../lr-classifier.js')
      const classifier = new LRClassifier()
      await classifier.initialize()
      await classifier.initialize()

      expect(mocks.readFile).toHaveBeenCalledOnce()
    })

    it('should mark as ready=false when weights have wrong dimensions after all attempts', async () => {
      mocks.readFile.mockResolvedValue(JSON.stringify({
        weights: [1, 2, 3],
        bias: 0,
        pca: null,
        metadata: { trainedAt: '2024-01-01' },
      }))

      const { LRClassifier } = await import('../lr-classifier.js')
      const classifier = new LRClassifier()
      await expect(classifier.initialize()).resolves.not.toThrow()
      expect(mocks.readFile).toHaveBeenCalledTimes(3)
      expect(classifier.isReady()).toBe(false)
    })

    it('should resolve initialize after exhausting retries when file is missing', async () => {
      mocks.readFile.mockRejectedValue(new Error('ENOENT: file not found'))

      const { LRClassifier } = await import('../lr-classifier.js')
      const classifier = new LRClassifier()
      await expect(classifier.initialize()).resolves.not.toThrow()
      expect(mocks.readFile).toHaveBeenCalledTimes(3)

      // classify() still returns a safe fallback
      mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })
      const result = await classifier.classify('fix this bug')

      expect(result.taskType).toBe(AssessmentTaskType.General)
      expect(result.confidence).toBe(0)
      expect(result.requiresHaikuVerification).toBe(true)
      expect(result.method).toBe('embedding-lr')
    })

    it('should succeed when a later attempt loads valid weights', async () => {
      mocks.readFile
        .mockRejectedValueOnce(new Error('transient read error'))
        .mockResolvedValueOnce(makeArtifact(-5))

      const { LRClassifier } = await import('../lr-classifier.js')
      const classifier = new LRClassifier()
      await classifier.initialize()

      expect(mocks.readFile).toHaveBeenCalledTimes(2)
      expect(classifier.isReady()).toBe(true)
    })

    it('should fall back to 0.5 decision threshold when metadata.threshold is omitted', async () => {
      mocks.readFile.mockResolvedValue(makeArtifact(-0.96, undefined, 'omit'))
      mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

      const { LRClassifier } = await import('../lr-classifier.js')
      const classifier = new LRClassifier()
      await classifier.initialize()

      const probFix = sigmoid(1 - 0.96)
      expect(probFix).toBeGreaterThan(0.5)
      expect(probFix).toBeLessThan(0.52)

      const result = await classifier.classify('borderline')
      expect(result.taskType).toBe(AssessmentTaskType.Fix)
    })
  })

  describe('#classify', () => {
    describe('inference correctness', () => {
      it('should classify as Fix when probFix > trained threshold (0.52)', async () => {
        // weights[0]=1, embedding[0]=1 → l2norm→1 → dot=1, bias=2 → z=3 → sigmoid≈0.95 → Fix
        mocks.readFile.mockResolvedValue(makeArtifact(2))
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('fix this bug')

        const expectedProbFix = sigmoid(1 + 2) // dot(norm([1,0,...]), [1,0,...]) + bias=2 = 3
        expect(result.taskType).toBe(AssessmentTaskType.Fix)
        expect(result.similarity).toBeCloseTo(expectedProbFix, 3)
        expect(result.confidence).toBe(Math.round(expectedProbFix * 100))
      })

      it('should classify as General when probFix <= trained threshold (0.52)', async () => {
        // weights[0]=1, embedding[0]=1 → dot=1, bias=-5 → z=-4 → sigmoid≈0.018 → General
        mocks.readFile.mockResolvedValue(makeArtifact(-5))
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('add a contact form')

        const expectedProbFix = sigmoid(1 - 5)
        expect(result.taskType).toBe(AssessmentTaskType.General)
        expect(result.similarity).toBeCloseTo(expectedProbFix, 3)
        expect(result.confidence).toBe(Math.round((1 - expectedProbFix) * 100))
      })

      it('should L2-normalize the embedding before dot product', async () => {
        // embedding[0]=10 → l2norm=10 → normalized[0]=1 → dot=1, bias=2 → same as embedding[0]=1
        mocks.readFile.mockResolvedValue(makeArtifact(2))
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(10) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('fix the layout')

        const expectedProbFix = sigmoid(1 + 2)
        expect(result.similarity).toBeCloseTo(expectedProbFix, 3)
        expect(result.taskType).toBe(AssessmentTaskType.Fix)
      })

      it('should compute margin as |probFix - decisionThreshold| * 2', async () => {
        mocks.readFile.mockResolvedValue(makeArtifact(2))
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('fix the bug')

        const probFix = sigmoid(3)
        const trainedThreshold = 0.52
        expect(result.margin).toBeCloseTo(Math.abs(probFix - trainedThreshold) * 2, 3)
      })

      it('should classify borderline probFix as General when trained threshold is 0.52', async () => {
        // probFix = sigmoid(0.04) ≈ 0.51 — Fix at 0.5 but General at 0.52
        mocks.readFile.mockResolvedValue(makeArtifact(-0.96))
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('ambiguous')

        expect(result.taskType).toBe(AssessmentTaskType.General)
      })

      it('should always return empty matchedExample', async () => {
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('fix this')

        expect(result.matchedExample).toBe('')
        expect(result.method).toBe('embedding-lr')
      })
    })

    describe('requiresHaikuVerification flag', () => {
      it('should be false when confidence > 80 and no negation', async () => {
        // bias=2 → probFix=sigmoid(3)≈0.95 → confidence=95 → no haiku needed
        mocks.readFile.mockResolvedValue(makeArtifact(2))
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('fix this bug')

        expect(result.confidence).toBeGreaterThan(80)
        expect(result.requiresHaikuVerification).toBe(false)
      })

      it('should be true when confidence <= 80', async () => {
        // z close to 0 → probFix≈0.5 → confidence=50 → haiku needed
        // weights[0]=1, embedding[0]=1 → dot=1, bias=-1 → z=0 → sigmoid=0.5
        mocks.readFile.mockResolvedValue(makeArtifact(-1))
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('something unclear')

        expect(result.confidence).toBeLessThanOrEqual(80)
        expect(result.requiresHaikuVerification).toBe(true)
      })

      it('should be true when negation is detected (even with high confidence)', async () => {
        // High confidence Fix (bias=2)
        mocks.readFile.mockResolvedValue(makeArtifact(2))
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify("don't fix this")

        expect(result.hasNegation).toBe(true)
        expect(result.requiresHaikuVerification).toBe(true)
      })
    })

    describe('negation detection', () => {
      it('should detect "not yet" as negation', async () => {
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('not yet, wait before publishing')

        expect(result.hasNegation).toBe(true)
      })

      it('should detect "don\'t" as negation', async () => {
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify("don't fix this yet")

        expect(result.hasNegation).toBe(true)
      })

      it('should not flag normal prompts as negation', async () => {
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [{ embedding: makeEmbedding(1) }] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('fix the broken button on the homepage')

        expect(result.hasNegation).toBe(false)
      })
    })

    describe('error fallback', () => {
      it('should return safe General fallback when embedding call fails', async () => {
        mocks.generateEmbeddings.mockRejectedValue(new Error('API error'))

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('fix this')

        expect(result.taskType).toBe(AssessmentTaskType.General)
        expect(result.confidence).toBe(0)
        expect(result.requiresHaikuVerification).toBe(true)
        expect(result.method).toBe('embedding-lr')
        expect(result.hasNegation).toBe(false)
      })

      it('should return safe fallback when embedding returns no data', async () => {
        mocks.generateEmbeddings.mockResolvedValue({ embeddings: [] })

        const { LRClassifier } = await import('../lr-classifier.js')
        const classifier = new LRClassifier()
        const result = await classifier.classify('fix this')

        expect(result.taskType).toBe(AssessmentTaskType.General)
        expect(result.confidence).toBe(0)
        expect(result.requiresHaikuVerification).toBe(true)
      })
    })
  })
})
