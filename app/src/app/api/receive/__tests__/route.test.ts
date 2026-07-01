/**
 * @vitest-environment jsdom
 *
 * Tests for GET /api/receive — the cross-origin bridge used by ai-prompt-lib to
 * store uploaded files in IndexedDB and localStorage on the airo-builder origin.
 *
 * Structure:
 *   1. Route handler — authentication, Content-Type, HTML shape, OPTIONS CORS.
 *   2. Bridge script — origin allow-listing, message validation, localStorage
 *      writes, IndexedDB puts, and store-files-ack replies.
 *   3. Bridge script parity — hardcoded constants match the TypeScript sources.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiPromptLibOrigins } from '@/lib/cors';
import { UPLOAD_DB_NAME, UPLOAD_STORE } from '@/lib/quick-create';

// ─── mock customer-auth ────────────────────────────────────────────────────
const { mockAuthenticateCustomer } = vi.hoisted(() => ({
  mockAuthenticateCustomer: vi.fn(),
}));

vi.mock('@/lib/customer-auth', async () => {
  const actual = await vi.importActual('@/lib/customer-auth');
  return {
    ...actual,
    withCustomerAuth: vi.fn((handler: (...args: unknown[]) => unknown) =>
      async (request: NextRequest) => {
        const ctx = await mockAuthenticateCustomer(request);
        if (!ctx.isAuthenticated) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return handler(request, ctx);
      }
    ),
  };
});

import { GET, OPTIONS } from '../route';

// ─── shared constants ──────────────────────────────────────────────────────
const ALLOWED_ORIGIN = 'https://www.godaddy.com';
const BLOCKED_ORIGIN = 'https://evil.example.com';

const AUTH_CONTEXT = {
  isAuthenticated: true,
  user: { shopperId: 's-1', customerId: 'c-1', accountId: 'a-1', authType: 'basic', isE2S: false },
  jwt: 'test-jwt',
};

function makeGetRequest(origin?: string): NextRequest {
  return new NextRequest('https://airo.test-godaddy.com/api/receive', {
    method: 'GET',
    headers: origin ? { origin } : {},
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 1. ROUTE HANDLER
// ──────────────────────────────────────────────────────────────────────────

describe('GET /api/receive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateCustomer.mockResolvedValue(AUTH_CONTEXT);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthenticateCustomer.mockResolvedValue({ isAuthenticated: false });
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it('returns 200 when authenticated', async () => {
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
  });

  it('sets Content-Type to text/html', async () => {
    const res = await GET(makeGetRequest());
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('references the external bridge script', async () => {
    const res = await GET(makeGetRequest());
    expect(await res.text()).toContain('<script src="/scripts/receive-bridge.js">');
  });

  it('includes a status:up JSON blob in the body', async () => {
    const res = await GET(makeGetRequest());
    expect(await res.text()).toContain('"status": "up"');
  });

  it('includes an ISO timestamp in the status blob', async () => {
    const res = await GET(makeGetRequest());
    expect(await res.text()).toMatch(/"timestamp": "\d{4}-\d{2}-\d{2}T/);
  });
});

describe('OPTIONS /api/receive', () => {
  it('returns 204 with CORS headers for an allowed origin', async () => {
    const req = new NextRequest('https://airo.test-godaddy.com/api/receive', {
      method: 'OPTIONS',
      headers: { origin: ALLOWED_ORIGIN },
    });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('returns 204 without CORS headers for a blocked origin', async () => {
    const req = new NextRequest('https://airo.test-godaddy.com/api/receive', {
      method: 'OPTIONS',
      headers: { origin: BLOCKED_ORIGIN },
    });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. BRIDGE SCRIPT (public/scripts/receive-bridge.js)
// ──────────────────────────────────────────────────────────────────────────

/** Drain the microtask queue completely, resilient to Promise-chain depth changes. */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/**
 * Minimal fake IndexedDB. Getters/setters capture callbacks so flush() can
 * fire them synchronously after a microtask tick — bridging the Promise chain
 * without needing real async IDB infrastructure.
 */
function makeFakeIdb() {
  const store = { put: vi.fn() };
  let txOnComplete: (() => void) | null = null;
  let txOnError: (() => void) | null = null;
  let openOnSuccess: (() => void) | null = null;
  let openOnError: (() => void) | null = null;

  const txObj = {
    get oncomplete(): (() => void) | null { return txOnComplete; },
    set oncomplete(fn: (() => void) | null) { txOnComplete = fn; },
    get onerror(): (() => void) | null { return txOnError; },
    set onerror(fn: (() => void) | null) { txOnError = fn; },
    error: new DOMException('Transaction failed'),
    objectStore: vi.fn().mockReturnValue(store),
  };
  const db = { close: vi.fn(), transaction: vi.fn().mockReturnValue(txObj) };
  const openReq = {
    result: db,
    error: new DOMException('IDB open failed'),
    onupgradeneeded: null as (() => void) | null,
    get onsuccess(): (() => void) | null { return openOnSuccess; },
    set onsuccess(fn: (() => void) | null) { openOnSuccess = fn; },
    get onerror(): (() => void) | null { return openOnError; },
    set onerror(fn: (() => void) | null) { openOnError = fn; },
  };

  return {
    idb: { open: vi.fn().mockReturnValue(openReq) },
    /** Fire open-success + transaction-complete, then drain the full Promise chain. */
    async flush() {
      openOnSuccess?.();
      await Promise.resolve(); // let .then(cb) run so txOnComplete is wired
      txOnComplete?.();
      await drainMicrotasks();
    },
    /** Simulate indexedDB.open() failure; drain so .catch() fires before caller resumes. */
    async flushOpenError() {
      openOnError?.();
      await drainMicrotasks();
    },
    /** Simulate transaction failure after open; drain so .catch() fires before caller resumes. */
    async flushTxError() {
      openOnSuccess?.();
      await Promise.resolve(); // let .then(cb) run so txOnError is wired
      txOnError?.();
      await drainMicrotasks();
    },
    store,
    db,
    openReq,
  };
}

/** Build a MessageEvent whose source has a postMessage spy. */
function makeMessageEvent(data: unknown, origin: string) {
  const sourceSpy = { postMessage: vi.fn() };
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: sourceSpy, configurable: true });
  return { event, sourceSpy };
}

describe('bridge script (public/scripts/receive-bridge.js)', () => {
  let scriptSource: string;
  let handleMessage: (event: MessageEvent) => void;
  let fakeIdb: ReturnType<typeof makeFakeIdb>;

  beforeAll(async () => {
    scriptSource = await readFile(join(process.cwd(), 'public/scripts/receive-bridge.js'), 'utf8');
  });

  beforeEach(() => {
    localStorage.clear();

    fakeIdb = makeFakeIdb();
    Object.defineProperty(window, 'indexedDB', {
      value: fakeIdb.idb,
      configurable: true,
      writable: true,
    });

    // Intercept addEventListener so each test gets an isolated handler without
    // accumulating message listeners on window across beforeEach calls.
    const spy = vi.spyOn(window, 'addEventListener').mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'message') handleMessage = listener as (e: MessageEvent) => void;
      },
    );
    // eslint-disable-next-line no-eval
    eval(scriptSource);
    spy.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('origin allow-list', () => {
    it('contains every aiPromptLibOrigin in ALLOWED', () => {
      for (const origin of aiPromptLibOrigins) {
        expect(scriptSource).toContain(origin);
      }
    });

    it('ignores messages from a non-allowed origin', () => {
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 'site-1', files: [] } },
        BLOCKED_ORIGIN,
      );
      handleMessage(event);
      expect(localStorage.getItem('in-creation-flow-site-1')).toBeNull();
      expect(localStorage.getItem('initial-prompt-pending-site-1')).toBeNull();
      expect(localStorage.getItem('initial-upload-files-site-1')).toBeNull();
      expect(fakeIdb.idb.open).not.toHaveBeenCalled();
    });

    it('processes messages from every aiPromptLibOrigin', () => {
      for (const origin of aiPromptLibOrigins) {
        localStorage.clear();
        const { event } = makeMessageEvent(
          { type: 'store-files', data: { siteId: 'probe', files: [] } },
          origin,
        );
        handleMessage(event);
        expect(localStorage.getItem('in-creation-flow-probe')).toBe('true');
        expect(localStorage.getItem('initial-prompt-pending-probe')).toBe('true');
        expect(localStorage.getItem('initial-upload-files-probe')).toBe('[]');
      }
    });
  });

  describe('message shape validation', () => {
    it('ignores null data', () => {
      const { event } = makeMessageEvent(null, ALLOWED_ORIGIN);
      handleMessage(event);
      expect(fakeIdb.idb.open).not.toHaveBeenCalled();
    });

    it('ignores non-object data (string)', () => {
      const { event } = makeMessageEvent('store-files', ALLOWED_ORIGIN);
      handleMessage(event);
      expect(fakeIdb.idb.open).not.toHaveBeenCalled();
    });

    it('ignores object with non-string type field', () => {
      const { event } = makeMessageEvent({ type: 42, data: {} }, ALLOWED_ORIGIN);
      handleMessage(event);
      expect(fakeIdb.idb.open).not.toHaveBeenCalled();
    });

    it('ignores unknown message types', () => {
      const { event } = makeMessageEvent({ type: 'unknown-action' }, ALLOWED_ORIGIN);
      handleMessage(event);
      expect(fakeIdb.idb.open).not.toHaveBeenCalled();
    });

    it('ignores store-files message when d.data is absent', () => {
      const { event } = makeMessageEvent({ type: 'store-files' }, ALLOWED_ORIGIN);
      handleMessage(event);
      expect(fakeIdb.idb.open).not.toHaveBeenCalled();
      expect(localStorage.getItem('initial-upload-files-undefined')).toBeNull();
    });

    it('ignores store-files message when d.data.files is not an array', () => {
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 's-1', files: 'not-an-array' } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);
      expect(fakeIdb.idb.open).not.toHaveBeenCalled();
    });

    it('ignores store-files message when d.data.siteId is not a string', () => {
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 42, files: [] } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);
      expect(fakeIdb.idb.open).not.toHaveBeenCalled();
    });
  });

  describe('store-files: localStorage write', () => {
    it('writes all three localStorage keys for the siteId', () => {
      const files = [{ raw: new ArrayBuffer(8), fileName: 'photo.png', isDesignMd: false, isImage: true }];
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 'site-42', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);

      expect(localStorage.getItem('in-creation-flow-site-42')).toBe('true');
      expect(localStorage.getItem('initial-prompt-pending-site-42')).toBe('true');
      const stored = JSON.parse(localStorage.getItem('initial-upload-files-site-42')!);
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('photo.png');
      expect(stored[0].isImage).toBe(true);
    });

    it('maps fileName to name and omits raw from stored JSON', () => {
      const files = [{ raw: new ArrayBuffer(4), fileName: 'logo.svg', isDesignMd: true }];
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 'site-1', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);

      const stored = JSON.parse(localStorage.getItem('initial-upload-files-site-1')!);
      expect(stored[0]).toEqual({ name: 'logo.svg', isDesignMd: true });
      expect('raw' in stored[0]).toBe(false);
      expect('fileName' in stored[0]).toBe(false);
    });

    it('stores multiple files preserving all extra metadata fields', () => {
      const files = [
        { raw: new ArrayBuffer(4), fileName: 'a.zip', isDesignMd: false, isZip: true },
        { raw: new ArrayBuffer(4), fileName: 'b.png', isDesignMd: false, isImage: true },
      ];
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 'site-1', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);

      const stored = JSON.parse(localStorage.getItem('initial-upload-files-site-1')!);
      expect(stored).toHaveLength(2);
      expect(stored[0]).toEqual({ name: 'a.zip', isDesignMd: false, isZip: true });
      expect(stored[1]).toEqual({ name: 'b.png', isDesignMd: false, isImage: true });
    });

    it('filters out items missing fileName so name: undefined is never written', () => {
      const files = [
        { raw: new ArrayBuffer(4), fileName: 'good.png', isDesignMd: false },
        { raw: new ArrayBuffer(4), isDesignMd: false }, // no fileName
      ];
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 'site-1', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);

      const stored = JSON.parse(localStorage.getItem('initial-upload-files-site-1')!);
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('good.png');
    });

    it('sends store-files-ack with error and skips IDB on localStorage failure', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw new Error('QuotaExceededError');
      });

      const files = [{ raw: new ArrayBuffer(4), fileName: 'a.png', isDesignMd: false }];
      const { event, sourceSpy } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 'site-err', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to store uploaded files metadata in localStorage',
        expect.objectContaining({ siteId: 'site-err' }),
      );
      expect(sourceSpy.postMessage).toHaveBeenCalledWith(
        { type: 'store-files-ack', error: 'localStorage' },
        ALLOWED_ORIGIN,
      );
      expect(fakeIdb.idb.open).not.toHaveBeenCalled();
    });
  });

  describe('store-files: IndexedDB write', () => {
    it('opens IndexedDB with database name "airo-file-uploads" at version 1', async () => {
      const files = [{ raw: new ArrayBuffer(4), fileName: 'f.png', isDesignMd: false }];
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 's-1', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);
      await fakeIdb.flush();

      expect(fakeIdb.idb.open).toHaveBeenCalledWith('airo-file-uploads', 1);
    });

    it('puts files into the "files" object store keyed by siteId', async () => {
      const files = [{ raw: new ArrayBuffer(4), fileName: 'f.png', isDesignMd: false }];
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 's-1', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);
      await fakeIdb.flush();

      expect(fakeIdb.db.transaction).toHaveBeenCalledWith('files', 'readwrite');
      expect(fakeIdb.store.put).toHaveBeenCalledWith({ files }, 's-1');
    });

    it('skips IndexedDB entirely when files array is empty', () => {
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 's-1', files: [] } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);

      expect(fakeIdb.idb.open).not.toHaveBeenCalled();
    });

    it('creates the object store on onupgradeneeded', () => {
      const createObjectStore = vi.fn();
      Object.defineProperty(fakeIdb.openReq, 'result', {
        value: { createObjectStore },
        configurable: true,
      });

      const files = [{ raw: new ArrayBuffer(4), fileName: 'f.png', isDesignMd: false }];
      const { event } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 's-1', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);
      fakeIdb.openReq.onupgradeneeded?.();

      expect(createObjectStore).toHaveBeenCalledWith('files');
    });
  });

  describe('store-files: store-files-ack reply', () => {
    it('sends store-files-ack to event.source after IndexedDB write completes', async () => {
      const files = [{ raw: new ArrayBuffer(4), fileName: 'f.png', isDesignMd: false }];
      const { event, sourceSpy } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 's-1', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);
      // ack must not be sent before the IDB transaction completes
      expect(sourceSpy.postMessage).not.toHaveBeenCalled();

      await fakeIdb.flush();

      expect(sourceSpy.postMessage).toHaveBeenCalledWith(
        { type: 'store-files-ack' },
        ALLOWED_ORIGIN,
      );
    });

    it('sends ack immediately for empty files array (storeFiles returns Promise.resolve())', async () => {
      const { event, sourceSpy } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 's-1', files: [] } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);
      await Promise.resolve();

      expect(sourceSpy.postMessage).toHaveBeenCalledWith(
        { type: 'store-files-ack' },
        ALLOWED_ORIGIN,
      );
    });

    it('does not throw when event.source is null (optional chaining guard)', async () => {
      const files = [{ raw: new ArrayBuffer(4), fileName: 'f.png', isDesignMd: false }];
      // Default MessageEvent has source=null in jsdom
      const event = new MessageEvent('message', {
        data: { type: 'store-files', data: { siteId: 's-1', files } },
        origin: ALLOWED_ORIGIN,
      });
      handleMessage(event);
      await fakeIdb.flush();
      // Reaching here without throwing confirms event.source?.postMessage handles null
    });
  });

  describe('store-files: IndexedDB error handling', () => {
    it('logs error, rolls back localStorage, and sends error ack when IndexedDB open fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const files = [{ raw: new ArrayBuffer(4), fileName: 'f.png', isDesignMd: false }];
      const { event, sourceSpy } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 's-1', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);

      await fakeIdb.flushOpenError();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to store uploaded files in IndexedDB',
        expect.objectContaining({ siteId: 's-1' }),
      );
      expect(sourceSpy.postMessage).toHaveBeenCalledWith(
        { type: 'store-files-ack', error: 'indexedDB' },
        ALLOWED_ORIGIN,
      );
      expect(localStorage.getItem('in-creation-flow-s-1')).toBeNull();
      expect(localStorage.getItem('initial-prompt-pending-s-1')).toBeNull();
      expect(localStorage.getItem('initial-upload-files-s-1')).toBeNull();
    });

    it('logs error, rolls back localStorage, and sends error ack when IndexedDB transaction fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const files = [{ raw: new ArrayBuffer(4), fileName: 'f.png', isDesignMd: false }];
      const { event, sourceSpy } = makeMessageEvent(
        { type: 'store-files', data: { siteId: 's-1', files } },
        ALLOWED_ORIGIN,
      );
      handleMessage(event);

      await fakeIdb.flushTxError();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to store uploaded files in IndexedDB',
        expect.objectContaining({ siteId: 's-1' }),
      );
      expect(sourceSpy.postMessage).toHaveBeenCalledWith(
        { type: 'store-files-ack', error: 'indexedDB' },
        ALLOWED_ORIGIN,
      );
      expect(localStorage.getItem('in-creation-flow-s-1')).toBeNull();
      expect(localStorage.getItem('initial-prompt-pending-s-1')).toBeNull();
      expect(localStorage.getItem('initial-upload-files-s-1')).toBeNull();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. BRIDGE SCRIPT PARITY
// ──────────────────────────────────────────────────────────────────────────

describe('receive-bridge.js constant parity', () => {
  let bridge: string;

  beforeAll(async () => {
    bridge = await readFile(
      join(process.cwd(), 'public/scripts/receive-bridge.js'),
      'utf8',
    );
  });

  it('hardcodes UPLOAD_DB_NAME matching the TypeScript source', () => {
    expect(bridge).toContain(`UPLOAD_DB_NAME = '${UPLOAD_DB_NAME}'`);
  });

  it('hardcodes UPLOAD_STORE matching the TypeScript source', () => {
    expect(bridge).toContain(`UPLOAD_STORE = '${UPLOAD_STORE}'`);
  });

  it('hardcodes every aiPromptLibOrigins entry', () => {
    for (const origin of aiPromptLibOrigins) {
      expect(bridge).toContain(origin);
    }
  });
});
