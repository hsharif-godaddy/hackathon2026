import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Encrypted data structure for AES-256-GCM encryption
 * All fields are base64-encoded strings for database storage
 */
export interface EncryptedData {
    data: string;
    iv: string;
    tag: string;
}

/**
 * Get the encryption key from environment variable
 *
 * Reads GODADDY_OAUTH_ENCRYPTION_KEY which should be a base64-encoded 256-bit (32 byte) key.
 * Generate with: openssl rand -base64 32
 *
 * @returns Buffer containing the 32-byte encryption key
 * @throws Error if GODADDY_OAUTH_ENCRYPTION_KEY is not set or invalid
 *
 * @example
 * ```typescript
 * const key = getEncryptionKey();
 * // Returns 32-byte Buffer for AES-256-GCM
 * ```
 */
export function getEncryptionKey(): Buffer {
    const key = process.env.GODADDY_OAUTH_ENCRYPTION_KEY;

    if (!key || key.trim() === '') {
        throw new Error(
            'GODADDY_OAUTH_ENCRYPTION_KEY environment variable is not set. Generate with: openssl rand -base64 32',
        );
    }

    const keyBuffer = Buffer.from(key, 'base64');

    if (keyBuffer.length !== 32) {
        throw new Error(
            `GODADDY_OAUTH_ENCRYPTION_KEY must be a 256-bit (32 byte) key. Got ${keyBuffer.length} bytes. Generate with: openssl rand -base64 32`,
        );
    }

    return keyBuffer;
}

/**
 * Encrypt a token using AES-256-GCM
 *
 * Uses AES-256-GCM authenticated encryption with a random 12-byte IV.
 * Returns base64-encoded data, IV, and authentication tag for database storage.
 *
 * @param token - Plain text token to encrypt
 * @returns Encrypted data with IV and auth tag (all base64-encoded)
 * @throws Error if encryption fails
 *
 * @example
 * ```typescript
 * const encrypted = encryptToken('my-access-token-xyz');
 * // Returns { data: '...', iv: '...', tag: '...' }
 * // Store these three values in database
 * ```
 */
export function encryptToken(token: string): EncryptedData {
    const key = getEncryptionKey();
    const iv = randomBytes(12); // 12 bytes for GCM mode

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        data: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
    };
}

/**
 * Decrypt a token using AES-256-GCM
 *
 * Reverses the encryption performed by encryptToken.
 * Validates the authentication tag to ensure data integrity.
 *
 * @param encrypted - Encrypted data structure with base64-encoded fields
 * @returns Decrypted plain text token
 * @throws Error if decryption fails or auth tag is invalid
 *
 * @example
 * ```typescript
 * const encrypted = { data: '...', iv: '...', tag: '...' };
 * const token = decryptToken(encrypted);
 * // Returns 'my-access-token-xyz'
 * ```
 */
export function decryptToken(encrypted: EncryptedData): string {
    const key = getEncryptionKey();
    const iv = Buffer.from(encrypted.iv, 'base64');
    const tag = Buffer.from(encrypted.tag, 'base64');
    const data = Buffer.from(encrypted.data, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

    return decrypted.toString('utf8');
}
