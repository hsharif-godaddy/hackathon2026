import { describe, it, expect } from 'vitest';
import { confirmProvidersTool } from '../index.js';

describe('online-conferencing tools', function tools() {
  describe('#confirmProvidersTool.execute', function execute() {
    it('returns confirmed with single provider', async function singleProvider() {
      const result = await confirmProvidersTool.execute({ providers: ['google'] });
      expect(result).toEqual({ confirmed: true, providers: ['google'] });
    });

    it('returns confirmed with multiple providers and wiring pattern', async function multiProvider() {
      const result = await confirmProvidersTool.execute({
        providers: ['google', 'zoom'],
        wiringPattern: 'single-default',
      });
      expect(result).toEqual({
        confirmed: true,
        providers: ['google', 'zoom'],
        wiringPattern: 'single-default',
      });
    });

    it('omits wiringPattern key when not provided', async function noPattern() {
      const result = await confirmProvidersTool.execute({ providers: ['zoom'] });
      expect(result).not.toHaveProperty('wiringPattern');
    });
  });

  describe('#confirmProvidersTool.computeState', function computeState() {
    it('returns providers for a single-provider confirmation', function singleState() {
      const state = confirmProvidersTool.computeState?.(
        { providers: ['zoom'] },
        { confirmed: true, providers: ['zoom'] },
      );
      expect(state).toEqual({ providers: ['zoom'] });
    });

    it('includes wiringPattern when present', function withPattern() {
      const state = confirmProvidersTool.computeState?.(
        { providers: ['google', 'teams'], wiringPattern: 'user-picks' },
        { confirmed: true, providers: ['google', 'teams'], wiringPattern: 'user-picks' },
      );
      expect(state).toEqual({ providers: ['google', 'teams'], wiringPattern: 'user-picks' });
    });

    it('omits wiringPattern key when not provided', function withoutPattern() {
      const state = confirmProvidersTool.computeState?.(
        { providers: ['google'] },
        { confirmed: true, providers: ['google'] },
      );
      expect(state).not.toHaveProperty('wiringPattern');
    });

    it('returns null when output.confirmed is false', function notConfirmed() {
      const state = confirmProvidersTool.computeState?.(
        { providers: ['zoom'] },
        { confirmed: false },
      );
      expect(state).toBeNull();
    });

    it('captures all three providers with fallback-chain pattern', function allProviders() {
      const state = confirmProvidersTool.computeState?.(
        { providers: ['google', 'zoom', 'teams'], wiringPattern: 'fallback-chain' },
        { confirmed: true, providers: ['google', 'zoom', 'teams'], wiringPattern: 'fallback-chain' },
      );
      expect(state).toEqual({
        providers: ['google', 'zoom', 'teams'],
        wiringPattern: 'fallback-chain',
      });
    });
  });

  describe('parameter schema validation', function schema() {
    it('rejects empty providers array', function emptyProviders() {
      expect(() =>
        confirmProvidersTool.parameters.parse({ providers: [] }),
      ).toThrow();
    });

    it('rejects unknown provider values', function unknownProvider() {
      expect(() =>
        confirmProvidersTool.parameters.parse({ providers: ['slack'] }),
      ).toThrow();
    });

    it('rejects unknown wiring patterns', function unknownPattern() {
      expect(() =>
        confirmProvidersTool.parameters.parse({
          providers: ['zoom'],
          wiringPattern: 'round-robin',
        }),
      ).toThrow();
    });

    it('accepts all valid provider combinations', function validProviders() {
      expect(() =>
        confirmProvidersTool.parameters.parse({ providers: ['google', 'zoom', 'teams'] }),
      ).not.toThrow();
    });

    it('accepts all valid wiring patterns', function validPatterns() {
      const patterns = ['single-default', 'per-feature', 'user-picks', 'fallback-chain'] as const;
      for (const wiringPattern of patterns) {
        expect(() =>
          confirmProvidersTool.parameters.parse({ providers: ['zoom'], wiringPattern }),
        ).not.toThrow();
      }
    });
  });
});
