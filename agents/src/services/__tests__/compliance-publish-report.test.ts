import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReportDocumentStatus } = vi.hoisted(() => ({
  mockReportDocumentStatus: vi.fn(),
}));

vi.mock('../ComplianceService.js', () => ({
  // Mirror the real enum values + key helper so the helper's imports resolve
  // without pulling in @airo/ai-lib (which isn't needed for this unit).
  DocumentType: {
    PrivacyPolicy: 'privacy-policy',
    TermsOfUse: 'terms-of-use',
  },
  complianceDocStatusMemoryKey: (documentType: string) => `compliance.document.${documentType}.generated`,
  complianceService: {
    reportDocumentStatus: mockReportDocumentStatus,
  },
}));

import { reportPublishedComplianceStatus } from '../compliance-publish-report.js';
import type { MemoryRepository } from '../../database/repositories/MemoryRepository.js';
import type { WorkspaceClient } from '../../workspace/index.js';
import type { StatResult } from '../../workspace/files.js';

const PRIVACY_KEY = 'compliance.document.privacy-policy.generated';
const TERMS_KEY = 'compliance.document.terms-of-use.generated';
const PRIVACY_PAGE = 'src/pages/privacy.tsx';
const TERMS_PAGE = 'src/pages/terms.tsx';

interface Harness {
  workspace: WorkspaceClient;
  repo: MemoryRepository;
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  statMock: ReturnType<typeof vi.fn>;
  getMock: ReturnType<typeof vi.fn>;
}

function fileFound(path: string): StatResult {
  return { entries: [{ path, kind: 'file', size: 100, modifiedAt: '2026-01-01T00:00:00Z' }] };
}

function fileMissing(path: string): StatResult {
  return { entries: [{ path, error: 'not_found' }] };
}

/** A memory marker present and set to `true` (document generated). */
function markerSet() {
  return Promise.resolve({ success: true, exists: true, value: true });
}

/** No memory marker (document never generated). */
function markerAbsent() {
  return Promise.resolve({ success: true, exists: false });
}

function makeHarness(): Harness {
  const statMock = vi.fn();
  const getMock = vi.fn();

  const workspace = {
    files: { stat: statMock },
  } as unknown as WorkspaceClient;

  const repo = {
    get: getMock,
  } as unknown as MemoryRepository;

  const logger = { info: vi.fn(), warn: vi.fn() };

  return { workspace, repo, logger, statMock, getMock };
}

describe('reportPublishedComplianceStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips a document type that was never generated (no marker)', async () => {
    const h = makeHarness();
    h.getMock.mockImplementation(() => markerAbsent());

    await reportPublishedComplianceStatus('app-1', 'cust-1', h.workspace, h.logger, h.repo);

    expect(h.statMock).not.toHaveBeenCalled();
    expect(mockReportDocumentStatus).not.toHaveBeenCalled();
  });

  it('skips and logs docError when the marker read fails (does not report)', async () => {
    const h = makeHarness();
    h.getMock.mockResolvedValue({ success: false, exists: false, error: 'db locked' });

    await reportPublishedComplianceStatus('app-1', 'cust-1', h.workspace, h.logger, h.repo);

    // A failed read must NOT be treated as "never generated"; no report, no stat.
    expect(h.statMock).not.toHaveBeenCalled();
    expect(mockReportDocumentStatus).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledWith(
      'compliance.publishReport.docError',
      expect.objectContaining({
        documentType: 'privacy-policy',
        error: 'marker read failed: db locked',
      }),
    );
  });

  it('reports published=true when generated and the page still exists', async () => {
    const h = makeHarness();
    h.getMock.mockImplementation((_appId: string, key: string) => (key === PRIVACY_KEY ? markerSet() : markerAbsent()));
    h.statMock.mockResolvedValue(fileFound(PRIVACY_PAGE));

    await reportPublishedComplianceStatus('app-1', 'cust-1', h.workspace, h.logger, h.repo);

    expect(h.statMock).toHaveBeenCalledWith({ paths: [PRIVACY_PAGE] });
    expect(mockReportDocumentStatus).toHaveBeenCalledTimes(1);
    expect(mockReportDocumentStatus).toHaveBeenCalledWith('cust-1', 'app-1', 'privacy-policy', true);
  });

  it('reports published=false when generated but the page was deleted', async () => {
    const h = makeHarness();
    h.getMock.mockImplementation((_appId: string, key: string) => (key === TERMS_KEY ? markerSet() : markerAbsent()));
    h.statMock.mockResolvedValue(fileMissing(TERMS_PAGE));

    await reportPublishedComplianceStatus('app-1', 'cust-1', h.workspace, h.logger, h.repo);

    expect(mockReportDocumentStatus).toHaveBeenCalledTimes(1);
    expect(mockReportDocumentStatus).toHaveBeenCalledWith('cust-1', 'app-1', 'terms-of-use', false);
  });

  it('reports both document types when both were generated', async () => {
    const h = makeHarness();
    h.getMock.mockImplementation(() => markerSet());
    h.statMock.mockImplementation(({ paths }: { paths: string[] }) =>
      Promise.resolve(paths[0] === PRIVACY_PAGE ? fileFound(PRIVACY_PAGE) : fileMissing(TERMS_PAGE)),
    );

    await reportPublishedComplianceStatus('app-1', 'cust-1', h.workspace, h.logger, h.repo);

    expect(mockReportDocumentStatus).toHaveBeenCalledTimes(2);
    expect(mockReportDocumentStatus).toHaveBeenCalledWith('cust-1', 'app-1', 'privacy-policy', true);
    expect(mockReportDocumentStatus).toHaveBeenCalledWith('cust-1', 'app-1', 'terms-of-use', false);
  });

  it('treats a directory at the page path as not published', async () => {
    const h = makeHarness();
    h.getMock.mockImplementation((_appId: string, key: string) => (key === PRIVACY_KEY ? markerSet() : markerAbsent()));
    h.statMock.mockResolvedValue({
      entries: [{ path: PRIVACY_PAGE, kind: 'directory', size: 0, modifiedAt: '2026-01-01T00:00:00Z' }],
    } as StatResult);

    await reportPublishedComplianceStatus('app-1', 'cust-1', h.workspace, h.logger, h.repo);

    expect(mockReportDocumentStatus).toHaveBeenCalledWith('cust-1', 'app-1', 'privacy-policy', false);
  });

  it('skips (does not report) when stat is inconclusive (permission_denied)', async () => {
    const h = makeHarness();
    h.getMock.mockImplementation((_appId: string, key: string) => (key === PRIVACY_KEY ? markerSet() : markerAbsent()));
    h.statMock.mockResolvedValue({ entries: [{ path: PRIVACY_PAGE, error: 'permission_denied' }] } as StatResult);

    await reportPublishedComplianceStatus('app-1', 'cust-1', h.workspace, h.logger, h.repo);

    // Inconclusive stat must NOT assert published:false to the compliance API.
    expect(mockReportDocumentStatus).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledWith(
      'compliance.publishReport.docError',
      expect.objectContaining({
        documentType: 'privacy-policy',
        error: 'stat inconclusive: permission_denied',
      }),
    );
  });

  it('isolates a per-document failure and continues to the next document', async () => {
    const h = makeHarness();
    h.getMock.mockImplementation(() => markerSet());
    h.statMock.mockImplementation(({ paths }: { paths: string[] }) => {
      if (paths[0] === PRIVACY_PAGE) return Promise.reject(new Error('stat failed'));
      return Promise.resolve(fileFound(TERMS_PAGE));
    });

    await reportPublishedComplianceStatus('app-1', 'cust-1', h.workspace, h.logger, h.repo);

    // privacy failed before reporting; terms still reported
    expect(mockReportDocumentStatus).toHaveBeenCalledTimes(1);
    expect(mockReportDocumentStatus).toHaveBeenCalledWith('cust-1', 'app-1', 'terms-of-use', true);
    expect(h.logger.warn).toHaveBeenCalledWith(
      'compliance.publishReport.docError',
      expect.objectContaining({ documentType: 'privacy-policy', error: 'stat failed' }),
    );
  });

  it('does not throw when a reportDocumentStatus call rejects', async () => {
    const h = makeHarness();
    h.getMock.mockImplementation((_appId: string, key: string) => (key === PRIVACY_KEY ? markerSet() : markerAbsent()));
    h.statMock.mockResolvedValue(fileFound(PRIVACY_PAGE));
    mockReportDocumentStatus.mockRejectedValue(new Error('api down'));

    await expect(
      reportPublishedComplianceStatus('app-1', 'cust-1', h.workspace, h.logger, h.repo),
    ).resolves.toBeUndefined();

    expect(h.logger.warn).toHaveBeenCalledWith(
      'compliance.publishReport.docError',
      expect.objectContaining({ documentType: 'privacy-policy', error: 'api down' }),
    );
  });
});
