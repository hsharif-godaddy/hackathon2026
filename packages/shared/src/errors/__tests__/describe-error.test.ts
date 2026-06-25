import { describe, it, expect } from 'vitest';

import { describeError } from '../describe-error.js';

describe('describeError', () => {
  it('returns an empty object for non-Error values', () => {
    expect(describeError('boom')).toEqual({});
    expect(describeError(undefined)).toEqual({});
    expect(describeError({ message: 'not an error' })).toEqual({});
  });

  it('returns name and stack for a plain Error', () => {
    const err = new Error('boom');

    expect(describeError(err)).toEqual({
      name: 'Error',
      stack: err.stack,
    });
  });

  it('includes the system code when present', () => {
    const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

    expect(describeError(err)).toMatchObject({
      name: 'Error',
      code: 'ECONNRESET',
    });
  });

  it('surfaces a nested cause and its code for root-cause triage', () => {
    const cause = Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
    const err = Object.assign(new Error('fetch failed'), { code: 'ECONNRESET', cause });

    expect(describeError(err)).toMatchObject({
      code: 'ECONNRESET',
      cause: expect.stringContaining('connect timeout'),
      causeCode: 'UND_ERR_CONNECT_TIMEOUT',
      causeStack: cause.stack,
    });
  });

  it('omits causeStack for a non-Error cause', () => {
    const err = Object.assign(new Error('wrapped'), { cause: { message: 'plain object' } });

    expect(describeError(err)).not.toHaveProperty('causeStack');
  });

  it('stringifies a non-object cause without a causeCode', () => {
    const err = Object.assign(new Error('wrapped'), { cause: 'raw string cause' });
    const result = describeError(err);

    expect(result.cause).toBe('raw string cause');
    expect(result).not.toHaveProperty('causeCode');
  });

  it('prefers an object cause message and omits causeCode when it has no code', () => {
    const err = Object.assign(new Error('wrapped'), {
      cause: { message: 'downstream failure', detail: 'extra' },
    });
    const result = describeError(err);

    expect(result.cause).toBe('downstream failure');
    expect(result).not.toHaveProperty('causeCode');
  });

  it('returns an empty object instead of throwing when a property getter throws', () => {
    const err = new Error('boom');
    Object.defineProperty(err, 'cause', {
      get() {
        throw new Error('exploding getter');
      },
    });

    expect(() => describeError(err)).not.toThrow();
    expect(describeError(err)).toEqual({});
  });
});
