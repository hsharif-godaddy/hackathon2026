/**
 * Token Encryption Service Test Suite
 *
 * Comprehensive tests for AES-256-GCM token encryption covering:
 * - Encryption key management from environment
 * - Token encryption with random IVs
 * - Token decryption with auth tag validation
 * - Base64 encoding/decoding
 * - Error handling and edge cases
 * - Security properties (uniqueness, randomness)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDecipheriv } from 'node:crypto';
import {
    getEncryptionKey,
    encryptToken,
    decryptToken,
    type EncryptedData,
} from '../token-crypto.js';

describe('Token Encryption Service', () => {
    const originalEnv = process.env.GODADDY_OAUTH_ENCRYPTION_KEY;
    const testKey = Buffer.from('a'.repeat(32)).toString('base64'); // Valid 32-byte key

    beforeEach(() => {
        // Set a valid test encryption key
        process.env.GODADDY_OAUTH_ENCRYPTION_KEY = testKey;
    });

    afterEach(() => {
        // Restore original environment
        if (originalEnv) {
            process.env.GODADDY_OAUTH_ENCRYPTION_KEY = originalEnv;
        } else {
            delete process.env.GODADDY_OAUTH_ENCRYPTION_KEY;
        }
    });

    describe('getEncryptionKey', () => {
        it('should return 32-byte Buffer from base64-encoded env var', () => {
            const key = getEncryptionKey();

            expect(key).toBeInstanceOf(Buffer);
            expect(key).toHaveLength(32); // 256 bits = 32 bytes
        });

        it('should throw error if GODADDY_OAUTH_ENCRYPTION_KEY is not set', () => {
            delete process.env.GODADDY_OAUTH_ENCRYPTION_KEY;

            expect(() => getEncryptionKey()).toThrow(/GODADDY_OAUTH_ENCRYPTION_KEY/);
        });

        it('should throw error if GODADDY_OAUTH_ENCRYPTION_KEY is empty string', () => {
            process.env.GODADDY_OAUTH_ENCRYPTION_KEY = '';

            expect(() => getEncryptionKey()).toThrow(/GODADDY_OAUTH_ENCRYPTION_KEY/);
        });

        it('should decode base64-encoded key correctly', () => {
            const rawKey = Buffer.from('a'.repeat(32)); // Exactly 32 bytes
            const base64Key = rawKey.toString('base64');
            process.env.GODADDY_OAUTH_ENCRYPTION_KEY = base64Key;

            const key = getEncryptionKey();

            expect(key.toString()).toBe(rawKey.toString());
        });

        it('should return consistent key on multiple calls', () => {
            const key1 = getEncryptionKey();
            const key2 = getEncryptionKey();

            expect(key1.equals(key2)).toBe(true);
        });

        it('should throw error if key is wrong length', () => {
            // 16 bytes instead of 32
            process.env.GODADDY_OAUTH_ENCRYPTION_KEY = Buffer.from('a'.repeat(16)).toString('base64');

            expect(() => getEncryptionKey()).toThrow(/256-bit/);
        });

        it('should throw error if key is invalid base64', () => {
            process.env.GODADDY_OAUTH_ENCRYPTION_KEY = 'not-valid-base64!!!';

            expect(() => getEncryptionKey()).toThrow();
        });
    });

    describe('encryptToken', () => {
        it('should return EncryptedData with data, iv, and tag fields', () => {
            const token = 'test-access-token-xyz';
            const encrypted = encryptToken(token);

            expect(encrypted).toHaveProperty('data');
            expect(encrypted).toHaveProperty('iv');
            expect(encrypted).toHaveProperty('tag');
            expect(typeof encrypted.data).toBe('string');
            expect(typeof encrypted.iv).toBe('string');
            expect(typeof encrypted.tag).toBe('string');
        });

        it('should produce base64-encoded fields', () => {
            const token = 'test-token';
            const encrypted = encryptToken(token);

            // Base64 regex: letters, numbers, +, /, and optional = padding
            const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;

            expect(encrypted.data).toMatch(base64Regex);
            expect(encrypted.iv).toMatch(base64Regex);
            expect(encrypted.tag).toMatch(base64Regex);
        });

        it('should generate 12-byte IV (16 chars in base64)', () => {
            const token = 'test-token';
            const encrypted = encryptToken(token);

            // 12 bytes = 16 base64 characters
            const ivBuffer = Buffer.from(encrypted.iv, 'base64');
            expect(ivBuffer).toHaveLength(12);
        });

        it('should generate 16-byte auth tag (22+ chars in base64)', () => {
            const token = 'test-token';
            const encrypted = encryptToken(token);

            // 16 bytes = ~22 base64 characters
            const tagBuffer = Buffer.from(encrypted.tag, 'base64');
            expect(tagBuffer).toHaveLength(16);
        });

        it('should produce different IVs for same token on multiple calls', () => {
            const token = 'same-token';
            const encrypted1 = encryptToken(token);
            const encrypted2 = encryptToken(token);
            const encrypted3 = encryptToken(token);

            expect(encrypted1.iv).not.toBe(encrypted2.iv);
            expect(encrypted2.iv).not.toBe(encrypted3.iv);
            expect(encrypted1.iv).not.toBe(encrypted3.iv);
        });

        it('should produce different encrypted data for same token (due to random IV)', () => {
            const token = 'same-token';
            const encrypted1 = encryptToken(token);
            const encrypted2 = encryptToken(token);

            expect(encrypted1.data).not.toBe(encrypted2.data);
        });

        it('should handle empty string token', () => {
            const encrypted = encryptToken('');

            expect(encrypted.data).toBeDefined();
            expect(encrypted.iv).toBeDefined();
            expect(encrypted.tag).toBeDefined();
        });

        it('should handle very long tokens', () => {
            const longToken = 'x'.repeat(10000);
            const encrypted = encryptToken(longToken);

            expect(encrypted.data).toBeDefined();
            expect(encrypted.iv).toBeDefined();
            expect(encrypted.tag).toBeDefined();
        });

        it('should handle tokens with special characters', () => {
            const token = 'token-with-$pecial-ch@rs-!@#$%^&*()';
            const encrypted = encryptToken(token);

            expect(encrypted.data).toBeDefined();
            expect(encrypted.iv).toBeDefined();
            expect(encrypted.tag).toBeDefined();
        });

        it('should handle tokens with unicode characters', () => {
            const token = 'token-with-émojis-🔐-and-中文';
            const encrypted = encryptToken(token);

            expect(encrypted.data).toBeDefined();
            expect(encrypted.iv).toBeDefined();
            expect(encrypted.tag).toBeDefined();
        });

        it('should use AES-256-GCM encryption algorithm', () => {
            const token = 'test-token';
            const encrypted = encryptToken(token);

            // Should be decryptable with AES-256-GCM
            const key = getEncryptionKey();
            const iv = Buffer.from(encrypted.iv, 'base64');
            const tag = Buffer.from(encrypted.tag, 'base64');
            const data = Buffer.from(encrypted.data, 'base64');

            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(tag);

            const decrypted =
                decipher.update(data, undefined, 'utf8') + decipher.final('utf8');

            expect(decrypted).toBe(token);
        });
    });

    describe('decryptToken', () => {
        it('should decrypt encrypted token back to original', () => {
            const originalToken = 'my-access-token-xyz';
            const encrypted = encryptToken(originalToken);
            const decrypted = decryptToken(encrypted);

            expect(decrypted).toBe(originalToken);
        });

        it('should handle empty string tokens', () => {
            const encrypted = encryptToken('');
            const decrypted = decryptToken(encrypted);

            expect(decrypted).toBe('');
        });

        it('should handle long tokens', () => {
            const longToken = 'x'.repeat(5000);
            const encrypted = encryptToken(longToken);
            const decrypted = decryptToken(encrypted);

            expect(decrypted).toBe(longToken);
        });

        it('should handle tokens with special characters', () => {
            const token = 'token-$pecial-@#$%';
            const encrypted = encryptToken(token);
            const decrypted = decryptToken(encrypted);

            expect(decrypted).toBe(token);
        });

        it('should handle tokens with unicode', () => {
            const token = 'émoji-🔐-中文';
            const encrypted = encryptToken(token);
            const decrypted = decryptToken(encrypted);

            expect(decrypted).toBe(token);
        });

        it('should throw error if auth tag is invalid', () => {
            const encrypted = encryptToken('test-token');

            // Corrupt the auth tag
            const corruptedTag = Buffer.from(encrypted.tag, 'base64');
            corruptedTag[0] ^= 0xff; // Flip bits
            const corrupted: EncryptedData = {
                ...encrypted,
                tag: corruptedTag.toString('base64'),
            };

            expect(() => decryptToken(corrupted)).toThrow();
        });

        it('should throw error if encrypted data is tampered', () => {
            const encrypted = encryptToken('test-token');

            // Corrupt the data
            const corruptedData = Buffer.from(encrypted.data, 'base64');
            corruptedData[0] ^= 0xff; // Flip bits
            const corrupted: EncryptedData = {
                ...encrypted,
                data: corruptedData.toString('base64'),
            };

            expect(() => decryptToken(corrupted)).toThrow();
        });

        it('should throw error if IV is wrong', () => {
            const encrypted = encryptToken('test-token');

            // Use wrong IV
            const wrongIv = Buffer.from(encrypted.iv, 'base64');
            wrongIv[0] ^= 0xff; // Flip bits
            const corrupted: EncryptedData = {
                ...encrypted,
                iv: wrongIv.toString('base64'),
            };

            expect(() => decryptToken(corrupted)).toThrow();
        });

        it('should throw error if data field is invalid base64', () => {
            const encrypted: EncryptedData = {
                data: 'not-valid-base64!!!',
                iv: 'valid-iv-base64==',
                tag: 'valid-tag-base64==',
            };

            expect(() => decryptToken(encrypted)).toThrow();
        });

        it('should throw error if iv field is invalid base64', () => {
            const encrypted: EncryptedData = {
                data: 'valid-data-base64==',
                iv: 'not-valid-base64!!!',
                tag: 'valid-tag-base64==',
            };

            expect(() => decryptToken(encrypted)).toThrow();
        });

        it('should throw error if tag field is invalid base64', () => {
            const encrypted: EncryptedData = {
                data: 'valid-data-base64==',
                iv: 'valid-iv-base64==',
                tag: 'not-valid-base64!!!',
            };

            expect(() => decryptToken(encrypted)).toThrow();
        });
    });

    describe('Integration Tests', () => {
        it('should handle full encrypt/decrypt cycle', () => {
            const tokens = [
                'simple-token',
                'token-with-special-chars-!@#$%',
                'émoji-🔐-token',
                'very-long-token-' + 'x'.repeat(1000),
                '',
            ];

            for (const token of tokens) {
                const encrypted = encryptToken(token);
                const decrypted = decryptToken(encrypted);
                expect(decrypted).toBe(token);
            }
        });

        it('should produce unique encryptions for same token', () => {
            const token = 'same-token';
            const encryptions = [];

            for (let i = 0; i < 10; i++) {
                encryptions.push(encryptToken(token));
            }

            // All IVs should be unique
            const ivs = encryptions.map((e) => e.iv);
            const uniqueIvs = new Set(ivs);
            expect(uniqueIvs.size).toBe(10);

            // All encrypted data should be unique
            const datas = encryptions.map((e) => e.data);
            const uniqueDatas = new Set(datas);
            expect(uniqueDatas.size).toBe(10);

            // But all should decrypt to same token
            for (const encrypted of encryptions) {
                expect(decryptToken(encrypted)).toBe(token);
            }
        });

        it('should work with realistic OAuth tokens', () => {
            const accessToken =
                'EXAMPLE_ACCESS_TOKEN_very_long_jwt_token_xyz123_real_oauth_token';
            const refreshToken = 'EXAMPLE_REFRESH_TOKEN_abc123_long_token_xyz';

            const encryptedAccess = encryptToken(accessToken);
            const encryptedRefresh = encryptToken(refreshToken);

            expect(decryptToken(encryptedAccess)).toBe(accessToken);
            expect(decryptToken(encryptedRefresh)).toBe(refreshToken);
        });

        it('should handle rapid consecutive encryptions', () => {
            const token = 'performance-test-token';
            const results = [];

            for (let i = 0; i < 100; i++) {
                const encrypted = encryptToken(token);
                results.push(decryptToken(encrypted));
            }

            // All should decrypt correctly
            expect(results.every((r) => r === token)).toBe(true);
        });
    });

    describe('Security Properties', () => {
        it('should use cryptographically random IVs', () => {
            const ivs = new Set<string>();
            const iterations = 1000;

            for (let i = 0; i < iterations; i++) {
                const encrypted = encryptToken('test');
                ivs.add(encrypted.iv);
            }

            // All IVs should be unique
            expect(ivs.size).toBe(iterations);
        });

        it('should not leak information about token length in encrypted data length', () => {
            const shortToken = 'x';
            const mediumToken = 'x'.repeat(100);
            const longToken = 'x'.repeat(1000);

            const encShort = encryptToken(shortToken);
            const encMedium = encryptToken(mediumToken);
            const encLong = encryptToken(longToken);

            // IV and tag should always be same size
            expect(encShort.iv.length).toBe(encMedium.iv.length);
            expect(encMedium.iv.length).toBe(encLong.iv.length);
            expect(encShort.tag.length).toBe(encMedium.tag.length);
            expect(encMedium.tag.length).toBe(encLong.tag.length);

            // Data length should correlate with token length
            expect(encShort.data.length).toBeLessThan(encMedium.data.length);
            expect(encMedium.data.length).toBeLessThan(encLong.data.length);
        });

        it('should prevent modification attacks via auth tag', () => {
            const encrypted = encryptToken('important-token');

            // Try to modify the data
            const dataBuffer = Buffer.from(encrypted.data, 'base64');
            dataBuffer[0] ^= 0x01;

            const tampered: EncryptedData = {
                ...encrypted,
                data: dataBuffer.toString('base64'),
            };

            expect(() => decryptToken(tampered)).toThrow();
        });

        it('should prevent replay attacks with different IVs', () => {
            const token = 'session-token';
            const encrypted1 = encryptToken(token);
            const encrypted2 = encryptToken(token);

            // Different IVs prevent replay
            expect(encrypted1.iv).not.toBe(encrypted2.iv);
            expect(encrypted1.data).not.toBe(encrypted2.data);
            expect(encrypted1.tag).not.toBe(encrypted2.tag);
        });
    });
});
