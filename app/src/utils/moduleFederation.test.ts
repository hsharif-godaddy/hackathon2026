import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  fetchComponentInfo,
  loadRemoteComponentConfig,
  setLocalOverride,
  clearLocalOverride,
} from './moduleFederation';

// Mock getRootDomain
vi.mock('./getRootDomain', () => ({
  getRootDomain: vi.fn(() => 'godaddy.com'),
}));

import { getRootDomain } from './getRootDomain';

describe('moduleFederation utilities', () => {
  let mockLocalStorage: { [key: string]: string };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage = {};

    // Mock localStorage
    global.localStorage = {
      getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
      length: 0,
      key: vi.fn(),
    } as Storage;

    // Mock fetch
    global.fetch = vi.fn();

    // Reset getRootDomain mock
    vi.mocked(getRootDomain).mockReturnValue('godaddy.com');
  });

  describe('fetchComponentInfo', () => {
    it('should fetch component info with correct URL and headers', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await fetchComponentInfo('@partners/ssl-repository-ui', '1.0.0');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://bff.pcx.godaddy.com/api/module-federation/config?moduleName=%40partners%2Fssl-repository-ui&version=1.0.0',
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
          },
          credentials: 'include',
        }
      );
    });

    it('should use root domain from getRootDomain', async () => {
      vi.mocked(getRootDomain).mockReturnValue('test-godaddy.com');
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await fetchComponentInfo('@partners/ssl-repository-ui', '1.0.0');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://bff.pcx.test-godaddy.com'),
        expect.any(Object)
      );
    });

    it('should fallback to godaddy.com when getRootDomain returns null', async () => {
      vi.mocked(getRootDomain).mockReturnValue(null);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await fetchComponentInfo('@partners/ssl-repository-ui', '1.0.0');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://bff.pcx.godaddy.com'),
        expect.any(Object)
      );
    });

    it('should include branch parameter when local branch override exists', async () => {
      mockLocalStorage['partners-mf-branch-config-@partners/ssl-repository-ui'] = 'feature-branch';
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await fetchComponentInfo('@partners/ssl-repository-ui', '1.0.0');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('branch=feature-branch'),
        expect.any(Object)
      );
    });

    it('should handle numeric version', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await fetchComponentInfo('@partners/ssl-repository-ui', 2);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('version=2'),
        expect.any(Object)
      );
    });

    it('should handle string version', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await fetchComponentInfo('@partners/ssl-repository-ui', '2.5.1');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('version=2.5.1'),
        expect.any(Object)
      );
    });

    it('should URL encode module name', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      await fetchComponentInfo('@partners/ssl-repository-ui', '1.0.0');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('%40partners%2Fssl-repository-ui'),
        expect.any(Object)
      );
    });
  });

  describe('loadRemoteComponentConfig', () => {
    it('should use local override when present', async () => {
      const override = {
        url: 'http://localhost:3000/remoteEntry.js',
        scope: 'sslRepositoryUI',
        module: './Module',
      };
      mockLocalStorage['partners-mf-config-@partners/ssl-repository-ui'] = JSON.stringify(override);

      const config = await loadRemoteComponentConfig('@partners/ssl-repository-ui', '1.0.0');

      expect(config).toEqual(override);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should fetch from BFF API when no local override', async () => {
      const bffResponse = {
        moduleUrl: 'https://cdn.example.com/remoteEntry.js',
        metaData: {
          scope: 'sslRepositoryUI',
          defaultExpose: './Module',
        },
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => bffResponse,
      } as Response);

      const config = await loadRemoteComponentConfig('@partners/ssl-repository-ui', '1.0.0');

      expect(config).toEqual({
        url: 'https://cdn.example.com/remoteEntry.js',
        scope: 'sslRepositoryUI',
        module: './Module',
      });
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should transform BFF response to ModuleConfig format', async () => {
      const bffResponse = {
        moduleUrl: 'https://cdn.example.com/entry.js',
        metaData: {
          scope: 'testScope',
          defaultExpose: './TestModule',
        },
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => bffResponse,
      } as Response);

      const config = await loadRemoteComponentConfig('@test/module', '2.0.0');

      expect(config.url).toBe(bffResponse.moduleUrl);
      expect(config.scope).toBe(bffResponse.metaData.scope);
      expect(config.module).toBe(bffResponse.metaData.defaultExpose);
    });

    it('should handle different module names', async () => {
      const bffResponse = {
        moduleUrl: 'https://cdn.example.com/remoteEntry.js',
        metaData: {
          scope: 'differentScope',
          defaultExpose: './DifferentModule',
        },
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => bffResponse,
      } as Response);

      const config = await loadRemoteComponentConfig('@partners/different-module', '1.0.0');

      expect(config).toEqual({
        url: 'https://cdn.example.com/remoteEntry.js',
        scope: 'differentScope',
        module: './DifferentModule',
      });
    });

    it('should handle version as number', async () => {
      const bffResponse = {
        moduleUrl: 'https://cdn.example.com/remoteEntry.js',
        metaData: {
          scope: 'testScope',
          defaultExpose: './Module',
        },
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => bffResponse,
      } as Response);

      const config = await loadRemoteComponentConfig('@test/module', 3);

      expect(config).toBeDefined();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('version=3'),
        expect.any(Object)
      );
    });
  });

  describe('setLocalOverride', () => {
    it('should store override in localStorage', () => {
      setLocalOverride(
        '@partners/ssl-repository-ui',
        'http://localhost:3000/remoteEntry.js',
        'sslRepositoryUI',
        './Module'
      );

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'partners-mf-config-@partners/ssl-repository-ui',
        JSON.stringify({
          url: 'http://localhost:3000/remoteEntry.js',
          scope: 'sslRepositoryUI',
          module: './Module',
        })
      );
    });

    it('should override existing configuration', () => {
      setLocalOverride('@test/module', 'url1', 'scope1', 'module1');
      setLocalOverride('@test/module', 'url2', 'scope2', 'module2');

      const stored = mockLocalStorage['partners-mf-config-@test/module'];
      const parsed = JSON.parse(stored);

      expect(parsed).toEqual({
        url: 'url2',
        scope: 'scope2',
        module: 'module2',
      });
    });

    it('should handle different module names', () => {
      setLocalOverride('@partners/module1', 'url1', 'scope1', 'module1');
      setLocalOverride('@partners/module2', 'url2', 'scope2', 'module2');

      expect(mockLocalStorage['partners-mf-config-@partners/module1']).toBeDefined();
      expect(mockLocalStorage['partners-mf-config-@partners/module2']).toBeDefined();
    });

    it('should store all required fields', () => {
      setLocalOverride(
        '@partners/ssl-repository-ui',
        'https://example.com/entry.js',
        'myScope',
        './MyModule'
      );

      const stored = mockLocalStorage['partners-mf-config-@partners/ssl-repository-ui'];
      const parsed = JSON.parse(stored);

      expect(parsed.url).toBe('https://example.com/entry.js');
      expect(parsed.scope).toBe('myScope');
      expect(parsed.module).toBe('./MyModule');
    });
  });

  describe('clearLocalOverride', () => {
    it('should remove override from localStorage', () => {
      mockLocalStorage['partners-mf-config-@partners/ssl-repository-ui'] = JSON.stringify({
        url: 'test',
        scope: 'test',
        module: 'test',
      });

      clearLocalOverride('@partners/ssl-repository-ui');

      expect(localStorage.removeItem).toHaveBeenCalledWith(
        'partners-mf-config-@partners/ssl-repository-ui'
      );
      expect(mockLocalStorage['partners-mf-config-@partners/ssl-repository-ui']).toBeUndefined();
    });

    it('should handle clearing non-existent override', () => {
      clearLocalOverride('@partners/non-existent');

      expect(localStorage.removeItem).toHaveBeenCalledWith(
        'partners-mf-config-@partners/non-existent'
      );
    });

    it('should only clear specified module', () => {
      mockLocalStorage['partners-mf-config-@partners/module1'] = 'config1';
      mockLocalStorage['partners-mf-config-@partners/module2'] = 'config2';

      clearLocalOverride('@partners/module1');

      expect(mockLocalStorage['partners-mf-config-@partners/module1']).toBeUndefined();
      expect(mockLocalStorage['partners-mf-config-@partners/module2']).toBe('config2');
    });
  });

  describe('integration scenarios', () => {
    it('should use override after setting it', async () => {
      const override = {
        url: 'http://localhost:3000/remoteEntry.js',
        scope: 'localScope',
        module: './LocalModule',
      };

      setLocalOverride(
        '@partners/ssl-repository-ui',
        override.url,
        override.scope,
        override.module
      );

      const config = await loadRemoteComponentConfig('@partners/ssl-repository-ui', '1.0.0');

      expect(config).toEqual(override);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should fetch from API after clearing override', async () => {
      setLocalOverride('@partners/ssl-repository-ui', 'url', 'scope', 'module');
      clearLocalOverride('@partners/ssl-repository-ui');

      const bffResponse = {
        moduleUrl: 'https://cdn.example.com/remoteEntry.js',
        metaData: {
          scope: 'sslRepositoryUI',
          defaultExpose: './Module',
        },
      };

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => bffResponse,
      } as Response);

      const config = await loadRemoteComponentConfig('@partners/ssl-repository-ui', '1.0.0');

      expect(config.url).toBe(bffResponse.moduleUrl);
      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
