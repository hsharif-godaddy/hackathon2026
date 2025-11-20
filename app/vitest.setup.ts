import { vi } from 'vitest';

/**
 * Vitest global setup
 * 
 * Configures test environment with mock values and global mocks
 */

// Mock environment variables for V2 control plane
process.env.MGMT_AIRO_BASE_URL = 'https://mgmt.nstk.net';
process.env.MGMT_AIRO_DATACENTER = 'sxb1';
process.env.MGMT_AIRO_PRODUCT_ID = 'aab-v1';
process.env.USE_V2_CONTROL_PLANE = 'true';

// Mock console methods to reduce noise in test output
// Errors and warnings are still captured by vitest for assertion
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock fetch globally (can be overridden in individual tests)
global.fetch = vi.fn();

// jsdom provides sessionStorage and localStorage, but we need to ensure they're cleared between tests
// This will be handled in beforeEach hooks in individual test files

