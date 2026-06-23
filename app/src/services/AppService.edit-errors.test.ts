import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@airo/shared/chat', () => ({
  isRestoreMetadata: vi.fn(function isRestoreMetadata() { return false; }),
}));

const { agentFetch, buildDynamicApiUrl } = vi.hoisted(() => ({
  agentFetch: vi.fn(),
  buildDynamicApiUrl: vi.fn(),
}));

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicApiUrl,
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch,
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: { getState: () => ({}) },
}));

import { AppService } from './AppService';

describe('AppService edit errors', function editErrors() {
  beforeEach(function reset() {
    vi.clearAllMocks();
    buildDynamicApiUrl.mockImplementation(function url(path: string, appId: string) {
      return Promise.resolve(`https://agent.example.com/apps/${appId}/${path}`);
    });
  });

  it('surfaces text edit details from the agents route', async function textDetails() {
    agentFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'Failed to edit text',
        details: 'No element found with matching text content at line 47',
      }),
    });

    await expect(
      new AppService().updateText('app1234567', {
        selector: 'h1',
        oldText: 'Old',
        newText: 'New',
        devContext: { fileName: 'src/App.tsx', componentName: 'App', lineNumber: 47 },
      })
    ).rejects.toThrow('No element found with matching text content at line 47');
  });

  it('surfaces style edit details from the agents route', async function styleDetails() {
    agentFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: 'Failed to edit style',
        details: 'Element not found at line 18 in src/App.tsx',
      }),
    });

    await expect(
      new AppService().updateStyle('app1234567', {
        selector: 'h1',
        property: 'fontWeight',
        value: '700',
        newClassName: 'font-bold',
        elementInfo: {
          devContext: { fileName: 'src/App.tsx', componentName: 'App', lineNumber: 18 },
        },
      })
    ).rejects.toThrow('Element not found at line 18 in src/App.tsx');
  });

  it('uses the edit error when details are absent', async function errorOnly() {
    agentFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: 'Failed to edit text' }),
    });

    await expect(
      new AppService().updateText('app1234567', {
        selector: 'h1',
        oldText: 'Old',
        newText: 'New',
        devContext: { fileName: 'src/App.tsx', componentName: 'App', lineNumber: 47 },
      })
    ).rejects.toThrow('Failed to edit text');
  });

  it('falls back to status when the edit error body has no string message', async function fallback() {
    agentFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: vi.fn().mockResolvedValue({ error: { message: 'bad gateway' } }),
    });

    await expect(
      new AppService().updateText('app1234567', {
        selector: 'h1',
        oldText: 'Old',
        newText: 'New',
        devContext: { fileName: 'src/App.tsx', componentName: 'App', lineNumber: 47 },
      })
    ).rejects.toThrow('Failed to send text update to API: 502');
  });
});
