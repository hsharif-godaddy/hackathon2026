import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DevSupervisorClient } from '../../../services/DevSupervisorClient.js';
import { HttpSetup } from '../http-setup.js';

function makeClient() {
  return {
    getSetupStatus: vi.fn(),
    executeSetup: vi.fn(),
  } as unknown as DevSupervisorClient;
}

describe('HttpSetup', () => {
  let client: DevSupervisorClient;
  let setup: HttpSetup;

  beforeEach(() => {
    client = makeClient();
    setup = new HttpSetup(client);
  });

  describe('getStatus()', () => {
    it('maps snake_case wire fields to camelCase SetupStatus', async () => {
      (client.getSetupStatus as any).mockResolvedValue({
        setup_configured: true,
        setup_deferred: true,
        setup_executed: false,
        setup_running: false,
        setup_error: null,
      });

      const status = await setup.getStatus();

      expect(status).toEqual({
        configured: true,
        deferred: true,
        executed: false,
        running: false,
        error: null,
      });
    });

    it('passes through error string from wire', async () => {
      (client.getSetupStatus as any).mockResolvedValue({
        setup_configured: true,
        setup_deferred: true,
        setup_executed: false,
        setup_running: false,
        setup_error: 'script exited with code 1',
      });

      const status = await setup.getStatus();

      expect(status.error).toBe('script exited with code 1');
    });

    it('propagates client errors', async () => {
      (client.getSetupStatus as any).mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(setup.getStatus()).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('execute()', () => {
    it('returns the status field from executeSetup response', async () => {
      (client.executeSetup as any).mockResolvedValue({ status: 'executed' });

      const result = await setup.execute();

      expect(result).toBe('executed');
    });

    it('returns already_executed when setup was previously run', async () => {
      (client.executeSetup as any).mockResolvedValue({ status: 'already_executed' });

      const result = await setup.execute();

      expect(result).toBe('already_executed');
    });

    it('returns not_configured when no setup script exists', async () => {
      (client.executeSetup as any).mockResolvedValue({ status: 'not_configured' });

      const result = await setup.execute();

      expect(result).toBe('not_configured');
    });

    it('propagates client errors', async () => {
      (client.executeSetup as any).mockRejectedValue(new Error('timeout'));

      await expect(setup.execute()).rejects.toThrow('timeout');
    });
  });
});
