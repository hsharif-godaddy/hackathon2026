import { randomBytes, createHash, randomUUID } from 'node:crypto';

/**
 * Convert Buffer to RFC 4648 base64url encoding
 *
 * @param buffer - Buffer to encode
 * @returns Base64url encoded string
 */
export function base64url(buffer: Buffer): string {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate a PKCE code verifier
 *
 * Creates a cryptographically random 43-character string using 32 random bytes.
 * Per RFC 7636, the code verifier must be between 43-128 characters.
 *
 * @returns Base64url encoded code verifier (43 characters)
 */
export function generateCodeVerifier(): string {
    return base64url(randomBytes(32));
}

/**
 * Generate a PKCE code challenge from a code verifier
 *
 * Creates SHA256 hash of the code verifier and encodes it as base64url.
 * Per RFC 7636, this is the S256 challenge method.
 *
 * @param verifier - Code verifier to hash
 * @returns Base64url encoded code challenge
 */
export function generateCodeChallenge(verifier: string): string {
    return base64url(createHash('sha256').update(verifier).digest());
}

/**
 * Generate a random state parameter for CSRF protection
 *
 * Uses crypto.randomUUID to generate a unique, unpredictable state value.
 *
 * @returns UUID v4 string
 */
export function generateState(): string {
    return randomUUID();
}
