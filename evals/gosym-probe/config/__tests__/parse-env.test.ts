import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  parseAgentsPort,
  parseMaxConcurrency,
  parseMaxTurns,
  parseTurnTimeoutMs,
  parseCaptureConcurrency,
  parseMaxRoutes,
} from '../environments/parse-env.js';

describe('parseMaxConcurrency', () => {
  const saved = process.env.MAX_CONCURRENCY;

  beforeEach(() => {
    delete process.env.MAX_CONCURRENCY;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.MAX_CONCURRENCY;
    } else {
      process.env.MAX_CONCURRENCY = saved;
    }
  });

  it('returns fallback when env var is unset', () => {
    expect(parseMaxConcurrency(5)).toBe(5);
  });

  it('returns fallback when env var is empty', () => {
    process.env.MAX_CONCURRENCY = '';
    expect(parseMaxConcurrency(5)).toBe(5);
  });

  it('returns parsed integer when valid', () => {
    process.env.MAX_CONCURRENCY = '8';
    expect(parseMaxConcurrency(5)).toBe(8);
  });

  it('returns fallback when env var is non-numeric', () => {
    process.env.MAX_CONCURRENCY = 'abc';
    expect(parseMaxConcurrency(5)).toBe(5);
  });

  it('returns fallback when env var is zero', () => {
    process.env.MAX_CONCURRENCY = '0';
    expect(parseMaxConcurrency(5)).toBe(5);
  });

  it('returns fallback when env var is negative', () => {
    process.env.MAX_CONCURRENCY = '-3';
    expect(parseMaxConcurrency(5)).toBe(5);
  });
});

describe('parseMaxTurns', () => {
  const saved = process.env.MAX_TURNS;

  beforeEach(() => {
    delete process.env.MAX_TURNS;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.MAX_TURNS;
    } else {
      process.env.MAX_TURNS = saved;
    }
  });

  it('returns fallback when env var is unset', () => {
    expect(parseMaxTurns(30)).toBe(30);
  });

  it('returns fallback when env var is empty', () => {
    process.env.MAX_TURNS = '';
    expect(parseMaxTurns(30)).toBe(30);
  });

  it('returns parsed integer when valid', () => {
    process.env.MAX_TURNS = '10';
    expect(parseMaxTurns(30)).toBe(10);
  });

  it('returns fallback when env var is non-numeric', () => {
    process.env.MAX_TURNS = 'abc';
    expect(parseMaxTurns(30)).toBe(30);
  });

  it('returns fallback when env var is zero', () => {
    process.env.MAX_TURNS = '0';
    expect(parseMaxTurns(30)).toBe(30);
  });

  it('returns fallback when env var is negative', () => {
    process.env.MAX_TURNS = '-5';
    expect(parseMaxTurns(30)).toBe(30);
  });
});

describe('parseTurnTimeoutMs', () => {
  const saved = process.env.TURN_TIMEOUT_MS;

  beforeEach(() => {
    delete process.env.TURN_TIMEOUT_MS;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.TURN_TIMEOUT_MS;
    } else {
      process.env.TURN_TIMEOUT_MS = saved;
    }
  });

  it('returns fallback when env var is unset', () => {
    expect(parseTurnTimeoutMs(1_200_000)).toBe(1_200_000);
  });

  it('returns fallback when env var is empty', () => {
    process.env.TURN_TIMEOUT_MS = '';
    expect(parseTurnTimeoutMs(1_200_000)).toBe(1_200_000);
  });

  it('returns parsed integer when valid', () => {
    process.env.TURN_TIMEOUT_MS = '2400000';
    expect(parseTurnTimeoutMs(1_200_000)).toBe(2_400_000);
  });

  it('returns fallback when env var is non-numeric', () => {
    process.env.TURN_TIMEOUT_MS = 'abc';
    expect(parseTurnTimeoutMs(1_200_000)).toBe(1_200_000);
  });

  it('returns fallback when env var is zero', () => {
    process.env.TURN_TIMEOUT_MS = '0';
    expect(parseTurnTimeoutMs(1_200_000)).toBe(1_200_000);
  });

  it('returns fallback when env var is negative', () => {
    process.env.TURN_TIMEOUT_MS = '-5';
    expect(parseTurnTimeoutMs(1_200_000)).toBe(1_200_000);
  });
});

describe('parseCaptureConcurrency', () => {
  const saved = process.env.CAPTURE_CONCURRENCY;

  beforeEach(() => {
    delete process.env.CAPTURE_CONCURRENCY;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.CAPTURE_CONCURRENCY;
    } else {
      process.env.CAPTURE_CONCURRENCY = saved;
    }
  });

  it('returns fallback when env var is unset', () => {
    expect(parseCaptureConcurrency(2)).toBe(2);
  });

  it('returns parsed integer when valid', () => {
    process.env.CAPTURE_CONCURRENCY = '4';
    expect(parseCaptureConcurrency(2)).toBe(4);
  });

  it('returns fallback when env var is non-numeric', () => {
    process.env.CAPTURE_CONCURRENCY = 'abc';
    expect(parseCaptureConcurrency(2)).toBe(2);
  });

  it('returns fallback when env var is zero', () => {
    process.env.CAPTURE_CONCURRENCY = '0';
    expect(parseCaptureConcurrency(2)).toBe(2);
  });
});

describe('parseMaxRoutes', () => {
  const saved = process.env.MAX_ROUTES;

  beforeEach(() => {
    delete process.env.MAX_ROUTES;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.MAX_ROUTES;
    } else {
      process.env.MAX_ROUTES = saved;
    }
  });

  it('returns fallback when env var is unset', () => {
    expect(parseMaxRoutes(20)).toBe(20);
  });

  it('returns parsed integer when valid', () => {
    process.env.MAX_ROUTES = '5';
    expect(parseMaxRoutes(20)).toBe(5);
  });

  it('returns fallback when env var is non-numeric', () => {
    process.env.MAX_ROUTES = 'abc';
    expect(parseMaxRoutes(20)).toBe(20);
  });

  it('returns fallback when env var is negative', () => {
    process.env.MAX_ROUTES = '-1';
    expect(parseMaxRoutes(20)).toBe(20);
  });
});

describe('parseAgentsPort', () => {
  const saved = process.env.AGENTS_PORT;

  beforeEach(() => {
    delete process.env.AGENTS_PORT;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.AGENTS_PORT;
    } else {
      process.env.AGENTS_PORT = saved;
    }
  });

  it('returns fallback when env var is unset', () => {
    expect(parseAgentsPort(4000)).toBe(4000);
  });

  it('returns fallback when env var is empty', () => {
    process.env.AGENTS_PORT = '';
    expect(parseAgentsPort(4000)).toBe(4000);
  });

  it('returns parsed integer when valid', () => {
    process.env.AGENTS_PORT = '4040';
    expect(parseAgentsPort(4000)).toBe(4040);
  });

  it('returns fallback when env var is non-numeric', () => {
    process.env.AGENTS_PORT = 'abc';
    expect(parseAgentsPort(4000)).toBe(4000);
  });

  it('returns fallback when env var is zero', () => {
    process.env.AGENTS_PORT = '0';
    expect(parseAgentsPort(4000)).toBe(4000);
  });

  it('returns fallback when env var is negative', () => {
    process.env.AGENTS_PORT = '-1';
    expect(parseAgentsPort(4000)).toBe(4000);
  });
});
