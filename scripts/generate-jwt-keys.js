#!/usr/bin/env node

/**
 * Generate RSA key pair for JWT signing
 * Usage: node scripts/generate-jwt-keys.js
 */

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

function generateJWTKeys() {
  console.log('🔐 Generating RSA key pair for JWT signing...');
  
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
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

  // Write keys to files (for reference and local development)
  const keysDir = join(process.cwd(), 'keys');
  try {
    writeFileSync(join(keysDir, 'jwt-private.pem'), privateKey);
    writeFileSync(join(keysDir, 'jwt-public.pem'), publicKey);
    console.log('✅ Keys written to ./keys/ directory');
  } catch (error) {
    console.log('ℹ️  Keys directory not writable, outputting to console only');
  }

  console.log('\n📋 Environment Variables for App (.env.local):');
  console.log('# JWT Signing Keys (keep private key secure!)');
  console.log(`JWT_PRIVATE_KEY="${privateKey.replace(/\n/g, '\\n')}"`);
  console.log(`JWT_PUBLIC_KEY="${publicKey.replace(/\n/g, '\\n')}"`);
  
  console.log('\n📋 Environment Variables for Agents:');
  console.log('# Agents should use JWT_PUBLIC_KEY for validation');
  // No JWKS endpoint is provided; use JWT_PUBLIC_KEY directly
  
  console.log('\n🔒 Security Notes:');
  console.log('- Keep JWT_PRIVATE_KEY secure and never expose it');
  console.log('- JWT_PUBLIC_KEY can be public (exposed via JWKS endpoint)');
  console.log('- In production, use secure secret management (K8s secrets, etc.)');
  console.log('- Rotate keys periodically for security');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateJWTKeys();
}

export { generateJWTKeys };
