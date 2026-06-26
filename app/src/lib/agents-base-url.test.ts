import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAgentsBaseUrl } from './agents-base-url';

const ENV_KEYS: readonly string[] = ['AGENTS_SERVICE_URL', 'AGENTS_PORT'];

describe('resolveAgentsBaseUrl', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('prefers site.agent_url over every env var', () => {
    process.env.AGENTS_SERVICE_URL = 'https://env-wins.example';
    process.env.AGENTS_PORT = '9999';
    expect(resolveAgentsBaseUrl({ agent_url: 'https://site-wins.example' }))
      .toBe('https://site-wins.example');
  });

  it('falls back to AGENTS_SERVICE_URL when site.agent_url is absent', () => {
    process.env.AGENTS_SERVICE_URL = 'https://env-fallback.example:9000';
    expect(resolveAgentsBaseUrl(null)).toBe('https://env-fallback.example:9000');
  });

  it('falls back to AGENTS_SERVICE_URL when site.agent_url is empty string', () => {
    process.env.AGENTS_SERVICE_URL = 'https://env-fallback.example:9000';
    expect(resolveAgentsBaseUrl({ agent_url: '' }))
      .toBe('https://env-fallback.example:9000');
  });

  it('uses AGENTS_PORT for the local fallback when no site and no AGENTS_SERVICE_URL', () => {
    process.env.AGENTS_PORT = '4040';
    expect(resolveAgentsBaseUrl(undefined)).toBe('http://localhost:4040');
  });

  it('defaults to port 4000 when nothing is set — preserves existing behavior', () => {
    expect(resolveAgentsBaseUrl(undefined)).toBe('http://localhost:4000');
  });

  it('ignores whitespace-only AGENTS_PORT', () => {
    process.env.AGENTS_PORT = '   ';
    expect(resolveAgentsBaseUrl(null)).toBe('http://localhost:4000');
  });

  it('AGENTS_SERVICE_URL beats AGENTS_PORT', () => {
    process.env.AGENTS_SERVICE_URL = 'https://full-url-wins.example';
    process.env.AGENTS_PORT = '4040';
    expect(resolveAgentsBaseUrl(null)).toBe('https://full-url-wins.example');
  });
});
