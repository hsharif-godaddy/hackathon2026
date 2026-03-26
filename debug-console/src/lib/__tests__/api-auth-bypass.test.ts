import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { shouldBypassAuth } from '../api-auth';

describe('api-auth', () => {
    describe('shouldBypassAuth', () => {
        beforeEach(() => {
            vi.stubEnv('NODE_ENV', '');
            vi.stubEnv('BYPASS_AUTH', '');
        });

        afterEach(() => {
            vi.unstubAllEnvs();
        });

        it('should not bypass in production', () => {
            vi.stubEnv('NODE_ENV', 'production');

            const result = shouldBypassAuth();

            expect(result.bypass).toBe(false);
            expect(result.reason).toBe('production');
        });

        it('should not bypass in production even when BYPASS_AUTH is true', () => {
            vi.stubEnv('NODE_ENV', 'production');
            vi.stubEnv('BYPASS_AUTH', 'true');

            const result = shouldBypassAuth();

            expect(result.bypass).toBe(false);
            expect(result.reason).toBe('production');
        });

        it('should bypass in development', () => {
            vi.stubEnv('NODE_ENV', 'development');

            const result = shouldBypassAuth();

            expect(result.bypass).toBe(true);
            expect(result.reason).toBe('NODE_ENV=development');
        });

        it('should bypass when BYPASS_AUTH is true', () => {
            vi.stubEnv('NODE_ENV', 'test');
            vi.stubEnv('BYPASS_AUTH', 'true');

            const result = shouldBypassAuth();

            expect(result.bypass).toBe(true);
            expect(result.reason).toBe('BYPASS_AUTH flag');
        });

        it('should bypass when BYPASS_AUTH is 1', () => {
            vi.stubEnv('NODE_ENV', 'test');
            vi.stubEnv('BYPASS_AUTH', '1');

            const result = shouldBypassAuth();

            expect(result.bypass).toBe(true);
            expect(result.reason).toBe('BYPASS_AUTH flag');
        });

        it('should not bypass in test without BYPASS_AUTH', () => {
            vi.stubEnv('NODE_ENV', 'test');

            const result = shouldBypassAuth();

            expect(result.bypass).toBe(false);
            expect(result.reason).toBe('no bypass conditions met');
        });

        it('should not bypass with unknown NODE_ENV and no BYPASS_AUTH', () => {
            vi.stubEnv('NODE_ENV', 'staging');

            const result = shouldBypassAuth();

            expect(result.bypass).toBe(false);
            expect(result.reason).toBe('no bypass conditions met');
        });
    });
});
