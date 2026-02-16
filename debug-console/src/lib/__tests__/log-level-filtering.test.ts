import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getLogSourceConfig, type FieldMapping } from '../log-sources';

/**
 * Tests for log level filtering logic used in /api/es-logs route
 *
 * This tests the transformation logic that converts user-provided log levels
 * to the format expected by different Elasticsearch indices.
 */
describe('log level filtering logic (route.ts)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('single level filtering with logLevelFieldMap', () => {
    it('should map lowercase level to uppercase for control plane', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');
      const level = 'info';

      // Simulate route logic: route.ts:80-84
      const mappedLevel = config?.fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase();

      expect(mappedLevel).toBe('INFO');
      expect(config?.fieldMapping.levelKeywordField).toBe('log.level.keyword');

      // Expected Elasticsearch query clause
      const expectedClause = {
        term: { [config!.fieldMapping.levelKeywordField]: mappedLevel }
      };

      expect(expectedClause).toEqual({
        term: { 'log.level.keyword': 'INFO' }
      });
    });

    it('should handle all control plane log levels correctly', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');
      const levels = ['debug', 'info', 'warn', 'error', 'fatal'];

      const mappedLevels = levels.map(level =>
        config?.fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase()
      );

      expect(mappedLevels).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
    });

    it('should map to lowercase for airo-agents', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.PIONEER_ES_ENDPOINT = 'https://test.endpoint';
      process.env.PIONEER_ES_API_KEY = 'test-key';

      const config = getLogSourceConfig('airo-agents');
      const level = 'info';

      // Simulate route logic with mapping
      const mappedLevel = config?.fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase();

      expect(mappedLevel).toBe('info'); // Maps to lowercase
      expect(config?.fieldMapping.levelKeywordField).toBe('level'); // airo-agents uses text field, not keyword
    });

    it('should handle case-insensitive input', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');
      const inputs = ['INFO', 'Info', 'info', 'InFo'];

      const mappedLevels = inputs.map(level =>
        config?.fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase()
      );

      // All should map to 'INFO'
      expect(mappedLevels.every(level => level === 'INFO')).toBe(true);
    });
  });

  describe('multiple levels filtering with logLevelFieldMap', () => {
    it('should map multiple levels for control plane', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');
      const levels = 'info,warn,error'; // Simulates query param

      // Simulate route logic: route.ts:75-79
      const levelList = levels.split(',').map(l =>
        config?.fieldMapping.logLevelFieldMap?.[l.toLowerCase()] || l.toUpperCase()
      );

      expect(levelList).toEqual(['INFO', 'WARN', 'ERROR']);

      // Expected Elasticsearch query clause
      const expectedClause = {
        terms: { [config!.fieldMapping.levelKeywordField]: levelList }
      };

      expect(expectedClause).toEqual({
        terms: { 'log.level.keyword': ['INFO', 'WARN', 'ERROR'] }
      });
    });

    it('should handle mixed case in multiple levels', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');
      const levels = 'Info,WARN,error';

      const levelList = levels.split(',').map(l =>
        config?.fieldMapping.logLevelFieldMap?.[l.toLowerCase()] || l.toUpperCase()
      );

      expect(levelList).toEqual(['INFO', 'WARN', 'ERROR']);
    });

    it('should map multiple levels to lowercase for airo-agents', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.PIONEER_ES_ENDPOINT = 'https://test.endpoint';
      process.env.PIONEER_ES_API_KEY = 'test-key';

      const config = getLogSourceConfig('airo-agents');
      const levels = 'info,warn,error';

      const levelList = levels.split(',').map(l =>
        config?.fieldMapping.logLevelFieldMap?.[l.toLowerCase()] || l.toUpperCase()
      );

      expect(levelList).toEqual(['info', 'warn', 'error']);
    });
  });

  describe('query construction with correct keyword fields', () => {
    it('should use levelKeywordField for term queries', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');

      // Verify the route uses keyword field, not analyzed field
      expect(config?.fieldMapping.levelField).toBe('level');
      expect(config?.fieldMapping.levelKeywordField).toBe('log.level.keyword');

      // Route should use levelKeywordField for exact match queries
      const level = 'error';
      const mappedLevel = config?.fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase();
      const mustClause = {
        term: { [config!.fieldMapping.levelKeywordField]: mappedLevel }
      };

      expect(mustClause).toEqual({
        term: { 'log.level.keyword': 'ERROR' }
      });
    });

    it('should use levelKeywordField for terms queries (multiple levels)', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');
      const levels = 'info,error';

      const levelList = levels.split(',').map(l =>
        config?.fieldMapping.logLevelFieldMap?.[l.toLowerCase()] || l.toUpperCase()
      );

      const mustClause = {
        terms: { [config!.fieldMapping.levelKeywordField]: levelList }
      };

      expect(mustClause).toEqual({
        terms: { 'log.level.keyword': ['INFO', 'ERROR'] }
      });
    });

    it('should handle airo-agents with text field (not keyword)', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.PIONEER_ES_ENDPOINT = 'https://test.endpoint';
      process.env.PIONEER_ES_API_KEY = 'test-key';

      const config = getLogSourceConfig('airo-agents');

      expect(config?.fieldMapping.levelKeywordField).toBe('level');

      const level = 'error';
      const mappedLevel = config?.fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase();
      const mustClause = {
        term: { [config!.fieldMapping.levelKeywordField]: mappedLevel }
      };

      expect(mustClause).toEqual({
        term: { 'level': 'error' }
      });
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle unknown log level with uppercase fallback', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');
      const level = 'trace'; // Not in mapping

      const mappedLevel = config?.fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase();

      expect(mappedLevel).toBe('TRACE'); // Falls back to uppercase
    });

    it('should handle empty level string', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');
      const level = '';

      const mappedLevel = config?.fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase();

      expect(mappedLevel).toBe(''); // Empty string uppercase is empty string
    });

    it('should handle whitespace in levels list', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const config = getLogSourceConfig('control_plane');
      const levels = 'info, warn, error'; // With spaces

      const levelList = levels.split(',').map(l =>
        config?.fieldMapping.logLevelFieldMap?.[l.trim().toLowerCase()] || l.trim().toUpperCase()
      );

      expect(levelList).toEqual(['INFO', 'WARN', 'ERROR']);
    });
  });

  describe('integration with different log sources', () => {
    it('should handle airo-app logs correctly', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';
      process.env.AIRO_BUILDER_ES_API_KEY = 'airo-key';

      const config = getLogSourceConfig('airo-app');
      const level = 'info';

      // Maps to lowercase
      const mappedLevel = config?.fieldMapping.logLevelFieldMap?.[level.toLowerCase()] || level.toUpperCase();

      expect(mappedLevel).toBe('info');
      expect(config?.fieldMapping.levelKeywordField).toBe('level'); // Note: airo-app uses non-keyword
    });

    it('should have appropriate log level mapping for each source', () => {
      process.env.ENVIRONMENT_NAME = 'dev';
      process.env.PIONEER_ES_ENDPOINT = 'https://test.endpoint';
      process.env.PIONEER_ES_API_KEY = 'test-key';
      process.env.AIRO_BUILDER_ES_ENDPOINT = 'https://airo.endpoint';
      process.env.AIRO_BUILDER_ES_API_KEY = 'airo-key';
      process.env.CONTROL_PLANE_ES_ENDPOINT = 'https://cp.endpoint';
      process.env.CONTROL_PLANE_ES_API_KEY = 'cp-key';

      const agentsConfig = getLogSourceConfig('airo-agents');
      const appConfig = getLogSourceConfig('airo-app');
      const cpConfig = getLogSourceConfig('control_plane');

      // Airo-agents uses lowercase levels
      expect(agentsConfig?.fieldMapping.logLevelFieldMap).toBeDefined();
      expect(agentsConfig?.fieldMapping.logLevelFieldMap?.['info']).toBe('info');

      // Airo-app uses lowercase levels
      expect(appConfig?.fieldMapping.logLevelFieldMap).toBeDefined();
      expect(appConfig?.fieldMapping.logLevelFieldMap?.['info']).toBe('info');

      // Control plane uses uppercase levels
      expect(cpConfig?.fieldMapping.logLevelFieldMap).toBeDefined();
      expect(cpConfig?.fieldMapping.logLevelFieldMap?.['info']).toBe('INFO');
    });
  });
});
