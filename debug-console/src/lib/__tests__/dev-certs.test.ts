import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@/lib/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { ensureDevCerts } from '../dev-certs';

describe('ensureDevCerts', () => {
    const tmpDirs: string[] = [];

    const makeTmpDir = (): string => {
        const dir = mkdtempSync(join(tmpdir(), 'dev-certs-'));
        tmpDirs.push(dir);
        return dir;
    };

    afterEach(() => {
        while (tmpDirs.length) {
            rmSync(tmpDirs.pop()!, { recursive: true, force: true });
        }
    });

    it('is a no-op (no generation) when both files already exist', () => {
        const dir = makeTmpDir();
        const keyPath = join(dir, 'server.key');
        const certPath = join(dir, 'server.crt');
        writeFileSync(keyPath, 'key');
        writeFileSync(certPath, 'cert');
        const generate = vi.fn();

        expect(ensureDevCerts(keyPath, certPath, generate)).toBe(true);
        expect(generate).not.toHaveBeenCalled();
    });

    it('generates the pair when missing and reports success', () => {
        const dir = makeTmpDir();
        const keyPath = join(dir, 'server.key');
        const certPath = join(dir, 'server.crt');
        const generate = vi.fn((k: string, c: string) => {
            writeFileSync(k, 'key');
            writeFileSync(c, 'cert');
        });

        expect(ensureDevCerts(keyPath, certPath, generate)).toBe(true);
        expect(generate).toHaveBeenCalledExactlyOnceWith(keyPath, certPath);
    });

    it('regenerates when only one of the pair is present', () => {
        const dir = makeTmpDir();
        const keyPath = join(dir, 'server.key');
        const certPath = join(dir, 'server.crt');
        writeFileSync(keyPath, 'stale-key'); // cert missing
        const generate = vi.fn();

        ensureDevCerts(keyPath, certPath, generate);
        expect(generate).toHaveBeenCalledOnce();
    });

    it('returns false without throwing when generation fails', () => {
        const dir = makeTmpDir();
        const keyPath = join(dir, 'server.key');
        const certPath = join(dir, 'server.crt');
        const generate = vi.fn(() => {
            throw new Error('openssl not found');
        });

        expect(ensureDevCerts(keyPath, certPath, generate)).toBe(false);
    });
});
