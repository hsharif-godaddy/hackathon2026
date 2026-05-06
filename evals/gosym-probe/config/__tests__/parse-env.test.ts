import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  parseMaxConcurrency,
  parseMaxTurns,
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
