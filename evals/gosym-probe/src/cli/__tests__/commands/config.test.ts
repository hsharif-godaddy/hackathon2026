import { describe, it, expect } from 'vitest';
import { formatEnvTable } from '../../commands/config.js';

describe('formatEnvTable', () => {
  it('includes column headers', () => {
    const result = formatEnvTable({});
    expect(result).toContain('Key');
    expect(result).toContain('Value');
  });

  it('shows plain value for a non-sensitive key', () => {
    const result = formatEnvTable({ GD_ENV: 'local.dev' });
    expect(result).toContain('local.dev');
    expect(result).toContain('GD_ENV');
  });

  it('masks the value for PROBE_OPENAI_API_KEY', () => {
    const result = formatEnvTable({ PROBE_OPENAI_API_KEY: 'sk-secret' });
    expect(result).not.toContain('sk-secret');
    expect(result).toMatch(/\*/);
  });

  it('does not mask OPENAI_BASE_URL', () => {
    const url = 'https://example.com';
    const result = formatEnvTable({ OPENAI_BASE_URL: url });
    expect(result).toContain(url);
  });

  it('shows multiple entries as separate rows', () => {
    const result = formatEnvTable({
      GD_ENV: 'local.dev',
      OPENAI_MODEL: 'claude-sonnet-4-6',
    });
    expect(result).toContain('GD_ENV');
    expect(result).toContain('OPENAI_MODEL');
    expect(result).toContain('local.dev');
    expect(result).toContain('claude-sonnet-4-6');
  });

  it('handles an empty entries object without throwing', () => {
    expect(() => formatEnvTable({})).not.toThrow();
  });

  it('masks empty string for a sensitive key', () => {
    const result = formatEnvTable({ PROBE_OPENAI_API_KEY: '' });
    expect(result).not.toContain('sk-');
  });

  it('includes the key name alongside masked value', () => {
    const result = formatEnvTable({ PROBE_OPENAI_API_KEY: 'sk-abc' });
    expect(result).toContain('PROBE_OPENAI_API_KEY');
  });

  it('masks the legacy OPENAI_API_KEY for one-cycle compat', () => {
    const result = formatEnvTable({ OPENAI_API_KEY: 'sk-legacy' });
    expect(result).not.toContain('sk-legacy');
    expect(result).toMatch(/\*/);
  });
});
