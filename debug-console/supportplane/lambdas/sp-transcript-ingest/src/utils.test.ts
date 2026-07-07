import { describe, expect, it } from 'vitest';

import { mapResolutionToStatus } from './utils.js';

describe('mapResolutionToStatus', () => {
  it('maps Partially to partially_resolved', function partially() {
    expect(mapResolutionToStatus('Partially')).toBe('partially_resolved');
  });
});
