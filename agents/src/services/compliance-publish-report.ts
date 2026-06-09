import type { WorkspaceClient } from '../workspace/index.js';
import { MemoryRepository } from '../database/repositories/MemoryRepository.js';
import { DocumentType, complianceService, complianceDocStatusMemoryKey } from './ComplianceService.js';

/**
 * Minimal structural logger — matches the `contextLogger` (`ILogger`) passed in
 * from the publish route without coupling this module to the full logger type.
 */
type ComplianceReportLogger = {
  info: (event: string, data: unknown) => void;
  warn: (event: string, data: unknown) => void;
};

/**
 * One compliance document the publish flow may need to report on: the document
 * type and the workspace-relative page the generating tool writes. Kept as data
 * so the report loop stays a single code path.
 */
interface ComplianceDocSpec {
  documentType: DocumentType;
  /** Workspace-relative path of the generated page. */
  pagePath: string;
}

const COMPLIANCE_DOC_SPECS: readonly ComplianceDocSpec[] = [
  {
    documentType: DocumentType.PrivacyPolicy,
    pagePath: 'src/pages/privacy.tsx',
  },
  {
    documentType: DocumentType.TermsOfUse,
    pagePath: 'src/pages/terms.tsx',
  },
] as const;

const LOG_EVENTS = {
  begin: 'compliance.publishReport.begin',
  skip: 'compliance.publishReport.skip',
  reported: 'compliance.publishReport.reported',
  docError: 'compliance.publishReport.docError',
  complete: 'compliance.publishReport.complete',
} as const;

/**
 * Report the published state of compliance documents to the compliance API on
 * publish. For each document type, this only reports when the compliance-docs
 * skill previously generated that document for the app — detected via an O(1)
 * per-app memory marker (see `complianceDocStatusMemoryKey`) written by the
 * generating tool. Apps that never ran the skill have no marker and are
 * skipped. When the marker is present, it checks whether the generated page
 * still exists in the workspace and reports `published: true` when present or
 * `published: false` when it has since been deleted, so the compliance system
 * learns about removals as well as publishes.
 *
 * Designed to be called fire-and-forget after the publish response is sent:
 * per-document failures are caught and logged so one failing report never
 * blocks the others or the publish itself. The caller should still attach a
 * `.catch()` for unexpected rejections.
 */
export async function reportPublishedComplianceStatus(
  appId: string,
  customerId: string,
  workspace: WorkspaceClient,
  logger: ComplianceReportLogger,
  memoryRepository: MemoryRepository = new MemoryRepository(),
): Promise<void> {
  logger.info(LOG_EVENTS.begin, { appId });

  let reportedCount = 0;

  for (const spec of COMPLIANCE_DOC_SPECS) {
    try {
      const marker = await memoryRepository.get(appId, complianceDocStatusMemoryKey(spec.documentType));

      // A failed read returns { success: false, exists: false } — byte-identical
      // to a legitimate miss. Don't conflate the two: an indeterminate marker
      // must not be reported as "never generated" (and the report self-heals on
      // the next publish). Mirrors the inconclusive-stat handling below.
      if (!marker.success) {
        logger.warn(LOG_EVENTS.docError, {
          appId,
          documentType: spec.documentType,
          error: `marker read failed: ${marker.error ?? 'unknown'}`,
        });
        continue;
      }
      if (!marker.exists || marker.value !== true) {
        logger.info(LOG_EVENTS.skip, {
          appId,
          documentType: spec.documentType,
          reason: 'not-generated',
        });
        continue;
      }

      const { entries } = await workspace.files.stat({ paths: [spec.pagePath] });
      const entry = entries[0];

      // Only report a state we can actually distinguish. `not_found` is a
      // genuine deletion (→ published: false), but `permission_denied` /
      // `invalid_path` mean the workspace could not determine the file state.
      // Since reportDocumentStatus PUTs a stateful boolean to a compliance
      // system of record, treat an inconclusive stat as unknown and skip
      // rather than wrongly asserting the document was unpublished.
      if (entry?.error !== undefined && entry.error !== 'not_found') {
        logger.warn(LOG_EVENTS.docError, {
          appId,
          documentType: spec.documentType,
          error: `stat inconclusive: ${entry.error}`,
        });
        continue;
      }

      const published = entry !== undefined && entry.error === undefined && entry.kind === 'file';

      await complianceService.reportDocumentStatus(customerId, appId, spec.documentType, published);

      reportedCount += 1;
      logger.info(LOG_EVENTS.reported, {
        appId,
        documentType: spec.documentType,
        published,
      });
    } catch (error) {
      // Isolate per-document failures so one bad report doesn't suppress the
      // others. Never rethrow — this runs fire-and-forget after publish.
      logger.warn(LOG_EVENTS.docError, {
        appId,
        documentType: spec.documentType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info(LOG_EVENTS.complete, { appId, reportedCount });
}
