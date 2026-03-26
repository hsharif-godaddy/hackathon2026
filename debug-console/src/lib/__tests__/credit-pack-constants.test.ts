import { describe, expect, it } from 'vitest';

import { NOTES_MAX_WORDS, NOTES_RE } from '../credit-pack-constants';

describe('credit-pack-constants', () => {
    describe('NOTES_MAX_WORDS', () => {
        it('should be 200', () => {
            expect(NOTES_MAX_WORDS).toBe(200);
        });
    });

    describe('NOTES_RE', () => {
        it('should allow alphanumeric characters', () => {
            expect('abcXYZ019'.replace(NOTES_RE, '')).toBe('abcXYZ019');
        });

        it('should allow basic punctuation', () => {
            const allowed = '.,!?;:\'"()-_@#$/';
            expect(allowed.replace(NOTES_RE, '')).toBe(allowed);
        });

        it('should allow spaces', () => {
            expect('hello world'.replace(NOTES_RE, '')).toBe('hello world');
        });

        it('should allow newline characters', () => {
            expect('line one\nline two'.replace(NOTES_RE, '')).toBe('line one\nline two');
        });

        it('should allow carriage return characters from Windows line endings', () => {
            expect('line one\r\nline two'.replace(NOTES_RE, '')).toBe('line one\r\nline two');
        });

        it('should allow square brackets, backticks, and math symbols', () => {
            const allowed = '[]`=+*%&^';
            expect(allowed.replace(NOTES_RE, '')).toBe(allowed);
        });

        it('should strip emoji characters', () => {
            expect('hello 🎉 world'.replace(NOTES_RE, '')).toBe('hello  world');
        });

        it('should strip non-latin unicode characters', () => {
            expect('test こんにちは end'.replace(NOTES_RE, '')).toBe('test  end');
        });

        it('should strip angle brackets and curly braces', () => {
            expect('<script>{}</script>'.replace(NOTES_RE, '')).toBe('script/script');
        });

        it('should handle an empty string', () => {
            expect(''.replace(NOTES_RE, '')).toBe('');
        });

        it('should preserve a typical note sentence', () => {
            const note = "Customer's app crashed (bug #1234) - adding credit pack as compensation.";
            expect(note.replace(NOTES_RE, '')).toBe(note);
        });

        it('should preserve multi-line notes', () => {
            const note = 'Reason: site was down\nTicket: SUPPORT-5678\nApproved by: manager';
            expect(note.replace(NOTES_RE, '')).toBe(note);
        });
    });
});
