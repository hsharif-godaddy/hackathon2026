import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RebuildOrchestrationService } from '../RebuildOrchestrationService.js';
import { defaultIntakeChoices } from '../rebuild/intake-defaults.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => mockLogger,
  },
  logger: mockLogger,
}));

describe('RebuildOrchestrationService intake', () => {
  let appDir: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    appDir = await mkdtemp(path.join(tmpdir(), 'rebuild-intake-test-'));
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
  });

  it('beginRebuild writes awaiting_intake state without starting scrape', async () => {
    const service = new RebuildOrchestrationService(appDir);
    const state = await service.beginRebuild('app-123', 'https://example.com');

    expect(state.status).toBe('awaiting_intake');
    expect(state.sourceUrl).toBe('https://example.com');
    expect(state.intakeCompleted).toBeUndefined();

    const onDisk = JSON.parse(
      await readFile(path.join(appDir, '.source-site', 'workflow-state.json'), 'utf-8'),
    );
    expect(onDisk.status).toBe('awaiting_intake');
  });

  it('submitIntake stores scope and preferences then moves to scraping', async () => {
    const service = new RebuildOrchestrationService(appDir);
    await service.beginRebuild('app-123', 'https://example.com');

    const choices = {
      scope: 'small' as const,
      stylePreferences: {
        ...defaultIntakeChoices().stylePreferences,
        designDirection: 'modernize' as const,
      },
    };
    const state = await service.submitIntake('app-123', choices);

    expect(state.status).toBe('scraping');
    expect(state.rebuildScope).toBe('small');
    expect(state.intakeCompleted).toBe(true);
    expect(state.stylePreferences?.designDirection).toBe('modernize');
  });

  it('submitIntake rejects when not awaiting_intake', async () => {
    const service = new RebuildOrchestrationService(appDir);
    await service.startRebuild('app-123', 'https://example.com');

    await expect(service.submitIntake('app-123', defaultIntakeChoices())).rejects.toThrow(
      /Cannot submit intake/,
    );
  });

  it('submitDefaultIntake applies homepage_only and modernize defaults', async () => {
    const service = new RebuildOrchestrationService(appDir);
    await service.beginRebuild('app-123', 'https://example.com');

    const state = await service.submitDefaultIntake('app-123');

    expect(state.rebuildScope).toBe('homepage_only');
    expect(state.stylePreferences?.designDirection).toBe('modernize');
    expect(state.status).toBe('scraping');
  });
});
