import { describe, it, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';

let mintTokenImpl;

mock.module('./cert-loader.mjs', {
  namedExports: {
    loadCrmCert: async () => ({ cert: 'C', key: 'K' }),
  },
});

mock.module('./crm-token.mjs', {
  namedExports: {
    mintCrmSsoJwt: async () => mintTokenImpl(),
  },
});

const originalFetch = globalThis.fetch;
const { addCrmCaseNote, patchCrmCaseNote } = await import('./crm-casenote.mjs');

describe('addCrmCaseNote (legacy alias: patchCrmCaseNote)', () => {
  it('legacy alias points at the same implementation', () => {
    assert.equal(patchCrmCaseNote, addCrmCaseNote);
  });

  beforeEach(() => {
    process.env.CRM_API_BASE = 'https://crm.example.com';
    mintTokenImpl = async () => 'jwt-abc';
    globalThis.fetch = async (url, init) => ({
      ok: true,
      status: 200,
      text: async () => '',
      url,
      init,
    });
  });

  after(() => { globalThis.fetch = originalFetch; });

  it('POSTs to /v1/case/note with caseExternalId for non-Salesforce caseId', async () => {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, text: async () => '' };
    };
    await addCrmCaseNote({
      caseId: 'airo-app123-1700000000000',
      summary: 'Root cause: foo',
      reportUrl: 'https://debug.console/investigate?appId=app123',
    });
    // Endpoint moved from PATCH /case/{id} (which never existed in CMAPI)
    // to POST /v1/case/note. CMAPI accepts caseRecordId (SF ID) or
    // caseExternalId (referenceId / externalSystemId from async create);
    // the caseId here is the async referenceId so we expect caseExternalId.
    assert.equal(captured.url, 'https://crm.example.com/api/case-management/v1/case/note');
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.headers.authorization, 'sso-jwt jwt-abc');
    const body = JSON.parse(captured.init.body);
    assert.equal(body.caseExternalId, 'airo-app123-1700000000000');
    assert.equal(body.caseRecordId, undefined);
    assert.equal(body.noteType, 'Status Change');
    assert.equal(body.noteTypeDetails, 'Escalation');
    assert.equal(
      body.note,
      'AI Investigation: Root cause: foo. Full report: https://debug.console/investigate?appId=app123',
    );
  });

  it('uses caseRecordId for a Salesforce 15-char Case ID', async () => {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, text: async () => '' };
    };
    // SF Case object IDs start with the "500" prefix; test the 15-char form.
    await addCrmCaseNote({
      caseId: '5001A00000abcdE',
      summary: 's',
      reportUrl: 'u',
    });
    const body = JSON.parse(captured.init.body);
    assert.equal(body.caseRecordId, '5001A00000abcdE');
    assert.equal(body.caseExternalId, undefined);
  });

  it('throws on non-2xx', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    await assert.rejects(
      addCrmCaseNote({ caseId: 'c', summary: 's', reportUrl: 'u' }),
      /CRM caseNote POST failed \(500\)/,
    );
  });

  it('throws when CRM_API_BASE missing', async () => {
    delete process.env.CRM_API_BASE;
    await assert.rejects(
      addCrmCaseNote({ caseId: 'c', summary: 's', reportUrl: 'u' }),
      /CRM_API_BASE/,
    );
  });
});
