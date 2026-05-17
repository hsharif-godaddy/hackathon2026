import { describe, it, expect, vi } from 'vitest';
import type { DevSupervisorClient } from '../../../services/DevSupervisorClient.js';
import { HttpWorkspaceClient } from '../http-workspace-client.js';
import { WorkspaceNotImplementedError } from '../../errors.js';

function makeClient() {
  return {
    exec: vi.fn(),
    getLogs: vi.fn(),
    getProcessStatus: vi.fn(),
    getHealthStatus: vi.fn(),
    getRestartStats: vi.fn(),
    restartProcess: vi.fn(),
    stopProcess: vi.fn(),
    configureHealthCheck: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
    getPublishStatus: vi.fn(),
  } as unknown as DevSupervisorClient;
}

describe('HttpWorkspaceClient', () => {
  it('exposes workspaceId and variant', () => {
    const wsc = new HttpWorkspaceClient('wksp-1', 'preview', makeClient());
    expect(wsc.workspaceId).toBe('wksp-1');
    expect(wsc.variant).toBe('preview');
  });

  it('exposes all nine sub-adapters as properties', () => {
    const wsc = new HttpWorkspaceClient('wksp-1', 'preview', makeClient());
    expect(wsc.files).toBeDefined();
    expect(wsc.tasks).toBeDefined();
    expect(wsc.runtime).toBeDefined();
    expect(wsc.diagnostics).toBeDefined();
    expect(wsc.artifacts).toBeDefined();
    expect(wsc.imports).toBeDefined();
    expect(wsc.deployments).toBeDefined();
    expect(wsc.versionControl).toBeDefined();
    expect(wsc.config).toBeDefined();
  });

  it('summary() throws WorkspaceNotImplementedError', async () => {
    const wsc = new HttpWorkspaceClient('wksp-1', 'preview', makeClient());
    await expect(wsc.summary()).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
  });

  it('capabilities() on preview reports method-level availability', async () => {
    const wsc = new HttpWorkspaceClient('wksp-1', 'preview', makeClient());
    const caps = await wsc.capabilities();

    expect(caps.methods['runtime.status']).toBe('live');
    expect(caps.methods['runtime.restart']).toBe('live');
    expect(caps.methods['diagnostics.logs']).toBe('live');
    expect(caps.methods['tasks.runCommandSync']).toBe('live');

    expect(caps.methods['files.tree']).toBe('live');
    expect(caps.methods['files.edit']).toBe('live');

    expect(caps.methods['runtime.start']).toBe('stubbed');
    expect(caps.methods['deployments.prepare']).toBe('stubbed');

    expect(caps.methods['deployments.activate']).toBe('variant-not-applicable');
    expect(caps.methods['deployments.status']).toBe('variant-not-applicable');
    expect(caps.methods['deployments.unpublish']).toBe('variant-not-applicable');

    expect(caps.versions.runtime).toBeDefined();
  });

  it('capabilities() on publish reports method-level availability', async () => {
    const wsc = new HttpWorkspaceClient('wksp-1', 'publish', makeClient());
    const caps = await wsc.capabilities();

    expect(caps.methods['runtime.status']).toBe('live');
    expect(caps.methods['diagnostics.logs']).toBe('live');
    expect(caps.methods['deployments.status']).toBe('live');
    expect(caps.methods['deployments.unpublish']).toBe('live');
    expect(caps.methods['tasks.runCommandSync']).toBe('live');

    expect(caps.methods['deployments.activate']).toBe('stubbed');

    expect(caps.methods['deployments.prepare']).toBe('variant-not-applicable');
    expect(caps.methods['imports.start']).toBe('variant-not-applicable');
    expect(caps.methods['versionControl.checkpoint']).toBe('variant-not-applicable');
    expect(caps.methods['config.upsertEnv']).toBe('variant-not-applicable');

    expect(caps.versions.deployments).toBeDefined();
  });
});
