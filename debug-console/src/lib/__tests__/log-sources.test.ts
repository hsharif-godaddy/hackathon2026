import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getLogSourceConfig,
  getAllLogSources,
  buildAppIdQuery,
  getNestedValue,
  type FieldMapping,
  type LogSourceConfig
} from '../log-sources';

describe('log-sources', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getLogSourceConfig', () => {
    describe('environment-specific index selection', () => {
      it('should return dev index when ENVIRONMENT_NAME is dev', () => {
        process.env.ENVIRONMENT_NAME = 'dev';
        process.env.PIONEER_ES_ENDPOINT = 'https://test.endpoint';
        process.env.PIONEER_ES_API_KEY = 'test-key';

        const config = getLogSourceConfig('airo-agents');

        expect(config).not.toBeNull();
        expect(config?.index).toBe('airo-agents-dev');
        expect(config?.environment).toBe('dev');
      });

      it('should return dev index when ENVIRONMENT_NAME is test', () => {
        process.env.ENVIRONMENT_NAME = 'test';
        process.env.PIONEER_ES_ENDPOINT = 'https://test.endpoint';
        process.env.PIONEER_ES_API_KEY = 'test-key';

        const config = getLogSourceConfig('airo-agents');

        expect(config).not.toBeNull();
        expect(config?.index).toBe('airo-agents-dev');
        expect(config?.environment).toBe('dev');
      });

      it('should return prod index when ENVIRONMENT_NAME is prod', () => {
        process.env.ENVIRONMENT_NAME = 'prod';
        process.env.PIONEER_ES_ENDPOINT = 'https://prod.endpoint';
        process.env.PIONEER_ES_API_KEY = 'prod-key';

        const config = getLogSourceConfig('airo-agents');

        expect(config).not.toBeNull();
        expect(config?.index).toBe('airo-agents-prod');
        expect(config?.environment).toBe('prod');
      });

      it('should default to dev index when ENVIRONMENT_NAME is not set', () => {
        delete process.env.ENVIRONMENT_NAME;
        process.env.PIONEER_ES_ENDPOINT = 'https://test.endpoint';
        process.env.PIONEER_ES_API_KEY = 'test-key';

        const config = getLogSourceConfig('airo-agents');

        expect(config).not.toBeNull();
        expect(config?.index).toBe('airo-agents-dev');
        expect(config?.environment).toBe('dev');
      });

      it('should return specific control plane index for dev', () => {
        process.env.ENVIRONMENT_NAME = 'dev';
        process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
        process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

        const config = getLogSourceConfig('control_plane');

        expect(config).not.toBeNull();
        expect(config?.index).toBe('pagely-mgmt-worker-hosting-activity-dev');
        expect(config?.environment).toBe('dev');
      });

      it('should return specific control plane index for prod', () => {
        process.env.ENVIRONMENT_NAME = 'prod';
        process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
        process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

        const config = getLogSourceConfig('control_plane');

        expect(config).not.toBeNull();
        expect(config?.index).toBe('pagely-mgmt-worker-hosting-activity-prod');
        expect(config?.environment).toBe('prod');
      });

      it('should return logs-* index for airo-app (not environment-specific)', () => {
        process.env.ENVIRONMENT_NAME = 'prod';
        process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';
        process.env.AIRO_BUILDER_ES_API_KEY = 'airo-key';

        const config = getLogSourceConfig('airo-app');

        expect(config).not.toBeNull();
        expect(config?.index).toBe('logs-*');
        expect(config?.environment).toBe('prod');
      });
    });

    describe('field mappings', () => {
      it('should return control plane config with log level field mapping', () => {
        process.env.ENVIRONMENT_NAME = 'dev';
        process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
        process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

        const config = getLogSourceConfig('control_plane');

        expect(config).not.toBeNull();
        expect(config?.fieldMapping.logLevelFieldMap).toBeDefined();
        expect(config?.fieldMapping.logLevelFieldMap).toEqual({
          'debug': 'DEBUG',
          'info': 'INFO',
          'warn': 'WARN',
          'error': 'ERROR',
          'fatal': 'FATAL'
        });
      });

      it('should return correct levelKeywordField for control plane', () => {
        process.env.ENVIRONMENT_NAME = 'dev';
        process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
        process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

        const config = getLogSourceConfig('control_plane');

        expect(config).not.toBeNull();
        expect(config?.fieldMapping.levelKeywordField).toBe('log.level.keyword');
      });

      it('should use Nomad job name field for airo-agents', () => {
        process.env.ENVIRONMENT_NAME = 'dev';
        process.env.PIONEER_ES_ENDPOINT = 'https://test.endpoint';
        process.env.PIONEER_ES_API_KEY = 'test-key';

        const config = getLogSourceConfig('airo-agents');

        expect(config).not.toBeNull();
        expect(config?.fieldMapping.appIdField).toBe('com.hashicorp.nomad.job_name');
        expect(config?.fieldMapping.appIdQueryType).toBe('prefix');
        expect(config?.fieldMapping.levelKeywordField).toBe('level'); // airo-agents uses text field
      });
    });

    it('should return null for unknown source', () => {
      const config = getLogSourceConfig('unknown-source');
      expect(config).toBeNull();
    });
  });

  describe('getAllLogSources', () => {
    it('should return all log sources with correct env-specific indices', () => {
      process.env.ENVIRONMENT_NAME = 'prod';
      process.env.PIONEER_ES_ENDPOINT = 'https://pioneer.endpoint';
      process.env.PIONEER_ES_API_KEY = 'pioneer-key';
      process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';
      process.env.AIRO_BUILDER_ES_API_KEY = 'airo-key';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const sources = getAllLogSources();

      expect(sources).toHaveLength(3);

      const agentSource = sources.find(s => s.id === 'airo-agents');
      expect(agentSource?.index).toBe('airo-agents-prod');
      expect(agentSource?.environment).toBe('prod');

      const appSource = sources.find(s => s.id === 'airo-app');
      expect(appSource?.index).toBe('logs-*');
      expect(appSource?.environment).toBe('prod');

      const controlPlaneSource = sources.find(s => s.id === 'control_plane');
      expect(controlPlaneSource?.index).toBe('pagely-mgmt-worker-hosting-activity-prod');
      expect(controlPlaneSource?.environment).toBe('prod');
    });

    it('should return all log sources with dev indices when ENVIRONMENT_NAME is test', () => {
      process.env.ENVIRONMENT_NAME = 'test';
      process.env.PIONEER_ES_ENDPOINT = 'https://pioneer.endpoint';
      process.env.PIONEER_ES_API_KEY = 'pioneer-key';
      process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';
      process.env.AIRO_BUILDER_ES_API_KEY = 'airo-key';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const sources = getAllLogSources();

      const agentSource = sources.find(s => s.id === 'airo-agents');
      expect(agentSource?.index).toBe('airo-agents-dev');

      const appSource = sources.find(s => s.id === 'airo-app');
      expect(appSource?.index).toBe('logs-*');

      const controlPlaneSource = sources.find(s => s.id === 'control_plane');
      expect(controlPlaneSource?.index).toBe('pagely-mgmt-worker-hosting-activity-dev');
    });
  });

  describe('buildAppIdQuery', () => {
    describe('prefix query construction for Nomad job names', () => {
      const nomadFieldMapping: FieldMapping = {
        appIdField: 'com.hashicorp.nomad.job_name',
        appIdQueryType: 'prefix',
        timestampField: '@timestamp',
        levelField: 'level',
        levelKeywordField: 'level.keyword',
        messageField: 'message',
        eventField: 'event',
        eventKeywordField: 'event.keyword',
        serviceField: 'service',
        serviceKeywordField: 'service.keyword',
        displayFields: []
      };

      it('should construct bool query with both legacy and unified patterns', () => {
        const query = buildAppIdQuery('test-app-123', nomadFieldMapping);

        expect(query).toEqual({
          bool: {
            should: [
              { prefix: { 'com.hashicorp.nomad.job_name': 'app-test-app-123-' } },
              { prefix: { 'com.hashicorp.nomad.job_name': 'airo-test-app-123' } }
            ],
            minimum_should_match: 1
          }
        });
      });

      it('should handle legacy pattern (app-{appId}-preview)', () => {
        const query = buildAppIdQuery('my-app', nomadFieldMapping);

        expect(query).toMatchObject({
          bool: {
            should: expect.arrayContaining([
              { prefix: { 'com.hashicorp.nomad.job_name': 'app-my-app-' } }
            ])
          }
        });
      });

      it('should handle unified pattern (airo-{appId})', () => {
        const query = buildAppIdQuery('my-app', nomadFieldMapping);

        expect(query).toMatchObject({
          bool: {
            should: expect.arrayContaining([
              { prefix: { 'com.hashicorp.nomad.job_name': 'airo-my-app' } }
            ])
          }
        });
      });

      it('should handle app IDs with special characters', () => {
        const query = buildAppIdQuery('app-with-dashes', nomadFieldMapping);

        expect(query).toEqual({
          bool: {
            should: [
              { prefix: { 'com.hashicorp.nomad.job_name': 'app-app-with-dashes-' } },
              { prefix: { 'com.hashicorp.nomad.job_name': 'airo-app-with-dashes' } }
            ],
            minimum_should_match: 1
          }
        });
      });
    });

    describe('other query types', () => {
      it('should construct term query when appIdQueryType is term', () => {
        const fieldMapping: FieldMapping = {
          appIdField: 'app_id',
          appIdQueryType: 'term',
          timestampField: '@timestamp',
          levelField: 'level',
          levelKeywordField: 'level.keyword',
          messageField: 'message',
          eventField: 'event',
          eventKeywordField: 'event.keyword',
          serviceField: 'service',
          serviceKeywordField: 'service.keyword',
          displayFields: []
        };

        const query = buildAppIdQuery('test-app', fieldMapping);

        expect(query).toEqual({
          term: { 'app_id': 'test-app' }
        });
      });

      it('should throw error for unsupported query type', () => {
        const fieldMapping: FieldMapping = {
          appIdField: 'data.appId',
          appIdQueryType: 'invalid' as any, // Force invalid type
          timestampField: '@timestamp',
          levelField: 'level',
          levelKeywordField: 'level',
          messageField: 'message',
          eventField: 'event',
          eventKeywordField: 'event',
          serviceField: 'KATANA_APP',
          serviceKeywordField: 'KATANA_APP',
          displayFields: []
        };

        expect(() => buildAppIdQuery('test-app', fieldMapping)).toThrow(
          "Unsupported appIdQueryType 'invalid'"
        );
      });

      it('should use term query for control_plane log source', () => {
        process.env.ENVIRONMENT_NAME = 'dev';
        process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
        process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

        const config = getLogSourceConfig('control_plane');
        const query = buildAppIdQuery('test-app-123', config!.fieldMapping);

        expect(query).toEqual({
          term: { 'app_id': 'test-app-123' }
        });
      });

      it('should use term query for airo-app log source', () => {
        process.env.ENVIRONMENT_NAME = 'dev';
        process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';
        process.env.AIRO_BUILDER_ES_API_KEY = 'airo-key';

        const config = getLogSourceConfig('airo-app');
        const query = buildAppIdQuery('test-app-456', config!.fieldMapping);

        expect(query).toEqual({
          term: { 'data.appId': 'test-app-456' }
        });
      });

      it('should construct simple prefix query for non-Nomad prefix fields', () => {
        const fieldMapping: FieldMapping = {
          appIdField: 'custom.field',
          appIdQueryType: 'prefix',
          timestampField: '@timestamp',
          levelField: 'level',
          levelKeywordField: 'level.keyword',
          messageField: 'message',
          eventField: 'event',
          eventKeywordField: 'event.keyword',
          serviceField: 'service',
          serviceKeywordField: 'service.keyword',
          displayFields: []
        };

        const query = buildAppIdQuery('test-app', fieldMapping);

        expect(query).toEqual({
          prefix: { 'custom.field': 'test-app' }
        });
      });

      it('should return null when appIdField is null', () => {
        const fieldMapping: FieldMapping = {
          appIdField: null,
          appIdQueryType: 'term',
          timestampField: '@timestamp',
          levelField: 'level',
          levelKeywordField: 'level.keyword',
          messageField: 'message',
          eventField: 'event',
          eventKeywordField: 'event.keyword',
          serviceField: 'service',
          serviceKeywordField: 'service.keyword',
          displayFields: []
        };

        const query = buildAppIdQuery('test-app', fieldMapping);

        expect(query).toBeNull();
      });
    });
  });

  describe('log level field mapping', () => {
    it('should map lowercase levels to uppercase for control plane', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');
      const logLevelMap = config?.fieldMapping.logLevelFieldMap;

      expect(logLevelMap).toBeDefined();
      expect(logLevelMap?.['debug']).toBe('DEBUG');
      expect(logLevelMap?.['info']).toBe('INFO');
      expect(logLevelMap?.['warn']).toBe('WARN');
      expect(logLevelMap?.['error']).toBe('ERROR');
      expect(logLevelMap?.['fatal']).toBe('FATAL');
    });

    it('should have lowercase log level mapping for airo-agents', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.PIONEER_ES_ENDPOINT = 'https://test.endpoint';
      process.env.PIONEER_ES_API_KEY = 'test-key';

      const config = getLogSourceConfig('airo-agents');

      expect(config?.fieldMapping.logLevelFieldMap).toBeDefined();
      expect(config?.fieldMapping.logLevelFieldMap).toEqual({
        'debug': 'debug',
        'info': 'info',
        'warn': 'warn',
        'error': 'error',
        'fatal': 'fatal'
      });
    });

    it('should have lowercase log level mapping for airo-app', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';
      process.env.AIRO_BUILDER_ES_API_KEY = 'airo-key';

      const config = getLogSourceConfig('airo-app');

      expect(config?.fieldMapping.logLevelFieldMap).toBeDefined();
      expect(config?.fieldMapping.logLevelFieldMap).toEqual({
        'debug': 'debug',
        'info': 'info',
        'warn': 'warn',
        'error': 'error',
        'fatal': 'fatal'
      });
    });
  });

  describe('getNestedValue', () => {
    it('should extract top-level value', () => {
      const obj = { foo: 'bar' };
      expect(getNestedValue(obj, 'foo')).toBe('bar');
    });

    it('should extract nested value with dot notation', () => {
      const obj = { data: { user: { name: 'John' } } };
      expect(getNestedValue(obj, 'data.user.name')).toBe('John');
    });

    it('should return undefined for non-existent path', () => {
      const obj = { foo: 'bar' };
      expect(getNestedValue(obj, 'baz')).toBeUndefined();
    });

    it('should return undefined for non-existent nested path', () => {
      const obj = { data: { user: 'John' } };
      expect(getNestedValue(obj, 'data.user.name')).toBeUndefined();
    });

    it('should handle null/undefined in path', () => {
      const obj = { data: null };
      expect(getNestedValue(obj, 'data.user')).toBeUndefined();
    });

    it('should extract deeply nested values', () => {
      const obj = { a: { b: { c: { d: { e: 'deep' } } } } };
      expect(getNestedValue(obj, 'a.b.c.d.e')).toBe('deep');
    });

    it('should handle objects with numeric values', () => {
      const obj = { count: 42 };
      expect(getNestedValue(obj, 'count')).toBe(42);
    });

    it('should handle arrays', () => {
      const obj = { items: [1, 2, 3] };
      expect(getNestedValue(obj, 'items')).toEqual([1, 2, 3]);
    });
  });
});
