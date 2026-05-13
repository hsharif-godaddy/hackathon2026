import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DevSupervisorClient } from '../../../services/DevSupervisorClient.js';
import { HttpDiagnostics } from '../http-diagnostics.js';
import { WorkspaceNotImplementedError, WorkspaceValidationError } from '../../errors.js';

function makeClient() {
  return { getLogs: vi.fn() } as unknown as DevSupervisorClient;
}

describe('HttpDiagnostics', () => {
  let client: DevSupervisorClient;
  let diag: HttpDiagnostics;

  beforeEach(() => {
    client = makeClient();
    diag = new HttpDiagnostics(client);
  });

  it('logs() forwards source, lines, and since (ISO string)', async () => {
    (client.getLogs as any).mockResolvedValue([
      { timestamp: '2026-05-08T10:00:00Z', source: 'stdout', level: 'info', message: 'ready' },
    ]);

    const since = new Date('2026-05-08T09:00:00Z');
    const result = await diag.logs({ source: 'stdout', lines: 50, since });

    expect(client.getLogs).toHaveBeenCalledWith({
      source: 'stdout',
      lines: 50,
      since: since.toISOString(),
    });
    expect(result[0].timestamp).toBeInstanceOf(Date);
  });

  it('logs() with no query forwards an empty object', async () => {
    (client.getLogs as any).mockResolvedValue([]);
    expect(await diag.logs()).toEqual([]);
    expect(client.getLogs).toHaveBeenCalledWith({});
  });

  it('logs() throws WorkspaceValidationError when until is supplied', async () => {
    await expect(diag.logs({ until: new Date() })).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('logs() throws WorkspaceValidationError when filterPattern is supplied', async () => {
    await expect(diag.logs({ filterPattern: 'boom' })).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('errors() throws WorkspaceNotImplementedError', async () => {
    await expect(diag.errors()).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
  });

  it('runtimeSummary() throws WorkspaceNotImplementedError', async () => {
    await expect(diag.runtimeSummary()).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
  });
});
