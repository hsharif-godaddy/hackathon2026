/**
 * PKCE Utilities Test Suite
 *
 * Comprehensive tests for PKCE (Proof Key for Code Exchange) cryptographic utilities:
 * - Base64url encoding (RFC 4648)
 * - Code verifier generation (RFC 7636)
 * - Code challenge generation (S256 method)
 * - State parameter generation (CSRF protection)
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
    base64url,
    generateCodeVerifier,
    generateCodeChallenge,
    generateState,
} from '../pkce-utils.js';

describe('PKCE Utilities', () => {
    describe('base64url', () => {
        it('should convert Buffer to base64url format', () => {
            const buffer = Buffer.from('hello world');
            const result = base64url(buffer);

            // Base64url should not contain +, /, or = characters
            expect(result).not.toMatch(/[+/=]/);
            expect(typeof result).toBe('string');
        });

        it('should handle standard base64 to base64url conversions', () => {
            // Standard base64 can have +, /, and = characters
            // Base64url replaces: + with -, / with _, removes padding =
            const buffer = Buffer.from('subjects?_d');
            const result = base64url(buffer);

            expect(result).toBe('c3ViamVjdHM_X2Q');
            expect(result).not.toContain('=');
        });

        it('should handle empty buffer', () => {
            const buffer = Buffer.from('');
            const result = base64url(buffer);

            expect(result).toBe('');
        });

        it('should produce URL-safe output', () => {
            // Test with binary data that would produce + and / in standard base64
            const buffer = Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb]);
            const result = base64url(buffer);

            // Should be URL-safe (no special characters that need encoding)
            expect(result).toMatch(/^[A-Za-z0-9_-]*$/);
        });

        it('should be reversible (encode/decode)', () => {
            const original = 'test data for encoding';
            const buffer = Buffer.from(original);
            const encoded = base64url(buffer);

            // Decode by reversing the base64url transformation
            const standardBase64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
            const padding = (4 - (standardBase64.length % 4)) % 4;
            const paddedBase64 = standardBase64 + '='.repeat(padding);
            const decoded = Buffer.from(paddedBase64, 'base64').toString('utf-8');

            expect(decoded).toBe(original);
        });
    });

    describe('generateCodeVerifier', () => {
        it('should generate a 43-character string', () => {
            const verifier = generateCodeVerifier();

            expect(verifier).toHaveLength(43);
        });

        it('should only contain base64url characters', () => {
            const verifier = generateCodeVerifier();

            // Base64url alphabet: A-Z, a-z, 0-9, -, _
            expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it('should generate unique values on each call', () => {
            const verifier1 = generateCodeVerifier();
            const verifier2 = generateCodeVerifier();
            const verifier3 = generateCodeVerifier();

            expect(verifier1).not.toBe(verifier2);
            expect(verifier2).not.toBe(verifier3);
            expect(verifier1).not.toBe(verifier3);
        });

        it('should generate cryptographically random values', () => {
            // Generate multiple verifiers and ensure they're all different
            const verifiers = new Set<string>();
            const iterations = 100;

            for (let i = 0; i < iterations; i++) {
                verifiers.add(generateCodeVerifier());
            }

            // All 100 should be unique
            expect(verifiers.size).toBe(iterations);
        });

        it('should use 32 random bytes (43 chars in base64url)', () => {
            const verifier = generateCodeVerifier();

            // 32 bytes = 256 bits
            // Base64 encoding of 32 bytes = ceil(32 * 8 / 6) = 43 characters
            // (Base64 uses 6 bits per character)
            expect(verifier).toHaveLength(43);
        });

        it('should meet RFC 7636 requirements (43-128 chars)', () => {
            const verifier = generateCodeVerifier();

            expect(verifier.length).toBeGreaterThanOrEqual(43);
            expect(verifier.length).toBeLessThanOrEqual(128);
        });
    });

    describe('generateCodeChallenge', () => {
        it('should generate base64url encoded SHA256 hash', () => {
            const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
            const challenge = generateCodeChallenge(verifier);

            // SHA256 hash is 32 bytes = 43 chars in base64url
            expect(challenge).toHaveLength(43);
            expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it('should produce deterministic output for same input', () => {
            const verifier = generateCodeVerifier();
            const challenge1 = generateCodeChallenge(verifier);
            const challenge2 = generateCodeChallenge(verifier);

            expect(challenge1).toBe(challenge2);
        });

        it('should produce different challenges for different verifiers', () => {
            const verifier1 = generateCodeVerifier();
            const verifier2 = generateCodeVerifier();

            const challenge1 = generateCodeChallenge(verifier1);
            const challenge2 = generateCodeChallenge(verifier2);

            expect(challenge1).not.toBe(challenge2);
        });

        it('should match RFC 7636 example', () => {
            // Example from RFC 7636 Appendix B
            const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
            const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

            const challenge = generateCodeChallenge(verifier);

            expect(challenge).toBe(expectedChallenge);
        });

        it('should handle empty string verifier', () => {
            const challenge = generateCodeChallenge('');

            // SHA256 of empty string in base64url
            expect(challenge).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
        });

        it('should produce valid base64url output', () => {
            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);

            // Should not contain +, /, or =
            expect(challenge).not.toMatch(/[+/=]/);
        });

        it('should be compatible with manual SHA256 calculation', () => {
            const verifier = 'test-verifier-string';
            const challenge = generateCodeChallenge(verifier);

            // Manually calculate SHA256
            const hash = createHash('sha256').update(verifier).digest();
            const manualChallenge = base64url(hash);

            expect(challenge).toBe(manualChallenge);
        });
    });

    describe('generateState', () => {
        it('should generate a valid UUID v4', () => {
            const state = generateState();

            // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
            // where y is one of [8, 9, a, b]
            const uuidV4Regex =
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

            expect(state).toMatch(uuidV4Regex);
        });

        it('should generate unique values on each call', () => {
            const state1 = generateState();
            const state2 = generateState();
            const state3 = generateState();

            expect(state1).not.toBe(state2);
            expect(state2).not.toBe(state3);
            expect(state1).not.toBe(state3);
        });

        it('should generate cryptographically random UUIDs', () => {
            const states = new Set<string>();
            const iterations = 100;

            for (let i = 0; i < iterations; i++) {
                states.add(generateState());
            }

            // All 100 should be unique
            expect(states.size).toBe(iterations);
        });

        it('should return a string', () => {
            const state = generateState();

            expect(typeof state).toBe('string');
        });

        it('should have 36 characters (UUID format with hyphens)', () => {
            const state = generateState();

            expect(state).toHaveLength(36);
        });
    });

    describe('Integration Tests', () => {
        it('should generate valid verifier/challenge pairs', () => {
            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);

            expect(verifier).toHaveLength(43);
            expect(challenge).toHaveLength(43);
            expect(verifier).not.toBe(challenge);
        });

        it('should generate complete PKCE parameters', () => {
            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);
            const state = generateState();

            // All should be unique
            expect(verifier).not.toBe(challenge);
            expect(verifier).not.toBe(state);
            expect(challenge).not.toBe(state);

            // All should be valid formats
            expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
            expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
            expect(state).toMatch(/^[0-9a-f-]+$/i);
        });

        it('should support full PKCE flow', () => {
            // Step 1: Client generates verifier and challenge
            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);
            const state = generateState();

            // Store verifier and state (client-side)
            const clientStorage = { verifier, state };

            // Step 2: Send challenge and state to authorization server
            const authRequest = { code_challenge: challenge, state };

            // Step 3: Verify challenge can be regenerated from verifier
            const verifiedChallenge = generateCodeChallenge(clientStorage.verifier);

            expect(verifiedChallenge).toBe(authRequest.code_challenge);
            expect(clientStorage.state).toBe(authRequest.state);
        });
    });

    describe('RFC 7636 Compliance', () => {
        it('should meet code verifier length requirements', () => {
            const verifier = generateCodeVerifier();

            // RFC 7636: code_verifier = 43*128unreserved
            expect(verifier.length).toBeGreaterThanOrEqual(43);
            expect(verifier.length).toBeLessThanOrEqual(128);
        });

        it('should use S256 challenge method (SHA256)', () => {
            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);

            // Verify it's SHA256 by comparing with manual hash
            const expectedChallenge = base64url(createHash('sha256').update(verifier).digest());

            expect(challenge).toBe(expectedChallenge);
        });

        it('should only use unreserved characters in verifier', () => {
            const verifier = generateCodeVerifier();

            // RFC 7636 unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
            // Base64url uses: ALPHA / DIGIT / "-" / "_"
            expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
        });
    });
});
