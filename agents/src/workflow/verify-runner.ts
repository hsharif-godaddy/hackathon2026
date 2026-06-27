import type { VerifyCheck } from './types.js'
import { createForWorkspace } from '../workspace/index.js'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'workflow-verify-runner' })

export interface VerifyResult {
  passed: boolean
  failures: string[]
}

function isDocsOnly(ownedFiles: string[]): boolean {
  return ownedFiles.length > 0 && ownedFiles.every((f: string) => f.startsWith('docs/'))
}

export async function runVerifyChecks(appId: string, checks: VerifyCheck[], ownedFiles?: string[]): Promise<VerifyResult> {
  if (checks.length === 0) {
    return { passed: true, failures: [] }
  }

  const docsOnly: boolean = ownedFiles ? isDocsOnly(ownedFiles) : false

  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) {
    return { passed: false, failures: ['No workspace available'] }
  }

  const failures: string[] = []

  for (const check of checks) {
    switch (check.kind) {
      case 'files_exist': {
        const paths: string[] = check.spec.split(',').map((p: string) => p.trim())
        const result = await workspace.files.stat({ paths })
        for (const entry of result.entries) {
          if (entry.error) {
            failures.push(`File not found: ${entry.path}`)
          }
        }
        break
      }
      case 'tsc': {
        if (docsOnly) {
          logger.info('workflow_verify.tsc.skipped_docs_only', { appId })
          break
        }
        logger.warn('workflow_verify.tsc.not_implemented', { appId, spec: check.spec })
        failures.push(`Verify kind "tsc" not yet implemented — failing closed`)
        break
      }
      case 'route_renders': {
        if (docsOnly) break
        logger.warn('workflow_verify.route_renders.not_implemented', { appId, spec: check.spec })
        failures.push(`Verify kind "route_renders" not yet implemented — failing closed`)
        break
      }
      case 'test': {
        if (docsOnly) break
        logger.warn('workflow_verify.test.not_implemented', { appId, spec: check.spec })
        failures.push(`Verify kind "test" not yet implemented — failing closed`)
        break
      }
      case 'manual': {
        break
      }
      default: {
        const _exhaustive: never = check.kind
        logger.warn('workflow_verify.unknown_kind', { appId, kind: _exhaustive })
        break
      }
    }
  }

  return { passed: failures.length === 0, failures }
}
