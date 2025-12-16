/**
 * Health Check Endpoint Tests
 *
 * Tests the /api/health endpoint to ensure proper health status reporting,
 * detailed metrics, and version information handling.
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

/**
 * Helper to create mock NextRequest
 */
function createMockRequest(queryParams: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/health');
  Object.entries(queryParams).forEach(function addParam([key, value]) {
    url.searchParams.set(key, value);
  });

  return new NextRequest(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

describe('health', function packageTests() {
  describe('#GET', function getTests() {
    beforeEach(function resetEnv() {
      vi.clearAllMocks();
      vi.unstubAllEnvs();
    });

    afterEach(function restoreEnv() {
      vi.unstubAllEnvs();
    });

    it('should return basic health status', async function basicHealth() {
      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('status', 'healthy');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('service', 'airo-app-builder-backend');
      expect(data).toHaveProperty('environment');
      expect(data).toHaveProperty('version');
      expect(data).not.toHaveProperty('uptime');
      expect(data).not.toHaveProperty('memory');
    });

    it('should return correct response headers', async function checkHeaders() {
      const request = createMockRequest();
      const response = await GET(request);

      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
    });

    it('should return valid timestamp in ISO format', async function validateTimestamp() {
      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      const timestamp = new Date(data.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).not.toBeNaN();
      expect(data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should return short SHA when KATANA_ARTIFACT_VERSION is set', async function shortSHA() {
      vi.stubEnv('KATANA_ARTIFACT_VERSION', 'abcdef1234567890');

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(data.version).toBe('abcdef1');
      expect(data.version.length).toBe(7);
    });

    it('should return unknown when KATANA_ARTIFACT_VERSION is not set', async function fallbackVersion() {
      vi.stubEnv('KATANA_ARTIFACT_VERSION', undefined);

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(data.version).toBe('unknown');
    });

    it('should handle short KATANA_ARTIFACT_VERSION gracefully', async function shortVersion() {
      vi.stubEnv('KATANA_ARTIFACT_VERSION', 'abc');

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(data.version).toBe('abc');
    });

    it('should handle exactly 7 character KATANA_ARTIFACT_VERSION', async function exactLength() {
      vi.stubEnv('KATANA_ARTIFACT_VERSION', 'abcdefg');

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(data.version).toBe('abcdefg');
    });

    it('should return detailed health info when requested', async function detailedHealth() {
      const request = createMockRequest({ detailed: 'true' });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('status', 'healthy');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('memory');
      expect(data).toHaveProperty('features');
    });

    it('should include uptime information in detailed mode', async function uptimeInfo() {
      const request = createMockRequest({ detailed: 'true' });
      const response = await GET(request);
      const data = await response.json();

      expect(data.uptime).toHaveProperty('seconds');
      expect(data.uptime).toHaveProperty('human');
      expect(typeof data.uptime.seconds).toBe('number');
      expect(typeof data.uptime.human).toBe('string');
      expect(data.uptime.human).toMatch(/\d+h \d+m \d+s/);
    });

    it('should include memory information in detailed mode', async function memoryInfo() {
      const request = createMockRequest({ detailed: 'true' });
      const response = await GET(request);
      const data = await response.json();

      expect(data.memory).toHaveProperty('used');
      expect(data.memory).toHaveProperty('total');
      expect(data.memory).toHaveProperty('rss');
      expect(data.memory.used).toMatch(/\d+ MB/);
      expect(data.memory.total).toMatch(/\d+ MB/);
      expect(data.memory.rss).toMatch(/\d+ MB/);
    });

    it('should include feature flags in detailed mode', async function featureFlags() {
      const request = createMockRequest({ detailed: 'true' });
      const response = await GET(request);
      const data = await response.json();

      expect(data.features).toHaveProperty('jwtValidation', true);
      expect(data.features).toHaveProperty('secureValidation');
      expect(data.features).toHaveProperty('gasketCompatibility', true);
      expect(typeof data.features.secureValidation).toBe('boolean');
    });

    it('should respect ENABLE_SECURE_JWT_VALIDATION flag', async function secureJWT() {
      vi.stubEnv('ENABLE_SECURE_JWT_VALIDATION', 'true');

      const request = createMockRequest({ detailed: 'true' });
      const response = await GET(request);
      const data = await response.json();

      expect(data.features.secureValidation).toBe(true);
    });

    it('should not include detailed info when detailed param is false', async function noDetailedWhenFalse() {
      const request = createMockRequest({ detailed: 'false' });
      const response = await GET(request);
      const data = await response.json();

      expect(data).not.toHaveProperty('uptime');
      expect(data).not.toHaveProperty('memory');
      expect(data).not.toHaveProperty('features');
    });

    it('should not include detailed info when detailed param is invalid', async function noDetailedWhenInvalid() {
      const request = createMockRequest({ detailed: 'invalid' });
      const response = await GET(request);
      const data = await response.json();

      expect(data).not.toHaveProperty('uptime');
      expect(data).not.toHaveProperty('memory');
    });

    it('should use development as default environment', async function defaultEnv() {
      vi.stubEnv('NODE_ENV', undefined);

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(data.environment).toBe('development');
    });

    it('should return production environment when set', async function productionEnv() {
      vi.stubEnv('NODE_ENV', 'production');

      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(data.environment).toBe('production');
    });

    it('should include package version', async function packageVersion() {
      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty('package_version');
      expect(typeof data.package_version).toBe('string');
    });

    it('should handle multiple rapid requests', async function rapidRequests() {
      const requests = Array(5).fill(null).map(function createRequest() {
        return GET(createMockRequest());
      });

      const responses = await Promise.all(requests);

      responses.forEach(function checkResponse(response) {
        expect(response.status).toBe(200);
      });

      const dataArray = await Promise.all(
        responses.map(function parseJSON(r) {
          return r.json();
        })
      );

      dataArray.forEach(function validateData(data) {
        expect(data.status).toBe('healthy');
      });
    });

    it('should return consistent structure across calls', async function consistentStructure() {
      const request1 = createMockRequest();
      const request2 = createMockRequest();

      const response1 = await GET(request1);
      const response2 = await GET(request2);

      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(Object.keys(data1).sort()).toEqual(Object.keys(data2).sort());
    });
  });
});
