import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../airo-cert-token', () => ({
  airoCertTokenService: {
    getToken: vi.fn(),
  },
}));

import { airoCertTokenService } from '../airo-cert-token';
import { buildCaseBody, type OpenCaseInput, openCrmCase } from '../case-client';
import type { CustomerProfile } from '../profile-client';

const FAKE_TOKEN = 'fake-sso-jwt';

const INPUT: OpenCaseInput = {
  customerId: 'cust-1',
  shopperId: 'shop-1',
  description: 'my site is not working',
  appId: 'app-123',
};

const PROFILE: CustomerProfile = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '15551234',
};

describe('buildCaseBody', () => {
  it('populates contact, category, severity, and CRM-spec additionalData', () => {
    const body = buildCaseBody(INPUT, PROFILE);
    expect(body.contactName).toBe('Jane Doe');
    expect(body.contactFirstName).toBe('Jane');
    expect(body.contactLastName).toBe('Doe');
    expect(body.contactEmail).toBe('jane@example.com');
    expect(body.contactPhone).toBe('15551234');
    expect(body.shopperId).toBe('shop-1');
    expect(body.primaryCategory).toBe('Websites');
    expect(body.secondaryCategory).toBe('Airo AI Builder');
    expect(body.issue).toBe('General Support');
    expect(body.recordType).toBe('standard');
    expect(body.additionalData).toEqual({
      permissionToMakeChanges: 'true',
      severity: 'S2',
      escalated: 'true',
      type: 'Complete',
      escalationDetails: 'my site is not working',
    });
  });

  it('does not include legacy or non-spec keys in additionalData', () => {
    const body = buildCaseBody(INPUT, PROFILE);
    // CRM silently drops keys whose case or wording doesn't match the spec —
    // lock against any legacy variant slipping back in.
    expect(body.additionalData).not.toHaveProperty('Permission to Make Changes');
    expect(body.additionalData).not.toHaveProperty('Type');
    expect(body.additionalData).not.toHaveProperty('Escalation Details');
    expect(body.additionalData).not.toHaveProperty('followUpConsent');
    expect(body.additionalData).not.toHaveProperty('appId');
  });

  it('formats note as "Comment : (appid - <appId>) <description>" when appId is present', () => {
    const body = buildCaseBody(INPUT, PROFILE);
    expect(body.caseNotes[0]?.note).toBe('Comment : (appid - app-123) my site is not working');
  });

  it('omits the appid segment from the note when appId is null', () => {
    const body = buildCaseBody({ ...INPUT, appId: null }, PROFILE);
    expect(body.caseNotes[0]?.note).toBe('Comment : my site is not working');
    expect(body.caseNotes[0]?.note).not.toContain('appid');
  });

  it('omits contactPhone when profile phone is null', () => {
    const body = buildCaseBody(INPUT, { ...PROFILE, phone: null });
    expect(body.contactPhone).toBeUndefined();
  });

  it('truncates very long descriptions in caseNotes and escalationDetails', () => {
    const longDesc = 'x'.repeat(5000);
    const body = buildCaseBody({ ...INPUT, description: longDesc }, PROFILE);
    const prefix = 'Comment : (appid - app-123) ';
    expect(body.caseNotes[0]?.note.length).toBeLessThanOrEqual(4000 + prefix.length);
    // Lock that truncation runs on the description before composition, so
    // the prefix stays intact at the front of the note.
    expect(body.caseNotes[0]?.note.startsWith(prefix)).toBe(true);
    expect(body.additionalData.escalationDetails.length).toBeLessThanOrEqual(4000);
  });
});

describe('openCrmCase', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.mocked(airoCertTokenService.getToken).mockResolvedValue(FAKE_TOKEN);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function mockFetchSequence(profileResponse: Partial<Response>, caseResponse: Partial<Response>) {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(profileResponse as Response)
      .mockResolvedValueOnce(caseResponse as Response);
  }

  it('fetches profile with sso-jwt auth + X-App-Key, then POSTs CRM case and returns caseId', async () => {
    mockFetchSequence(
      {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          data: {
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
            phoneNumbers: [{ code: '1', number: '5551234' }],
          },
        }),
      },
      {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { id: 'case-xyz', caseNumber: '000123' } }),
      },
    );

    const result = await openCrmCase(INPUT);

    const calls = vi.mocked(global.fetch).mock.calls;
    const [profileUrl, profileInit] = calls[0] as [string, RequestInit];
    expect(profileUrl).toMatch(/\/v1\/profiles\/Account\/cust-1$/);
    expect((profileInit.headers as Record<string, string>).authorization).toBe(`sso-jwt ${FAKE_TOKEN}`);
    expect((profileInit.headers as Record<string, string>)['X-App-Key']).toBe('airo-app-builder');

    const [caseUrl, caseInit] = calls[1] as [string, RequestInit];
    expect(caseUrl).toMatch(/\/api\/case-management\/v1\/case$/);
    expect((caseInit.headers as Record<string, string>).authorization).toBe(`sso-jwt ${FAKE_TOKEN}`);
    const sentBody = JSON.parse(caseInit.body as string);
    expect(sentBody.shopperId).toBe('shop-1');
    expect(sentBody.primaryCategory).toBe('Websites');
    expect(sentBody.additionalData.severity).toBe('S2');
    // Locks formatPhone end-to-end: profile { code: '1', number: '5551234' }
    // must serialize to digits-only '15551234' on the CRM body. Reverting to
    // '+1-5551234' would now fail this assertion.
    expect(sentBody.contactPhone).toBe('15551234');

    expect(result).toEqual({ caseId: 'case-xyz', caseNumber: '000123' });
  });

  it('throws with status in message when CRM returns non-2xx', async () => {
    mockFetchSequence(
      {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phoneNumbers: [] }),
      },
      { ok: false, status: 500, text: async () => 'CRM down' },
    );
    await expect(openCrmCase(INPUT)).rejects.toThrow(/CRM case request failed \(500\)/);
  });

  it('omits contactPhone when profile has empty phoneNumbers', async () => {
    mockFetchSequence(
      {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phoneNumbers: [] }),
      },
      { ok: true, status: 200, text: async () => '{}' },
    );
    await openCrmCase(INPUT);
    const [, caseInit] = vi.mocked(global.fetch).mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(caseInit.body as string);
    expect(body.contactPhone).toBeUndefined();
  });

  it('throws when profile fetch fails', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'not found',
    } as Response);
    await expect(openCrmCase(INPUT)).rejects.toThrow(/Profile API request failed \(404\)/);
  });

  // 2xx with malformed/empty body — do not throw (the case may have been
  // filed), but emit a distinct warn so the lack of caseId is auditable.
  it('returns empty result and logs parse_failed when CRM returns 2xx with non-JSON body', async () => {
    const { logger } = await import('@/lib/request-context');
    mockFetchSequence(
      {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phoneNumbers: [] }),
      },
      { ok: true, status: 200, text: async () => '<html>broken proxy</html>' },
    );
    const result = await openCrmCase(INPUT);
    expect(result).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(
      'feedback.crm.case-client.post.parse_failed',
      expect.objectContaining({ status: 200 }),
    );
  });

});
