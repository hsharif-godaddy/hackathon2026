import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const view = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn());
const readText = vi.hoisted(() => vi.fn());
const createForWorkspace = vi.hoisted(() => vi.fn());
// Pass-through by default; the cross-tenant test overrides it to reject.
const validateAppOwnership = vi.hoisted(() =>
  vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
);

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace,
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership,
}));

vi.mock('../../../logging/index.js', () => {
  const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    log: { forApp: () => noopLogger },
    logger: noopLogger,
    Logger: { create: () => noopLogger },
  };
});

import complianceRouter from '../compliance.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/apps', complianceRouter);
  return app;
}

const FIELD_PAGE = `const markdown = \`Owner: <span data-field="businessName" data-editable="true">Acme Inc.</span>.\`;`;
const SECTION_PAGE =
  `const markdown = \`` +
  `<span data-section="children" data-section-when="true" data-hidden="true" style="display:none">yes</span>` +
  `<span data-section="children" data-section-when="false">no</span>` +
  `\`;`;

beforeEach(() => {
  view.mockReset();
  write.mockReset();
  createForWorkspace.mockReset();
  createForWorkspace.mockReturnValue({ files: { view, write, readText } });
  write.mockResolvedValue({ bytesWritten: 1 });
  // Default: ownership passes. Individual tests can override to simulate a
  // cross-tenant request.
  validateAppOwnership.mockImplementation((_req: unknown, _res: unknown, next: () => void) => next());
});

describe('tenant isolation', () => {
  it('rejects a cross-tenant request before touching the workspace (403)', async () => {
    // Simulate validateAppOwnership rejecting a mismatched site/app.
    validateAppOwnership.mockImplementation((_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(403).json({ error: 'Forbidden' });
    });
    await request(createTestApp())
      .post('/apps/app1234567/compliance/field')
      .send({ documentType: 'privacy-policy', fieldKey: 'businessName', newValue: 'Beta LLC' })
      .expect(403);
    expect(view).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe('POST /apps/:id/compliance/field', () => {
  it('patches the page file and returns success', async () => {
    readText.mockResolvedValue(FIELD_PAGE);
    const res = await request(createTestApp())
      .post('/apps/app1234567/compliance/field')
      .send({ documentType: 'privacy-policy', fieldKey: 'businessName', newValue: 'Beta LLC' })
      .expect(200);
    expect(res.body).toEqual({ success: true, fieldKey: 'businessName', replaced: 1 });
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0].path).toBe('src/pages/privacy.tsx');
    expect(write.mock.calls[0][0].content).toContain('Beta LLC');
  });

  it('returns 400 for an unknown documentType', async () => {
    await request(createTestApp())
      .post('/apps/app1234567/compliance/field')
      .send({ documentType: 'nope', fieldKey: 'businessName', newValue: 'y' })
      .expect(400);
    expect(view).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid email value', async () => {
    await request(createTestApp())
      .post('/apps/app1234567/compliance/field')
      .send({ documentType: 'privacy-policy', fieldKey: 'email', newValue: 'bad' })
      .expect(400);
    expect(view).not.toHaveBeenCalled();
  });

  it('returns 409 when the field span is absent', async () => {
    readText.mockResolvedValue(`const markdown = \`no spans\`;`);
    await request(createTestApp())
      .post('/apps/app1234567/compliance/field')
      .send({ documentType: 'privacy-policy', fieldKey: 'businessName', newValue: 'Beta LLC' })
      .expect(409);
    expect(write).not.toHaveBeenCalled();
  });

  it('returns 404 when the workspace cannot be resolved', async () => {
    createForWorkspace.mockReturnValue(null);
    await request(createTestApp())
      .post('/apps/app1234567/compliance/field')
      .send({ documentType: 'terms-of-use', fieldKey: 'businessName', newValue: 'Beta LLC' })
      .expect(404);
  });

  it('returns 500 when the workspace write throws', async () => {
    readText.mockResolvedValue(FIELD_PAGE);
    write.mockRejectedValue(new Error('disk full'));
    await request(createTestApp())
      .post('/apps/app1234567/compliance/field')
      .send({ documentType: 'privacy-policy', fieldKey: 'businessName', newValue: 'Beta LLC' })
      .expect(500);
  });
});

describe('POST /apps/:id/compliance/section', () => {
  it('toggles the section and returns success', async () => {
    readText.mockResolvedValue(SECTION_PAGE);
    const res = await request(createTestApp())
      .post('/apps/app1234567/compliance/section')
      .send({ documentType: 'privacy-policy', sectionKey: 'children', value: true })
      .expect(200);
    expect(res.body).toEqual({ success: true, sectionKey: 'children', value: true });
    expect(write.mock.calls[0][0].content).toContain('data-section-when="true">yes</span>');
  });

  it('returns 400 when value is not a boolean', async () => {
    await request(createTestApp())
      .post('/apps/app1234567/compliance/section')
      .send({ documentType: 'privacy-policy', sectionKey: 'children', value: 'yes' })
      .expect(400);
    expect(view).not.toHaveBeenCalled();
  });

  it('returns 409 when the section is absent', async () => {
    readText.mockResolvedValue(`const markdown = \`no sections\`;`);
    await request(createTestApp())
      .post('/apps/app1234567/compliance/section')
      .send({ documentType: 'privacy-policy', sectionKey: 'children', value: false })
      .expect(409);
    expect(write).not.toHaveBeenCalled();
  });

  it('returns 404 when the workspace cannot be resolved', async () => {
    createForWorkspace.mockReturnValue(null);
    await request(createTestApp())
      .post('/apps/app1234567/compliance/section')
      .send({ documentType: 'terms-of-use', sectionKey: 'children', value: true })
      .expect(404);
  });

  it('returns 400 for an unknown documentType', async () => {
    await request(createTestApp())
      .post('/apps/app1234567/compliance/section')
      .send({ documentType: 'nope', sectionKey: 'children', value: true })
      .expect(400);
    expect(view).not.toHaveBeenCalled();
  });

  it('returns 500 when the workspace write throws', async () => {
    readText.mockResolvedValue(SECTION_PAGE);
    write.mockRejectedValue(new Error('disk full'));
    await request(createTestApp())
      .post('/apps/app1234567/compliance/section')
      .send({ documentType: 'privacy-policy', sectionKey: 'children', value: true })
      .expect(500);
  });
});
