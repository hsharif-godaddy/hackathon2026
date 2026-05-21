import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getTokenMock = vi.fn();

vi.mock('../airo-cert-token', () => ({
  airoCertTokenService: {
    getToken: () => getTokenMock(),
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_BASE = process.env.CRM_API_BASE;

describe('addCrmCaseNote', () => {
  beforeEach(() => {
    process.env.CRM_API_BASE = 'https://crm.example.com';
    getTokenMock.mockReset().mockResolvedValue('jwt-abc');
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_BASE == null) delete process.env.CRM_API_BASE;
    else process.env.CRM_API_BASE = ORIGINAL_BASE;
  });

  it('uses caseExternalId for an async referenceId-shaped caseId', async () => {
    let captured: { url: string; init: any } | undefined;
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      captured = { url, init };
      return new Response('', { status: 200 });
    }) as any;
    const { addCrmCaseNote } = await import('../case-note-client');
    await addCrmCaseNote({ caseId: 'airo-app123-1700000000000', note: 'hello' });
    expect(captured?.url).toBe('https://crm.example.com/api/case-management/v1/case/note');
    expect(captured?.init.method).toBe('POST');
    expect(captured?.init.headers.authorization).toBe('sso-jwt jwt-abc');
    const body = JSON.parse(captured!.init.body);
    expect(body.caseExternalId).toBe('airo-app123-1700000000000');
    expect(body.caseRecordId).toBeUndefined();
    expect(body.noteType).toBe('Status Change');
    expect(body.noteTypeDetails).toBe('Escalation');
    expect(body.note).toBe('hello');
  });

  it('uses caseRecordId for a Salesforce 15-char Case ID', async () => {
    let captured: { init: any } | undefined;
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      captured = { init };
      return new Response('', { status: 200 });
    }) as any;
    const { addCrmCaseNote } = await import('../case-note-client');
    await addCrmCaseNote({ caseId: '5001A00000abcdE', note: 'sf-id branch' });
    const body = JSON.parse(captured!.init.body);
    expect(body.caseRecordId).toBe('5001A00000abcdE');
    expect(body.caseExternalId).toBeUndefined();
  });

  it('uses caseRecordId for a Salesforce 18-char Case ID (with checksum)', async () => {
    // SF_CASE_ID_PATTERN accepts both 15-char (raw) and 18-char (with
    // 3-char checksum suffix) IDs. Without explicit coverage a regression
    // that drops 18-char support would silently route real Salesforce
    // IDs through the externalId branch and CMAPI would fail to find
    // them (review S-7).
    let captured: { init: any } | undefined;
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      captured = { init };
      return new Response('', { status: 200 });
    }) as any;
    const { addCrmCaseNote } = await import('../case-note-client');
    await addCrmCaseNote({ caseId: '5001A00000abcdEAAQ', note: 'sf-18char' });
    const body = JSON.parse(captured!.init.body);
    expect(body.caseRecordId).toBe('5001A00000abcdEAAQ');
    expect(body.caseExternalId).toBeUndefined();
  });

  it('throws on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;
    const { addCrmCaseNote } = await import('../case-note-client');
    await expect(
      addCrmCaseNote({ caseId: 'x', note: 'n' }),
    ).rejects.toThrow(/CRM caseNote POST failed \(500\)/);
  });
});
