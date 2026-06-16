import { describe, expect, it, vi } from 'vitest';

import {
  extractRoutePageSignals,
  recommendAeoSchemaTypes,
} from '../aeo-schema-recommendations.js';

vi.mock('@airo/ai-lib', () => ({
  generateTextWithTracking: vi.fn(),
}));

vi.mock('../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({ model: {}, modelName: 'test-model' }),
}));

const { generateTextWithTracking } = await import('@airo/ai-lib');

describe('extractRoutePageSignals', () => {
  it('extracts title, h1, and existing schema types from HTML', function extractSignals() {
    const html = `<!doctype html><html><head><title>About Us</title></head><body>
      <h1>Our Story</h1>
      <script type="application/ld+json">{"@type":"WebPage","name":"About"}</script>
    </body></html>`;

    expect(extractRoutePageSignals(html, '/about')).toEqual({
      path: '/about',
      title: 'About Us',
      h1: 'Our Story',
      existingTypes: ['WebPage'],
    });
  });
});

describe('recommendAeoSchemaTypes', () => {
  it('parses batched LLM recommendations for known routes', async function parseRecommendations() {
    vi.mocked(generateTextWithTracking).mockResolvedValue({
      text: JSON.stringify({
        routes: [
          { path: '/', types: ['WebSite', 'Organization'], fields: ['name', 'url'] },
          { path: '/about', types: ['AboutPage'], fields: ['name'] },
        ],
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
      modelName: 'test-model',
    });

    const result = await recommendAeoSchemaTypes({
      routes: [
        { path: '/', title: 'Home' },
        { path: '/about', title: 'About' },
      ],
      executionContext: {
        metadata: { appId: 'app-1', subscriptionId: 'sub-1' },
      },
    });

    expect(result).toEqual({
      '/': { types: ['WebSite', 'Organization'], fields: ['name', 'url'] },
      '/about': { types: ['AboutPage'], fields: ['name'] },
    });
  });

  it('returns null when LLM output is invalid', async function invalidOutput() {
    vi.mocked(generateTextWithTracking).mockResolvedValue({
      text: 'not json',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
      modelName: 'test-model',
    });

    const result = await recommendAeoSchemaTypes({
      routes: [{ path: '/', title: 'Home' }],
      executionContext: { metadata: { appId: 'app-1' } },
    });

    expect(result).toBeNull();
  });
});
