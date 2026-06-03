import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetIamToken = vi.fn();
const mockClearIamTokenCache = vi.fn();

vi.mock('../../auth/iam.js', () => ({
  getIamToken: mockGetIamToken,
  clearIamTokenCache: mockClearIamTokenCache,
}));
vi.mock('../../config.js', () => ({
  config: { MESSAGING_BASE_URL: 'https://messaging.example.com' },
}));
vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { sendMessage } = await import('../../clients/messaging.js');

const REQUEST = {
  templateNamespaceKey: 'airo',
  templateTypeKey: 'welcome',
  substitutionValues: { name: 'Alice' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetIamToken.mockResolvedValue('iam-token');
  vi.stubGlobal('fetch', vi.fn());
});

function mockFetchResponse(status: number, body = ''): void {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(body, { status }),
  );
}

describe('notification-service', () => {
  describe('#sendMessage', () => {
    it('sends a POST and resolves on 2xx', async () => {
      mockFetchResponse(200);
      await expect(sendMessage('cust-1', REQUEST)).resolves.toBeUndefined();
      expect(fetch).toHaveBeenCalledOnce();
    });

    it('clears IAM cache and retries once on 401', async () => {
      mockFetchResponse(401);
      mockFetchResponse(200);

      await sendMessage('cust-1', REQUEST);

      expect(mockClearIamTokenCache).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('throws HttpError and does not retry a second 401', async () => {
      mockFetchResponse(401);
      mockFetchResponse(401);

      await expect(sendMessage('cust-1', REQUEST)).rejects.toMatchObject({
        name: 'HttpError',
        status: 401,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(mockClearIamTokenCache).toHaveBeenCalledTimes(1);
    });

    it('throws HttpError on non-401 error without retrying', async () => {
      mockFetchResponse(500, 'internal error');

      await expect(sendMessage('cust-1', REQUEST)).rejects.toMatchObject({
        name: 'HttpError',
        status: 500,
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(mockClearIamTokenCache).not.toHaveBeenCalled();
    });
  });
});
