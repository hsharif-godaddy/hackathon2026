import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { logger } from './logger';

/**
 * Common Name / SAN host the self-signed dev cert is issued for. Must match the
 * hostname the debug-console is reached at locally (and the README's openssl
 * invocation) so the browser accepts it once the cert is trusted.
 */
export const DEV_CERT_HOST = 'local.console.airo-builder.dev-gdcorp.tools';

/**
 * Generates a key/cert pair at the given paths. Injected into ensureDevCerts so
 * tests can drive the orchestration without invoking openssl.
 */
export type CertGenerator = (keyPath: string, certPath: string) => void;

/**
 * Generate a self-signed cert/key with openssl, mirroring the manual command in
 * debug-console/README.md exactly (same CN + SANs, 825-day validity). Shelling
 * out to the system openssl keeps this dependency-free; Node has no built-in
 * X.509 issuer. Args are passed as an array (no shell) so the fixed host string
 * can't be interpreted as a shell metacharacter.
 */
function generateSelfSignedWithOpenssl(keyPath: string, certPath: string): void {
    mkdirSync(dirname(keyPath), { recursive: true });
    mkdirSync(dirname(certPath), { recursive: true });
    execFileSync(
        'openssl',
        [
            'req',
            '-x509',
            '-nodes',
            '-newkey',
            'rsa:2048',
            '-days',
            '825',
            '-keyout',
            keyPath,
            '-out',
            certPath,
            '-subj',
            `/CN=${DEV_CERT_HOST}`,
            '-addext',
            `subjectAltName=DNS:${DEV_CERT_HOST},DNS:localhost,IP:127.0.0.1`,
        ],
        { stdio: 'ignore' },
    );
}

/**
 * Ensure a self-signed cert/key pair exists for local HTTPS dev, generating one
 * on first run instead of making each developer run the README's openssl command
 * by hand.
 *
 * Returns true when both files are present (already existed, or were just
 * generated). Returns false — without throwing — when generation is needed but
 * fails (e.g. openssl absent): the caller then falls back to its existing
 * "missing cert" handling, which surfaces the manual hint.
 *
 * Callers MUST gate this to local dev. Deployed environments provision real
 * certs out-of-band, where a self-signed fallback would be wrong.
 */
export function ensureDevCerts(
    keyPath: string,
    certPath: string,
    generate: CertGenerator = generateSelfSignedWithOpenssl,
): boolean {
    if (existsSync(keyPath) && existsSync(certPath)) {
        return true;
    }

    try {
        generate(keyPath, certPath);
        logger.info('server.ssl.generated', { keyPath, certPath, host: DEV_CERT_HOST });
        return true;
    } catch (error) {
        logger.warn(
            'server.ssl.generate.failed',
            { keyPath, certPath },
            { error: error as Error },
        );
        return false;
    }
}
