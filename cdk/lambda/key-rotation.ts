/**
 * JWT Key Rotation Lambda Function
 * 
 * Handles automatic rotation of JWT signing keys using Node.js crypto module.
 * Keys are generated locally and stored in AWS Secrets Manager.
 */

import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { randomUUID } from 'node:crypto';
import { generateKeyPairSync } from 'node:crypto';

/**
 * Metadata for a single JWT signing key
 */
interface KeyMetadata {
  keyId: string;
  privateKey: string;
  publicKey: string;
  status: 'active' | 'rotating';
  createdAt: string;
  expiresAt: string;
}

/**
 * Structure of the JWT secret stored in Secrets Manager
 */
interface JWTSecretValue {
  keys: KeyMetadata[];
  lastRotation: string;
  nextRotation: string;
}

/**
 * Lambda event input
 */
interface LambdaEvent {
  forceRotation?: boolean;
}

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

const SECRET_NAME = process.env.SECRET_NAME!;
const KEY_EXPIRY_DAYS = parseInt(process.env.KEY_EXPIRY_DAYS || '30');
const GRACE_PERIOD_DAYS = parseInt(process.env.GRACE_PERIOD_DAYS || '7');
const ROTATION_INTERVAL_DAYS = parseInt(process.env.ROTATION_INTERVAL_DAYS || '7');

/**
 * Lambda handler for key rotation
 * 
 * Generates new RSA key pairs, rotates existing keys, and cleans up expired keys.
 * 
 * @param event - Lambda event with optional forceRotation flag
 * @returns Response with status and rotation details
 */
export async function handler(event: LambdaEvent = {}) {
  try {
    const currentSecret = await getCurrentSecret();
    const needsRotation = event.forceRotation || shouldRotate(currentSecret);
    
    if (!needsRotation) {
      return { 
        statusCode: 200, 
        message: 'Key rotation not needed',
        nextRotation: currentSecret.nextRotation
      };
    }

    const newKey = generateKeyPair();
    const updatedKeys = updateKeyStatuses(currentSecret.keys, newKey);
    const cleanedKeys = cleanupExpiredKeys(updatedKeys);
    
    const now = new Date();
    const rotationIntervalMs = ROTATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    const nextRotation = new Date(now.getTime() + rotationIntervalMs);
    
    const updatedSecret: JWTSecretValue = {
      keys: cleanedKeys,
      lastRotation: now.toISOString(),
      nextRotation: nextRotation.toISOString()
    };
    
    await updateSecret(updatedSecret);
    
    return {
      statusCode: 200,
      message: 'Key rotation completed successfully',
      newKeyId: newKey.keyId,
      nextRotation: nextRotation.toISOString(),
      totalKeys: cleanedKeys.length,
      activeKeys: cleanedKeys.filter(k => k.status === 'active').length
    };
    
  } catch (error) {
    console.error('Key rotation failed', error);
    return {
      statusCode: 500,
      message: 'Key rotation failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Generate a new RSA key pair for JWT signing
 * 
 * Creates a 2048-bit RSA key pair using Node.js crypto module.
 * Keys are generated in PEM format for easy use with JWT libraries.
 * 
 * @returns New key metadata with private and public keys
 */
function generateKeyPair(): KeyMetadata {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (KEY_EXPIRY_DAYS * 24 * 60 * 60 * 1000));
  
  return {
    keyId: randomUUID(),
    privateKey,
    publicKey,
    status: 'active',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
}

/**
 * Get current secret value from Secrets Manager
 * 
 * Handles cases where secret doesn't exist or has initial placeholder value.
 * 
 * @returns Current JWT secret value
 * @throws Error if secret exists but cannot be parsed
 */
async function getCurrentSecret(): Promise<JWTSecretValue> {
  try {
    const response = await secretsClient.send(new GetSecretValueCommand({
      SecretId: SECRET_NAME
    }));
    
    if (response.SecretString) {
      const parsed = JSON.parse(response.SecretString);
      
      if (parsed.initialValue && !parsed.keys) {
        return {
          keys: [],
          lastRotation: new Date(0).toISOString(),
          nextRotation: new Date().toISOString()
        };
      }
      
      return parsed;
    }
  } catch (error: any) {
    if (error.name === 'ResourceNotFoundException') {
      return {
        keys: [],
        lastRotation: new Date(0).toISOString(),
        nextRotation: new Date().toISOString()
      };
    }
    throw error;
  }
  
  throw new Error('Secret exists but has no content');
}

/**
 * Check if rotation is needed based on next rotation time or key availability
 * 
 * @param secret - Current secret value
 * @returns True if rotation should occur
 */
function shouldRotate(secret: JWTSecretValue): boolean {
  const now = new Date();
  const nextRotation = new Date(secret.nextRotation);
  
  const hasActiveKey = secret.keys.some(key => key.status === 'active');
  
  return now >= nextRotation || !hasActiveKey;
}

/**
 * Update status of existing keys when new key is added
 * 
 * Marks all current active keys as 'rotating' to enter grace period,
 * then adds the new active key.
 * 
 * @param existingKeys - Current keys in the secret
 * @param newKey - Newly generated key
 * @returns Updated array of keys
 */
function updateKeyStatuses(existingKeys: KeyMetadata[], newKey: KeyMetadata): KeyMetadata[] {
  const updatedKeys = existingKeys.map(key => {
    if (key.status === 'active') {
      return { ...key, status: 'rotating' as const };
    }
    return key;
  });
  
  return [newKey, ...updatedKeys];
}

/**
 * Clean up expired keys
 * 
 * Removes keys that have passed their expiry date plus grace period.
 * Keys in 'rotating' status are kept for the grace period to allow
 * in-flight requests to complete.
 * 
 * @param keys - Array of keys to filter
 * @returns Filtered array containing only valid keys
 */
function cleanupExpiredKeys(keys: KeyMetadata[]): KeyMetadata[] {
  const now = new Date();
  const gracePeriodMs = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  
  return keys.filter(key => {
    const keyAge = now.getTime() - new Date(key.createdAt).getTime();
    const isExpired = key.status === 'rotating' && keyAge > gracePeriodMs;
    return !isExpired;
  });
}

/**
 * Update the secret with new key information
 * 
 * @param secretValue - New secret value to store
 */
async function updateSecret(secretValue: JWTSecretValue): Promise<void> {
  await secretsClient.send(new PutSecretValueCommand({
    SecretId: SECRET_NAME,
    SecretString: JSON.stringify(secretValue, null, 2)
  }));
}
