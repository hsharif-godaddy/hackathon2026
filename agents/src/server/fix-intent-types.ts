import type { BuildContextAttachmentsCustomContext } from '@airo/shared/context-attachment'
import { existsSync, readFileSync } from 'node:fs'
import * as path from 'node:path'

import { AppRepository } from '../database/index.js'
import { SeoQualityRepository } from '../database/repositories/SeoQualityRepository.js'
import { logger } from '../logging/index.js'
import { publishJobRegistry } from './routes/publish/job-registry.js'

const FIX_INTENT_CONTEXT_TYPES: ReadonlySet<string> = new Set([
  'build_error',
  'qa_issues_fix_request',
  'security_issues_fix_request',
  'seo_audit_fix',
  'seo_quality_regression',
  'runtime_error',
  'preview_fix',
])

export function isFixIntentContext(customContext: BuildContextAttachmentsCustomContext | undefined | null): boolean {
  if (!customContext || !customContext.type) return false
  return FIX_INTENT_CONTEXT_TYPES.has(customContext.type)
}

interface CorroborationResult {
  verified: boolean
  reason: string
}

type CorroborationCheck = (appId: string) => CorroborationResult

const CORROBORATION_REGISTRY: ReadonlyMap<string, CorroborationCheck> = new Map([
  ['build_error', verifyPublishFailure],
  ['preview_fix', verifyPublishFailure],
  ['runtime_error', verifyPublishFailure],
  ['seo_quality_regression', verifySeoRegression],
  ['seo_audit_fix', verifySeoAudit],
  ['qa_issues_fix_request', verifyAppReport('qa-report.json')],
  ['security_issues_fix_request', verifyAppReport('security-report.json')],
])

export function corroborateFixIntent(appId: string, contextType: string): CorroborationResult {
  const check: CorroborationCheck | undefined = CORROBORATION_REGISTRY.get(contextType)
  if (!check) {
    return { verified: false, reason: 'no_corroboration_check' }
  }
  try {
    return check(appId)
  } catch (err) {
    logger.warn('fix_intent.corroboration.error', {
      appId,
      contextType,
      error: err instanceof Error ? err.message : String(err),
    })
    return { verified: false, reason: 'corroboration_check_failed' }
  }
}

function verifyPublishFailure(appId: string): CorroborationResult {
  const job = publishJobRegistry.get(appId)
  if (job?.phase === 'failed') {
    return { verified: true, reason: 'publish_job_failed' }
  }
  return { verified: false, reason: 'no_recent_publish_failure' }
}

function verifySeoRegression(appId: string): CorroborationResult {
  const repo: SeoQualityRepository = new SeoQualityRepository()
  const latest = repo.findLatest(appId)
  if (latest) {
    const baseline = repo.findBaseline(appId)
    if (baseline && latest.score < baseline.score) {
      return { verified: true, reason: 'seo_score_regressed' }
    }
  }
  return { verified: false, reason: 'no_seo_regression' }
}

function verifySeoAudit(appId: string): CorroborationResult {
  const repo: SeoQualityRepository = new SeoQualityRepository()
  const latest = repo.findLatest(appId)
  if (latest && latest.score < 100) {
    return { verified: true, reason: 'seo_score_below_threshold' }
  }
  return { verified: false, reason: 'no_seo_issues' }
}

const REPORT_MAX_AGE_MS = 3_600_000

function verifyAppReport(filename: string): CorroborationCheck {
  return (appId: string): CorroborationResult => {
    const appRepo: AppRepository = new AppRepository()
    const app = appRepo.findById(appId)
    if (!app?.path) return { verified: false, reason: 'app_path_unavailable' }
    const reportPath: string = path.join(app.path, '.airo', filename)
    if (!existsSync(reportPath)) {
      return { verified: false, reason: `no_${filename}` }
    }
    try {
      const raw: string = readFileSync(reportPath, 'utf-8')
      const parsed = JSON.parse(raw) as { scannedAt?: string; report?: { summary?: { errors?: number; warnings?: number } } }
      const scannedAt: number = parsed.scannedAt ? new Date(parsed.scannedAt).getTime() : NaN
      if (!Number.isFinite(scannedAt) || Date.now() - scannedAt > REPORT_MAX_AGE_MS) {
        return { verified: false, reason: `${filename}_stale` }
      }
      const issueCount: number = (parsed.report?.summary?.errors ?? 0) + (parsed.report?.summary?.warnings ?? 0)
      if (issueCount === 0) {
        return { verified: false, reason: `${filename}_no_issues` }
      }
      return { verified: true, reason: `${filename}_has_issues` }
    } catch {
      return { verified: false, reason: `${filename}_unreadable` }
    }
  }
}
