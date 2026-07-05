import { describe, it, expect } from 'vitest';

import { isComplianceManagedPath } from '../managed-paths.js';

describe('isComplianceManagedPath', () => {
  it('matches the two compliance pages (relative, ./-prefixed, and docker /app paths)', () => {
    expect(isComplianceManagedPath('src/pages/privacy.tsx')).toBe(true);
    expect(isComplianceManagedPath('src/pages/terms.tsx')).toBe(true);
    expect(isComplianceManagedPath('./src/pages/privacy.tsx')).toBe(true);
    expect(isComplianceManagedPath('/app/src/pages/terms.tsx')).toBe(true);
    expect(isComplianceManagedPath('/app/src/pages/../pages/privacy.tsx')).toBe(true);
  });

  it('does not match other pages or near-misses', () => {
    expect(isComplianceManagedPath('src/pages/about.tsx')).toBe(false);
    expect(isComplianceManagedPath('src/pages/privacy.ts')).toBe(false);
    expect(isComplianceManagedPath('privacy.tsx')).toBe(false);
    expect(isComplianceManagedPath('src/components/privacy.tsx')).toBe(false);
  });
});
