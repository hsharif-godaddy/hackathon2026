import { describe, expect, it } from 'vitest';

import { buildAgentAppEndpointUrl } from '@/config/dynamic-api';

describe('buildAgentAppEndpointUrl', () => {
  it('should append apps segment and endpoint, stripping trailing slash on base', () => {
    expect(
      buildAgentAppEndpointUrl('https://agent.example.com/', 'app-1', 'screenshot')
    ).toBe('https://agent.example.com/apps/app-1/screenshot');
  });

  it('should strip leading slash on endpoint', () => {
    expect(
      buildAgentAppEndpointUrl('https://agent.example.com', 'app-1', '/screenshot')
    ).toBe('https://agent.example.com/apps/app-1/screenshot');
  });

  it('should omit trailing path when endpoint is empty', () => {
    expect(buildAgentAppEndpointUrl('https://agent.example.com', 'app-1', '')).toBe(
      'https://agent.example.com/apps/app-1'
    );
  });
});
