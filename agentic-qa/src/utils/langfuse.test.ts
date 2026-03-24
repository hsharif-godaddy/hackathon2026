import assume from 'assume';
import { describe, it } from 'node:test';

import { aggregate, extractAppId } from './langfuse.js';

describe('langfuse', function packageTests() {
  describe('#aggregate', function aggregateTests() {
    it('should count only GENERATION observations as turns', function turns() {
      const metrics = aggregate([
        { id: '1', traceId: 't1', type: 'GENERATION', usage: { input: 100, output: 50 }, totalCost: 0.01, model: 'gpt-4' },
        { id: '2', traceId: 't1', type: 'SPAN', name: 'readFile' },
        { id: '3', traceId: 't1', type: 'EVENT', name: 'log' },
        { id: '4', traceId: 't1', type: 'GENERATION', usage: { input: 200, output: 75 }, totalCost: 0.02, model: 'gpt-4' },
      ]);

      assume(metrics.turns).equals(2);
      assume(metrics.inputTokens).equals(300);
      assume(metrics.outputTokens).equals(125);
      assume(metrics.totalTokens).equals(425);
    });

    it('should count only SPAN observations in toolCounts', function toolCounts() {
      const metrics = aggregate([
        { id: '1', traceId: 't1', type: 'SPAN', name: 'readFile' },
        { id: '2', traceId: 't1', type: 'SPAN', name: 'readFile' },
        { id: '3', traceId: 't1', type: 'SPAN', name: 'fontTheme' },
        { id: '4', traceId: 't1', type: 'EVENT', name: 'readFile' },
        { id: '5', traceId: 't1', type: 'GENERATION', name: 'readFile', usage: {}, totalCost: 0 },
      ]);

      assume(metrics.toolNames).deep.equals(['readFile', 'fontTheme']);
      assume(metrics.toolUsage).deep.equals([
        { name: 'readFile', count: 2 },
        { name: 'fontTheme', count: 1 },
      ]);
    });

    it('should count tool errors only from ERROR-level SPAN observations', function toolErrors() {
      const metrics = aggregate([
        { id: '1', traceId: 't1', type: 'SPAN', name: 'readFile', level: 'ERROR', statusMessage: 'file not found' },
        { id: '2', traceId: 't1', type: 'SPAN', name: 'fontTheme', level: 'DEFAULT' },
        { id: '3', traceId: 't1', type: 'GENERATION', level: 'ERROR', usage: {}, totalCost: 0 },
        { id: '4', traceId: 't1', type: 'SPAN', name: 'media', level: 'ERROR', statusMessage: 'timeout' },
      ]);

      assume(metrics.toolErrorCount).equals(2);
      assume(metrics.toolFailedNames).deep.equals(['readFile', 'media']);
      assume(metrics.toolErrors).deep.equals(['file not found', 'timeout']);
    });

    it('should not include SPAN errors without name in toolFailedNames', function namelessError() {
      const metrics = aggregate([
        { id: '1', traceId: 't1', type: 'SPAN', level: 'ERROR', statusMessage: 'unknown error' },
      ]);

      assume(metrics.toolErrorCount).equals(1);
      assume(metrics.toolFailedNames).deep.equals([]);
      assume(metrics.toolErrors).deep.equals(['unknown error']);
    });

    it('should collect unique models from GENERATION observations', function models() {
      const metrics = aggregate([
        { id: '1', traceId: 't1', type: 'GENERATION', model: 'claude-sonnet-4-5', usage: { input: 10 }, totalCost: 0 },
        { id: '2', traceId: 't1', type: 'GENERATION', model: 'claude-sonnet-4-5', usage: { input: 20 }, totalCost: 0 },
        { id: '3', traceId: 't1', type: 'GENERATION', model: 'gpt-4', usage: { input: 30 }, totalCost: 0 },
      ]);

      assume(metrics.models).length(2);
      assume(metrics.models).includes('claude-sonnet-4-5');
      assume(metrics.models).includes('gpt-4');
    });

    it('should round totalCostUSD to 4 decimal places', function costRounding() {
      const metrics = aggregate([
        { id: '1', traceId: 't1', type: 'GENERATION', usage: {}, totalCost: 0.00123456 },
        { id: '2', traceId: 't1', type: 'GENERATION', usage: {}, totalCost: 0.00876544 },
      ]);

      assume(metrics.totalCostUSD).equals(0.01);
    });

    it('should return zero metrics for empty observations', function empty() {
      const metrics = aggregate([]);

      assume(metrics.turns).equals(0);
      assume(metrics.inputTokens).equals(0);
      assume(metrics.outputTokens).equals(0);
      assume(metrics.totalTokens).equals(0);
      assume(metrics.totalCostUSD).equals(0);
      assume(metrics.models).deep.equals([]);
      assume(metrics.toolNames).deep.equals([]);
      assume(metrics.toolErrorCount).equals(0);
      assume(metrics.toolFailedNames).deep.equals([]);
      assume(metrics.toolErrors).deep.equals([]);
      assume(metrics.toolUsage).deep.equals([]);
    });

    it('should handle GENERATION with missing usage fields', function missingUsage() {
      const metrics = aggregate([
        { id: '1', traceId: 't1', type: 'GENERATION', usage: {}, totalCost: 0 },
        { id: '2', traceId: 't1', type: 'GENERATION', totalCost: 0.05 },
      ]);

      assume(metrics.turns).equals(2);
      assume(metrics.inputTokens).equals(0);
      assume(metrics.outputTokens).equals(0);
      assume(metrics.totalCostUSD).equals(0.05);
    });

    it('should sort toolUsage by count descending', function sortOrder() {
      const metrics = aggregate([
        { id: '1', traceId: 't1', type: 'SPAN', name: 'alpha' },
        { id: '2', traceId: 't1', type: 'SPAN', name: 'beta' },
        { id: '3', traceId: 't1', type: 'SPAN', name: 'beta' },
        { id: '4', traceId: 't1', type: 'SPAN', name: 'beta' },
        { id: '5', traceId: 't1', type: 'SPAN', name: 'alpha' },
      ]);

      assume(metrics.toolUsage[0].name).equals('beta');
      assume(metrics.toolUsage[0].count).equals(3);
      assume(metrics.toolUsage[1].name).equals('alpha');
      assume(metrics.toolUsage[1].count).equals(2);
    });
  });

  describe('#extractAppId', function extractAppIdTests() {
    it('should extract appId from standard preview URL', function standard() {
      assume(extractAppId('https://mqojn3keta.preview.c37.airoapp.ai/')).equals('mqojn3keta');
    });

    it('should extract appId from preview URL without trailing slash', function noSlash() {
      assume(extractAppId('https://mqojn3keta.preview.c37.airoapp.ai')).equals('mqojn3keta');
    });

    it('should extract appId from preview URL with path', function withPath() {
      assume(extractAppId('https://abc123.preview.c38.airoapp.ai/about')).equals('abc123');
    });

    it('should extract appId from preview URL with query params', function withQuery() {
      assume(extractAppId('https://xyz789.preview.c37.airoapp.ai/?page=1')).equals('xyz789');
    });

    it('should extract appId with different cluster identifiers', function clusters() {
      assume(extractAppId('https://app1.preview.c38.airoapp.ai/')).equals('app1');
      assume(extractAppId('https://app2.preview.us1.airoapp.ai/')).equals('app2');
    });

    it('should return null for develop page URL', function developUrl() {
      assume(extractAppId('https://airo.example.com/develop/7671muk')).equals(null);
    });

    it('should return null for non-preview airoapp URL', function nonPreview() {
      assume(extractAppId('https://airo.airoapp.ai/')).equals(null);
    });

    it('should return null for localhost URL', function localhost() {
      assume(extractAppId('http://localhost:3000/develop/abc123')).equals(null);
    });

    it('should return null for empty string', function empty() {
      assume(extractAppId('')).equals(null);
    });

    it('should return null for non-airoapp preview domain', function wrongDomain() {
      assume(extractAppId('https://abc123.preview.c37.example.com/')).equals(null);
    });
  });
});
