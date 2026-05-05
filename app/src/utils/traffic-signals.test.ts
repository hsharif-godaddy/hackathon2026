import { describe, expect, it } from 'vitest';

import { trafficPathwaySessionId } from '@/utils/traffic-signals';

describe('trafficPathwaySessionId', function pathwaySuite() {
  it('returns trimmed non-empty pathway value', function pathwayOk() {
    expect(trafficPathwaySessionId('  sid-1  ')).toBe('sid-1');
  });

  it('returns undefined for blank', function pathwayBlank() {
    expect(trafficPathwaySessionId(undefined)).toBeUndefined();
    expect(trafficPathwaySessionId('   ')).toBeUndefined();
  });

  it('passes through decoded pathway value (cookie jar already decoded)', function pathwayDecoded() {
    expect(trafficPathwaySessionId('uuid/segment')).toBe('uuid/segment');
  });
});
