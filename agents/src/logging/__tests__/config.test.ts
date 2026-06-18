import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('getProductIdForConfig', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    tempDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    process.env.NOMAD_ALLOC_DIR = tempDir;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  function writeConfig(data: Record<string, unknown>) {
    writeFileSync(join(tempDir, 'config.json'), JSON.stringify(data));
  }

  it('returns notfound when config file does not exist', async () => {
    process.env.NOMAD_ALLOC_DIR = join(tempDir, 'nonexistent');
    const { getProductIdForConfig } = await import('../config.js');
    expect(getProductIdForConfig()).toBe('notfound');
  });

  it('returns product ID when configured', async () => {
    writeConfig({ PRODUCT_ID: { SYSTEM_MANAGED: true, VALUE: 'paas-nodejs-v1' } });
    const { getProductIdForConfig } = await import('../config.js');
    expect(getProductIdForConfig()).toBe('paas-nodejs-v1');
  });

  it('returns notfound when PRODUCT_ID value is empty string', async () => {
    writeConfig({ PRODUCT_ID: { SYSTEM_MANAGED: true, VALUE: '' } });
    const { getProductIdForConfig } = await import('../config.js');
    expect(getProductIdForConfig()).toBe('notfound');
  });

  it('returns notfound when config file has invalid JSON', async () => {
    writeFileSync(join(tempDir, 'config.json'), '{invalid json}');
    const { getProductIdForConfig } = await import('../config.js');
    expect(getProductIdForConfig()).toBe('notfound');
  });

  it('does not cache notfound — picks up late-arriving config', async () => {
    process.env.NOMAD_ALLOC_DIR = join(tempDir, 'late-arrival');
    const latePath = join(tempDir, 'late-arrival');
    mkdirSync(latePath, { recursive: true });

    const { getProductIdForConfig } = await import('../config.js');
    expect(getProductIdForConfig()).toBe('notfound');

    writeFileSync(join(latePath, 'config.json'), JSON.stringify({
      PRODUCT_ID: { SYSTEM_MANAGED: true, VALUE: 'late-value' },
    }));

    expect(getProductIdForConfig()).toBe('late-value');
  });

  it('returns cached value within 5s TTL', async () => {
    vi.useFakeTimers();

    writeConfig({ PRODUCT_ID: { SYSTEM_MANAGED: true, VALUE: 'original' } });
    const { getProductIdForConfig } = await import('../config.js');

    expect(getProductIdForConfig()).toBe('original');

    writeConfig({ PRODUCT_ID: { SYSTEM_MANAGED: true, VALUE: 'updated' } });
    vi.advanceTimersByTime(3_000);

    expect(getProductIdForConfig()).toBe('original');
  });

  it('re-reads file after 5s TTL expires', async () => {
    vi.useFakeTimers();

    writeConfig({ PRODUCT_ID: { SYSTEM_MANAGED: true, VALUE: 'v1' } });
    const { getProductIdForConfig } = await import('../config.js');

    expect(getProductIdForConfig()).toBe('v1');

    writeConfig({ PRODUCT_ID: { SYSTEM_MANAGED: true, VALUE: 'v2' } });
    vi.advanceTimersByTime(5_001);

    expect(getProductIdForConfig()).toBe('v2');
  });

  it('does not include productId in static logger context', async () => {
    writeConfig({ PRODUCT_ID: { SYSTEM_MANAGED: true, VALUE: 'paas-nodejs-v1' } });
    const { createConfigFromEnvironment } = await import('../config.js');
    const config = createConfigFromEnvironment();
    expect(config.context?.productId).toBeUndefined();
  });
});
