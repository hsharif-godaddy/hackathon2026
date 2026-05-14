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
import { buildCaseBody, type OpenCaseInput,openCrmCase } from '../case-client';
import type { CustomerProfile } from '../profile-client';

const FAKE_TOKEN = 'fake-sso-jwt';

const INPUT: OpenCaseInput = {
  customerId: 'cust-1',
  shopperId: 'shop-1',
  description: 'my site is not working',
  followUp: true,
  appId: 'app-123',
};

const PROFILE: CustomerProfile = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '+1-5551234',
};

describe('buildCaseBody', () => {
  it('populates contact, category, severity S2, and additionalData', () => {
    const body = buildCaseBody(INPUT, PROFILE);
    expect(body.contactName).toBe('Jane Doe');
    expect(body.contactFirstName).toBe('Jane');
    expect(body.contactLastName).toBe('Doe');
    expect(body.contactEmail).toBe('jane@example.com');
    expect(body.contactPhone).toBe('+1-5551234');
    expect(body.shopperId).toBe('shop-1');
    expect(body.primaryCategory).toBe('Websites');
    expect(body.secondaryCategory).toBe('Airo AI Builder');
    expect(body.issue).toBe('General Support');
    expect(body.recordType).toBe('standard');
    expect(body.additionalData.severity).toBe('S2');
    expect(body.additionalData.followUpConsent).toBe('TRUE');
    expect(body.additionalData.appId).toBe('app-123');
    expect(body.additionalData['Escalation Details']).toBe('my site is not working');
    expect(body.caseNotes[0]?.note).toContain('my site is not working');
  });

  it('omits contactPhone when profile phone is null', () => {
    const body = buildCaseBody(INPUT, { ...PROFILE, phone: null });
    expect(body.contactPhone).toBeUndefined();
  });

  it('omits appId when not provided', () => {
    const body = buildCaseBody({ ...INPUT, appId: null }, PROFILE);
    expect(body.additionalData.appId).toBeUndefined();
  });

  it('sets followUpConsent FALSE when followUp is false', () => {
    const body = buildCaseBody({ ...INPUT, followUp: false }, PROFILE);
    expect(body.additionalData.followUpConsent).toBe('FALSE');
  });

  it('truncates very long descriptions in caseNotes', () => {
    const longDesc = 'x'.repeat(5000);
    const body = buildCaseBody({ ...INPUT, description: longDesc }, PROFILE);
    expect(body.caseNotes[0]?.note.length).toBeLessThanOrEqual(4000 + 'Airo AI Builder : Customer reported : '.length);
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

  // The route accepts an unbounded description; CRM body must cap both
  // caseNotes and additionalData.Escalation Details so a multi-MB submission
  // can't reach CRM verbatim.
  it('truncates Escalation Details with the same MAX_NOTE_CHARS cap as caseNotes', () => {
    const longDesc = 'x'.repeat(5000);
    const body = buildCaseBody({ ...INPUT, description: longDesc }, PROFILE);
    expect(body.additionalData['Escalation Details'].length).toBeLessThanOrEqual(4000);
  });
});
