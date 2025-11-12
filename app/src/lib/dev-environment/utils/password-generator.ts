import { randomBytes } from 'crypto';

/**
 * Generate a secure random password using cryptographically secure random bytes
 *
 * @returns A 32-character hexadecimal string (16 bytes encoded as hex)
 * @example
 * const password = generateSecurePassword();
 * // Returns: "a3f8e9d2c1b4567890abcdef12345678"
 */
export function generateSecurePassword(): string {
	return randomBytes(16).toString('hex');
}
