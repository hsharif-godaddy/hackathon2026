const https = jest.createMockFromModule<typeof import('https')>('https');

interface MockServer {
  listen: (port: number, host: string, callback?: () => void) => MockServer;
  close: (callback?: () => void) => void;
  on: jest.Mock;
}

const mockServer: MockServer = {
  listen: jest.fn((port: number, host: string, callback?: () => void) => {
    if (callback) callback();
    return mockServer;
  }),
  close: jest.fn((callback?: () => void) => {
    if (callback) callback();
  }),
  on: jest.fn()
};

(https.createServer as jest.Mock) = jest.fn(() => mockServer);

module.exports = https;
