import { describe, expect, it } from 'vitest';

import { DOMAIN_RE } from '@/lib/mgmt-helpers';

describe('DOMAIN_RE', () => {
    it('accepts real-looking domains', () => {
        expect(DOMAIN_RE.test('example.com')).toBe(true);
        expect(DOMAIN_RE.test('sub.example.co.uk')).toBe(true);
        expect(DOMAIN_RE.test('EXAMPLE.COM')).toBe(true);
    });

    it('rejects other identifier shapes', () => {
        expect(DOMAIN_RE.test('550e8400-e29b-41d4-a716-446655440000')).toBe(false); // customerId
        expect(DOMAIN_RE.test('123456789')).toBe(false); // shopperId
        expect(DOMAIN_RE.test('abc123def456')).toBe(false); // appId
    });

    it('rejects malformed domains', () => {
        expect(DOMAIN_RE.test('example..com')).toBe(false);
        expect(DOMAIN_RE.test('-example.com')).toBe(false);
        expect(DOMAIN_RE.test('example-.com')).toBe(false);
        expect(DOMAIN_RE.test('example')).toBe(false);
    });
});
