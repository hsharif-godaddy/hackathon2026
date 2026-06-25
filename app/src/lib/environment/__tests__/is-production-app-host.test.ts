import { describe, expect, it } from 'vitest';

import { isProductionAppHost } from '@/lib/environment/is-production-app-host';

describe('is-production-app-host', function isProductionAppHostTests() {
  it('returns true for prod BFF hosts', function prodHosts() {
    expect(isProductionAppHost('airo.ai')).toBe(true);
    expect(isProductionAppHost('airo-builder.godaddy.com')).toBe(true);
    expect(isProductionAppHost('airo.ai:443')).toBe(true);
  });

  it('returns false for dev test and local hosts', function nonProdHosts() {
    expect(isProductionAppHost('airo-builder.test-godaddy.com')).toBe(false);
    expect(isProductionAppHost('airo-builder.dev-godaddy.com')).toBe(false);
    expect(isProductionAppHost('local.gasket.dev-godaddy.com')).toBe(false);
    expect(isProductionAppHost('localhost')).toBe(false);
    expect(isProductionAppHost('test-airoapp.ai')).toBe(false);
  });
});
