import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';

export function makeGocodeClient(): IGocodeClient {
  const mock: IGocodeClient = {
    complete: async () => '',
    getModel: () => 'claude-sonnet-4-6',
    getAccumulatedUsage: () => ({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      calls: 0,
    }),
    resetAccumulatedUsage: () => {},
  };
  return mock;
}

export function makeCtrlPlaneClient(): AABCtrlPlaneClient {
  const mock: Pick<AABCtrlPlaneClient, 'provisionApp' | 'deleteApp'> = {
    provisionApp: async () => ({
      appId: 'test-app',
      previewUrl: 'http://test',
    }),
    deleteApp: async () => {},
  };
  return mock as unknown as AABCtrlPlaneClient;
}
