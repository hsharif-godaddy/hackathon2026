import { describe, it, expect, vi, beforeEach } from 'vitest'

import { isFixIntentContext, corroborateFixIntent } from '../fix-intent-types.js'

const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}))

vi.mock('../routes/publish/job-registry.js', () => ({
  publishJobRegistry: {
    get: vi.fn(),
  },
}))

const mockFindLatest = vi.fn()
const mockFindBaseline = vi.fn()
vi.mock('../../database/repositories/SeoQualityRepository.js', () => ({
  SeoQualityRepository: class {
    findLatest = mockFindLatest
    findBaseline = mockFindBaseline
  },
}))

const mockFindById = vi.fn()
vi.mock('../../database/index.js', () => ({
  AppRepository: class {
    findById = mockFindById
  },
}))

import { publishJobRegistry } from '../routes/publish/job-registry.js'

describe('isFixIntentContext', () => {
  const fixTypes: string[] = [
    'build_error',
    'qa_issues_fix_request',
    'security_issues_fix_request',
    'seo_audit_fix',
    'seo_quality_regression',
    'runtime_error',
    'preview_fix',
  ]

  for (const type of fixTypes) {
    it(`returns true for fix type: ${type}`, () => {
      expect(isFixIntentContext({ type })).toBe(true)
    })
  }

  const nonFixTypes: string[] = [
    'plan_item',
    'social_publish_ready',
    'scheduled_content_creation',
    'marketing_launch_package',
  ]

  for (const type of nonFixTypes) {
    it(`returns false for non-fix type: ${type}`, () => {
      expect(isFixIntentContext({ type })).toBe(false)
    })
  }

  it('returns false for null customContext', () => {
    expect(isFixIntentContext(null)).toBe(false)
  })

  it('returns false for undefined customContext', () => {
    expect(isFixIntentContext(undefined)).toBe(false)
  })

  it('returns false for customContext without type field', () => {
    expect(isFixIntentContext({})).toBe(false)
  })

  it('returns false for customContext with empty string type', () => {
    expect(isFixIntentContext({ type: '' })).toBe(false)
  })
})

describe('corroborateFixIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('build_error / preview_fix / runtime_error', () => {
    it('verifies when publishJobRegistry has a failed job', () => {
      vi.mocked(publishJobRegistry.get).mockReturnValue({
        jobId: 'pub_1', appId: 'app-1', phase: 'failed', commitHash: null,
        version: null, error: 'build failed', logs: null, startedAt: Date.now(), buildTimeoutSeconds: null,
      })

      const result = corroborateFixIntent('app-1', 'build_error')
      expect(result.verified).toBe(true)
      expect(result.reason).toBe('publish_job_failed')
    })

    it('fails when no publish job exists', () => {
      vi.mocked(publishJobRegistry.get).mockReturnValue(null)

      const result = corroborateFixIntent('app-1', 'build_error')
      expect(result.verified).toBe(false)
    })

    it('fails when publish job is not in failed phase', () => {
      vi.mocked(publishJobRegistry.get).mockReturnValue({
        jobId: 'pub_1', appId: 'app-1', phase: 'deployed', commitHash: 'abc',
        version: '1', error: null, logs: null, startedAt: Date.now(), buildTimeoutSeconds: null,
      })

      const result = corroborateFixIntent('app-1', 'preview_fix')
      expect(result.verified).toBe(false)
    })
  })

  describe('seo_quality_regression', () => {
    it('verifies when SEO score regressed from baseline', () => {
      mockFindLatest.mockReturnValue({ score: 60 })
      mockFindBaseline.mockReturnValue({ score: 80 })

      const result = corroborateFixIntent('app-1', 'seo_quality_regression')
      expect(result.verified).toBe(true)
      expect(result.reason).toBe('seo_score_regressed')
    })

    it('fails when score has not regressed', () => {
      mockFindLatest.mockReturnValue({ score: 80 })
      mockFindBaseline.mockReturnValue({ score: 80 })

      const result = corroborateFixIntent('app-1', 'seo_quality_regression')
      expect(result.verified).toBe(false)
      expect(result.reason).toBe('no_seo_regression')
    })

    it('fails when no SEO scores exist', () => {
      mockFindLatest.mockReturnValue(null)

      const result = corroborateFixIntent('app-1', 'seo_quality_regression')
      expect(result.verified).toBe(false)
    })
  })

  describe('seo_audit_fix', () => {
    it('verifies when SEO score is below 100', () => {
      mockFindLatest.mockReturnValue({ score: 80 })

      const result = corroborateFixIntent('app-1', 'seo_audit_fix')
      expect(result.verified).toBe(true)
      expect(result.reason).toBe('seo_score_below_threshold')
    })

    it('fails when SEO score is perfect', () => {
      mockFindLatest.mockReturnValue({ score: 100 })

      const result = corroborateFixIntent('app-1', 'seo_audit_fix')
      expect(result.verified).toBe(false)
      expect(result.reason).toBe('no_seo_issues')
    })

    it('fails when no SEO scores exist', () => {
      mockFindLatest.mockReturnValue(null)

      const result = corroborateFixIntent('app-1', 'seo_audit_fix')
      expect(result.verified).toBe(false)
      expect(result.reason).toBe('no_seo_issues')
    })
  })

  describe('qa_issues_fix_request', () => {
    it('verifies when report exists, is recent, and has issues', () => {
      mockFindById.mockReturnValue({ path: '/apps/app-1' })
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scannedAt: new Date().toISOString(),
        report: { summary: { errors: 2, warnings: 1 } },
      }))

      const result = corroborateFixIntent('app-1', 'qa_issues_fix_request')
      expect(result.verified).toBe(true)
      expect(result.reason).toBe('qa-report.json_has_issues')
    })

    it('fails when report file does not exist', () => {
      mockFindById.mockReturnValue({ path: '/apps/app-1' })
      mockExistsSync.mockReturnValue(false)

      const result = corroborateFixIntent('app-1', 'qa_issues_fix_request')
      expect(result.verified).toBe(false)
      expect(result.reason).toBe('no_qa-report.json')
    })

    it('fails when app.path is unavailable', () => {
      mockFindById.mockReturnValue(null)

      const result = corroborateFixIntent('app-1', 'qa_issues_fix_request')
      expect(result.verified).toBe(false)
      expect(result.reason).toBe('app_path_unavailable')
    })

    it('fails when report has zero issues', () => {
      mockFindById.mockReturnValue({ path: '/apps/app-1' })
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scannedAt: new Date().toISOString(),
        report: { summary: { errors: 0, warnings: 0 } },
      }))

      const result = corroborateFixIntent('app-1', 'qa_issues_fix_request')
      expect(result.verified).toBe(false)
      expect(result.reason).toBe('qa-report.json_no_issues')
    })

    it('fails when report is stale (>1hr)', () => {
      mockFindById.mockReturnValue({ path: '/apps/app-1' })
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scannedAt: new Date(Date.now() - 7_200_000).toISOString(),
        report: { summary: { errors: 3, warnings: 0 } },
      }))

      const result = corroborateFixIntent('app-1', 'qa_issues_fix_request')
      expect(result.verified).toBe(false)
      expect(result.reason).toBe('qa-report.json_stale')
    })
  })

  describe('security_issues_fix_request', () => {
    it('verifies when security report exists with issues', () => {
      mockFindById.mockReturnValue({ path: '/apps/app-1' })
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        scannedAt: new Date().toISOString(),
        report: { summary: { errors: 1, warnings: 0 } },
      }))

      const result = corroborateFixIntent('app-1', 'security_issues_fix_request')
      expect(result.verified).toBe(true)
      expect(result.reason).toBe('security-report.json_has_issues')
    })

    it('fails when security report does not exist', () => {
      mockFindById.mockReturnValue({ path: '/apps/app-1' })
      mockExistsSync.mockReturnValue(false)

      const result = corroborateFixIntent('app-1', 'security_issues_fix_request')
      expect(result.verified).toBe(false)
      expect(result.reason).toBe('no_security-report.json')
    })
  })

  describe('unregistered type', () => {
    it('returns not verified for unknown type', () => {
      const result = corroborateFixIntent('app-1', 'unknown_type')
      expect(result.verified).toBe(false)
      expect(result.reason).toBe('no_corroboration_check')
    })
  })
})
