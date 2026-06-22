import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFindById = vi.fn();

vi.mock('../../database/index.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () {
    return { findById: mockFindById };
  }),
}));

vi.mock('../../services/DevSupervisorClient.js', () => ({
  createDevSupervisorClient: vi.fn().mockReturnValue({ mock: true }),
  isDevSupervisorAvailable: vi.fn().mockReturnValue(true),
  DevSupervisorClient: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

import { existsSync } from 'node:fs';
import { createDevSupervisorClient } from '../../services/DevSupervisorClient.js';
import { DevSupervisorClientFactory } from '../dev-supervisor-client-factory.js';

const mockExistsSync = vi.mocked(existsSync);
const mockCreateClient = vi.mocked(createDevSupervisorClient);

describe('DevSupervisorClientFactory.createForPublishSupervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
  });

  afterEach(() => {
    delete process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH;
  });

  it('prefers env-var socket path over DB path', () => {
    process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = '/tmp/publish.sock';
    mockExistsSync.mockReturnValue(true);
    mockFindById.mockReturnValue({ publishSupervisorPath: '/db/path.sock' });

    DevSupervisorClientFactory.createForPublishSupervisor('app-1');

    expect(mockCreateClient).toHaveBeenCalledWith('/tmp/publish.sock');
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('falls back to DB path when env-var socket does not exist on disk', () => {
    process.env.AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH = '/tmp/missing.sock';
    mockExistsSync.mockReturnValue(false);
    mockFindById.mockReturnValue({ publishSupervisorPath: '/db/path.sock' });

    DevSupervisorClientFactory.createForPublishSupervisor('app-1');

    expect(mockCreateClient).toHaveBeenCalledWith('/db/path.sock');
  });

  it('falls back to DB path when env-var is not set', () => {
    mockFindById.mockReturnValue({ publishSupervisorPath: '/db/path.sock' });

    DevSupervisorClientFactory.createForPublishSupervisor('app-1');

    expect(mockCreateClient).toHaveBeenCalledWith('/db/path.sock');
  });

  it('returns null when no env-var and no DB path', () => {
    mockFindById.mockReturnValue({ publishSupervisorPath: null });

    const result = DevSupervisorClientFactory.createForPublishSupervisor('app-1');

    expect(result).toBeNull();
  });

  it('throws when app not found and no env-var socket', () => {
    mockFindById.mockReturnValue(null);

    expect(() => DevSupervisorClientFactory.createForPublishSupervisor('missing')).toThrow(
      'App with ID missing not found'
    );
  });
});
