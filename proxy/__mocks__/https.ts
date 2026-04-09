import { vi } from 'vitest';

interface MockServer {
  listen: (port: number, host: string, callback?: () => void) => MockServer;
  close: (callback?: () => void) => void;
  on: ReturnType<typeof vi.fn>;
}

const mockServer: MockServer = {
  listen: vi.fn((port: number, host: string, callback?: () => void) => {
    if (callback) callback();
    return mockServer;
  }),
  close: vi.fn((callback?: () => void) => {
    if (callback) callback();
  }),
  on: vi.fn()
};

export const createServer = vi.fn(() => mockServer);

export default { createServer };
