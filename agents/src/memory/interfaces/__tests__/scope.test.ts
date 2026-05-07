import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../logging/index.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from '../../../logging/index.js';
import {
  appIdFromTag,
  customerIdFromContext,
  workspaceScopeFromAppId,
  workspaceTag,
  WORKSPACE_TAG_PREFIX,
} from '../scope.js';

describe('scope', function scopeTests() {
  describe('#workspaceScopeFromAppId', function fromAppIdTests() {
    it('should return resolved scope when customerId provided', function resolved() {
      const scope = workspaceScopeFromAppId('app-1', 'cust-1');
      expect(scope).toEqual({ kind: 'resolved', appId: 'app-1', customerId: 'cust-1' });
    });

    it('should return local scope when customerId omitted', function local() {
      const scope = workspaceScopeFromAppId('app-1');
      expect(scope).toEqual({ kind: 'local', appId: 'app-1' });
    });

    it('should return local scope when customerId is empty string', function emptyCustomer() {
      const scope = workspaceScopeFromAppId('app-1', '');
      expect(scope).toEqual({ kind: 'local', appId: 'app-1' });
    });

    it('should return local scope when customerId is undefined', function undefinedCustomer() {
      const scope = workspaceScopeFromAppId('app-1', undefined);
      expect(scope).toEqual({ kind: 'local', appId: 'app-1' });
    });
  });

  describe('#workspaceTag', function tagTests() {
    it('should produce tag with prefix and appId', function basic() {
      const scope = workspaceScopeFromAppId('my-app');
      expect(workspaceTag(scope)).toBe(`${WORKSPACE_TAG_PREFIX}my-app`);
    });

    it('should produce same tag regardless of customerId', function ignoreCustomer() {
      const local = workspaceScopeFromAppId('app-1');
      const resolved = workspaceScopeFromAppId('app-1', 'cust-1');
      expect(workspaceTag(local)).toBe(workspaceTag(resolved));
    });
  });

  describe('#appIdFromTag', function fromTagTests() {
    it('should extract appId from valid tag', function extract() {
      expect(appIdFromTag(`${WORKSPACE_TAG_PREFIX}app-1`)).toBe('app-1');
    });

    it('should return undefined for tag without prefix', function noPrefix() {
      expect(appIdFromTag('app-1')).toBeUndefined();
    });

    it('should return empty string for prefix-only tag', function prefixOnly() {
      expect(appIdFromTag(WORKSPACE_TAG_PREFIX)).toBe('');
    });
  });

  describe('#customerIdFromContext', function fromContextTests() {
    it('should extract string customerId from metadata', function extract() {
      expect(customerIdFromContext({ metadata: { customerId: 'cust-1' } })).toBe('cust-1');
    });

    it('should return undefined and warn when customerId is not a string', function notString() {
      expect(customerIdFromContext({ metadata: { customerId: 123 } })).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith('scope.customerIdFromContext.nonStringValue', { type: 'number' });
    });

    it('should return undefined when metadata is missing', function noMetadata() {
      expect(customerIdFromContext({})).toBeUndefined();
    });

    it('should return undefined when context is undefined', function noContext() {
      expect(customerIdFromContext(undefined)).toBeUndefined();
    });

    it('should return undefined when customerId key is absent', function noKey() {
      expect(customerIdFromContext({ metadata: { other: 'value' } })).toBeUndefined();
    });

    it('should return undefined without warning when customerId is null', function nullValue() {
      vi.mocked(logger.warn).mockClear();
      expect(customerIdFromContext({ metadata: { customerId: null } })).toBeUndefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
