import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getLogSourceConfig,
  getAllLogSources,
  buildAppIdQuery,
  getNestedValue,
  type FieldMapping,
} from '../log-sources';

describe('log-sources', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Loki-backed sources require LOKI_ENDPOINT; tests that assert failure
    // mode delete it explicitly.
    process.env.LOKI_ENDPOINT = 'https://loki.test';
    process.env.LOKI_API_KEY = 'loki-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getLogSourceConfig', () => {
    describe('Loki-backed sources (airo-agents, airo-preview, airo-publish)', () => {
      it('returns Loki config for airo-agents with dev env label', () => {
        process.env.ENVIRONMENT_NAME = 'dev';

        const config = getLogSourceConfig('airo-agents');

        expect(config).not.toBeNull();
        expect(config?.backendType).toBe('loki');
        expect(config?.lokiEndpoint).toBe('https://loki.test');
        expect(config?.lokiApiKey).toBe('loki-key');
        expect(config?.lokiLabels).toEqual({ service_name: 'airo-agents', env: 'dev' });
        expect(config?.environment).toBe('dev');
      });

      it('maps ENVIRONMENT_NAME=test to the dev Loki label', () => {
        process.env.ENVIRONMENT_NAME = 'test';

        const config = getLogSourceConfig('airo-agents');

        expect(config?.lokiLabels?.env).toBe('dev');
        expect(config?.environment).toBe('dev');
      });

      it('uses prod Loki label when ENVIRONMENT_NAME=prod', () => {
        process.env.ENVIRONMENT_NAME = 'prod';

        const config = getLogSourceConfig('airo-agents');

        expect(config?.lokiLabels).toEqual({ service_name: 'airo-agents', env: 'prod' });
        expect(config?.environment).toBe('prod');
      });

      it('returns Loki preview config with airo-preview-application job label', () => {
        process.env.ENVIRONMENT_NAME = 'prod';

        const config = getLogSourceConfig('airo-preview');

        expect(config?.backendType).toBe('loki');
        expect(config?.lokiLabels).toEqual({ service_name: 'airo-preview-application', env: 'prod' });
        expect(config?.fieldMapping.appIdField).toBe('app_id');
      });

      it('returns Loki publish config with airo-publish-application job label', () => {
        process.env.ENVIRONMENT_NAME = 'prod';

        const config = getLogSourceConfig('airo-publish');

        expect(config?.backendType).toBe('loki');
        expect(config?.lokiLabels).toEqual({ service_name: 'airo-publish-application', env: 'prod' });
        expect(config?.fieldMapping.appIdField).toBe('app_id');
      });

      it('throws when LOKI_ENDPOINT is missing for a Loki-backed source', () => {
        delete process.env.LOKI_ENDPOINT;

        expect(() => getLogSourceConfig('airo-agents')).toThrow(/LOKI_ENDPOINT is required/);
        expect(() => getLogSourceConfig('airo-preview')).toThrow(/LOKI_ENDPOINT is required/);
        expect(() => getLogSourceConfig('airo-publish')).toThrow(/LOKI_ENDPOINT is required/);
      });
    });

    describe('ES-backed sources (airo-app, control_plane)', () => {
      it('returns control plane dev index', () => {
        process.env.ENVIRONMENT_NAME = 'dev';
        process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
        process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

        const config = getLogSourceConfig('control_plane');

        expect(config?.backendType).toBe('elasticsearch');
        expect(config?.index).toBe('pagely-mgmt-worker-hosting-activity-dev,pagely-mgmt-worker-airo-activity-dev');
        expect(config?.environment).toBe('dev');
      });

      it('returns control plane prod index', () => {
        process.env.ENVIRONMENT_NAME = 'prod';
        process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
        process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

        const config = getLogSourceConfig('control_plane');

        expect(config?.backendType).toBe('elasticsearch');
        expect(config?.index).toBe('pagely-mgmt-worker-hosting-activity-prod,pagely-mgmt-worker-airo-activity-prod');
      });

      it('returns logs-* index for airo-app regardless of environment', () => {
        process.env.ENVIRONMENT_NAME = 'prod';
        process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';
        process.env.AIRO_BUILDER_ES_API_KEY = 'airo-key';

        const config = getLogSourceConfig('airo-app');

        expect(config?.backendType).toBe('elasticsearch');
        expect(config?.index).toBe('logs-*');
      });
    });

    describe('field mappings', () => {
      it('maps levels to uppercase for control plane', () => {
        process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';

        const config = getLogSourceConfig('control_plane');

        expect(config?.fieldMapping.logLevelFieldMap).toEqual({
          debug: 'DEBUG',
          info: 'INFO',
          warn: 'WARN',
          error: 'ERROR',
          fatal: 'FATAL'
        });
        expect(config?.fieldMapping.levelKeywordField).toBe('log.level.keyword');
      });

      it('uses Nomad job name field for airo-agents', () => {
        const config = getLogSourceConfig('airo-agents');

        expect(config?.fieldMapping.appIdField).toBe('com.hashicorp.nomad.job_name');
        expect(config?.fieldMapping.appIdQueryType).toBe('prefix');
        expect(config?.fieldMapping.levelKeywordField).toBe('level');
      });
    });

    it('returns null for unknown source', () => {
      const config = getLogSourceConfig('unknown-source');
      expect(config).toBeNull();
    });
  });

  describe('getAllLogSources', () => {
    it('returns 8 sources with correct backend types', () => {
      process.env.ENVIRONMENT_NAME = 'prod';
      process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';
      process.env.AIRO_BUILDER_ES_API_KEY = 'airo-key';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const sources = getAllLogSources();

      expect(sources).toHaveLength(8);

      const byId = Object.fromEntries(sources.map(s => [s.id, s]));

      expect(byId['airo-agents'].backendType).toBe('loki');
      expect(byId['airo-agents'].lokiLabels).toEqual({ service_name: 'airo-agents', env: 'prod' });

      expect(byId['airo-preview'].backendType).toBe('loki');
      expect(byId['airo-preview'].lokiLabels).toEqual({ service_name: 'airo-preview-application', env: 'prod' });
      expect(byId['airo-preview'].fieldMapping.appIdField).toBe('app_id');

      expect(byId['airo-publish'].backendType).toBe('loki');
      expect(byId['airo-publish'].lokiLabels).toEqual({ service_name: 'airo-publish-application', env: 'prod' });

      expect(byId['airo-pre-start'].backendType).toBe('loki');
      expect(byId['airo-pre-start'].lokiLabels).toEqual({ service_name: 'airo-pre-start', env: 'prod' });

      expect(byId['airo-db-init'].backendType).toBe('loki');
      expect(byId['airo-db-init'].lokiLabels).toEqual({ service_name: 'airo-db-init', env: 'prod' });

      expect(byId['airo-secrets-worker'].backendType).toBe('loki');
      expect(byId['airo-secrets-worker'].lokiLabels).toEqual({ service_name: 'airo-secrets-worker', env: 'prod' });

      expect(byId['airo-app'].backendType).toBe('elasticsearch');
      expect(byId['airo-app'].index).toBe('logs-*');

      expect(byId['control_plane'].backendType).toBe('elasticsearch');
      expect(byId['control_plane'].index).toBe('pagely-mgmt-worker-hosting-activity-prod,pagely-mgmt-worker-airo-activity-prod');
      expect(byId['control_plane'].fieldMapping.appIdField).toBe('app_id|appId_str');
    });

    it('maps ENVIRONMENT_NAME=test to dev labels/indices', () => {
      process.env.ENVIRONMENT_NAME = 'test';
      process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';

      const sources = getAllLogSources();
      const byId = Object.fromEntries(sources.map(s => [s.id, s]));

      expect(byId['airo-agents'].lokiLabels?.env).toBe('dev');
      expect(byId['airo-preview'].lokiLabels?.env).toBe('dev');
      expect(byId['airo-publish'].lokiLabels?.env).toBe('dev');
      expect(byId['airo-pre-start'].lokiLabels?.env).toBe('dev');
      expect(byId['airo-db-init'].lokiLabels?.env).toBe('dev');
      expect(byId['airo-secrets-worker'].lokiLabels?.env).toBe('dev');
      expect(byId['control_plane'].index).toBe('pagely-mgmt-worker-hosting-activity-dev,pagely-mgmt-worker-airo-activity-dev');
    });

    it('throws when LOKI_ENDPOINT is missing', () => {
      delete process.env.LOKI_ENDPOINT;

      expect(() => getAllLogSources()).toThrow(/LOKI_ENDPOINT is required/);
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

      it('prefixes with airo-', () => {
        expect(buildAppIdQuery('test-app-123', nomadFieldMapping)).toEqual({
          prefix: { 'com.hashicorp.nomad.job_name': 'airo-test-app-123' }
        });
      });
    });

    describe('other query types', () => {
      it('constructs term query when appIdQueryType is term', () => {
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

        expect(buildAppIdQuery('test-app', fieldMapping)).toEqual({
          term: { app_id: 'test-app' }
        });
      });

      it('throws for unsupported query type', () => {
        const fieldMapping: FieldMapping = {
          appIdField: 'data.appId',
          appIdQueryType: 'invalid' as FieldMapping['appIdQueryType'],
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

      it('uses bool.should for control_plane pipe-separated fields', () => {
        process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';

        const config = getLogSourceConfig('control_plane');
        const query = buildAppIdQuery('test-app-123', config!.fieldMapping);

        expect(query).toEqual({
          bool: {
            should: [
              { term: { app_id: 'test-app-123' } },
              { term: { appId_str: 'test-app-123' } }
            ],
            minimum_should_match: 1
          }
        });
      });

      it('uses term query for airo-app source', () => {
        process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';

        const config = getLogSourceConfig('airo-app');
        const query = buildAppIdQuery('test-app-456', config!.fieldMapping);

        expect(query).toEqual({
          term: { 'data.appId': 'test-app-456' }
        });
      });

      it('returns null when appIdField is null', () => {
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

        expect(buildAppIdQuery('test-app', fieldMapping)).toBeNull();
      });
    });
  });

  describe('getNestedValue', () => {
    it('extracts top-level value', () => {
      expect(getNestedValue({ foo: 'bar' }, 'foo')).toBe('bar');
    });

    it('extracts nested value with dot notation', () => {
      expect(getNestedValue({ data: { user: { name: 'John' } } }, 'data.user.name')).toBe('John');
    });

    it('returns undefined for non-existent path', () => {
      expect(getNestedValue({ foo: 'bar' }, 'baz')).toBeUndefined();
    });

    it('returns undefined for non-existent nested path', () => {
      expect(getNestedValue({ data: { user: 'John' } }, 'data.user.name')).toBeUndefined();
    });

    it('handles null/undefined in path', () => {
      expect(getNestedValue({ data: null }, 'data.user')).toBeUndefined();
    });

    it('extracts deeply nested values', () => {
      expect(getNestedValue({ a: { b: { c: { d: { e: 'deep' } } } } }, 'a.b.c.d.e')).toBe('deep');
    });
  });
});
