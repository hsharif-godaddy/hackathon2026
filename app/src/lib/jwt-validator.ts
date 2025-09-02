import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { AccountService } from './database/account-service';

// GoDaddy JWT Payload structure
interface JWTPayload {
  // Standard JWT fields
  exp?: number;           // Expiration timestamp
  iat?: number;           // Issued at timestamp
  
  // GoDaddy specific fields
  shopperId?: string;     // GoDaddy shopper ID (primary identifier)
  identity?: string;      // Identity UUID
  cid?: string;           // Customer ID (used as our internal customer_id)
  plid?: string;          // Plan ID from GoDaddy (if applicable)
  
  // Additional fields that might be present
  [key: string]: unknown;
}



interface JWTHeader {
  kid?: string;
  alg?: string;
  typ?: string;
  [key: string]: unknown;
}

export class JWTValidator {
  private certDir: string;
  private accountService: AccountService;

  constructor(certDir: string) {
    this.certDir = certDir;
    this.accountService = new AccountService();
  }

  async validateJWT(token: string): Promise<{ valid: boolean; payload?: JWTPayload; reason?: string }> {
    try {
      // Parse JWT
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, reason: 'Invalid JWT format' };
      }

      const header = this.decodeBase64Url(parts[0]) as JWTHeader;
      const payload = this.decodeBase64Url(parts[1]) as JWTPayload;
      const signature = parts[2];

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && now >= payload.exp) {
        return { valid: false, reason: 'Token expired' };
      }

      // Extract key ID from JWT header and fetch public key from GoDaddy SSO
      const kid = header.kid;
      if (!kid) {
        return { valid: false, reason: 'Missing key ID in JWT header' };
      }

      const publicKeyJWK = await this.fetchPublicKeyFromSSO(kid);
      if (!publicKeyJWK) {
        return { valid: false, reason: 'Unable to fetch public key from GoDaddy SSO' };
      }

      const isValid = this.verifySignatureWithJWK(`${parts[0]}.${parts[1]}`, signature, publicKeyJWK);
      
      if (isValid) {
        const shopperId = payload.shopperId as string;
        const customerId = payload.cid as string;
        
        // Debug: Log available payload fields for development
        if (process.env.NODE_ENV === 'development') {
          console.log('JWT Payload fields:', Object.keys(payload));
          console.log(`Extracted - shopperId: ${shopperId}, customerId: ${customerId}`);
        }
        
        console.log(`Token signature verified for shopper ${shopperId || 'unknown'}`);
        
        // Get or create account for the authenticated shopper
        if (shopperId) {
          try {
            this.accountService.getOrCreateAccount(shopperId, customerId);
          } catch (accountError) {
            console.error('Error managing account:', accountError);
            // Don't fail validation if account creation fails, just log it
          }
        }
        
        return { valid: true, payload };
      } else {
        return { valid: false, reason: 'Invalid signature' };
      }
    } catch (error) {
      return { valid: false, reason: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async fetchPublicKeyFromSSO(kid: string): Promise<any | null> {
    try {
      const ssoUrl = `https://sso.test-godaddy.com/v1/api/key/${kid}`;
      
      const clientCert = this.loadClientCertificate();
      const clientKey = this.loadClientKey();
      
      if (!clientCert || !clientKey) {
        return null;
      }

      return new Promise((resolve, reject) => {
        const options = {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'airo-app-builder/1.0'
          },
          cert: clientCert,
          key: clientKey,
          // Only disable TLS verification in development if explicitly configured
          rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : 
                             (process.env.DISABLE_TLS_VERIFICATION === 'true' ? false : true)
        };

        const req = https.request(ssoUrl, options, (response) => {
          let data = '';
          
          response.on('data', (chunk) => {
            data += chunk;
          });
          
          response.on('end', () => {
            try {
              if (response.statusCode === 200) {
                const apiResponse = JSON.parse(data);
                if (apiResponse.data && apiResponse.code === 1) {
                  resolve(apiResponse.data);
                } else {
                  resolve(null);
                }
              } else {
                resolve(null);
              }
            } catch (parseError) {
              resolve(null);
            }
          });
        });

        req.on('error', () => {
          resolve(null);
        });

        req.end();
      });
      
    } catch (error) {
      return null;
    }
  }

  private loadClientCertificate(): string | null {
    try {
      const certPath = path.join(this.certDir, 'sso.crt');
      if (fs.existsSync(certPath)) {
        return fs.readFileSync(certPath, 'utf8');
      }
      return null;
    } catch {
      return null;
    }
  }

  private loadClientKey(): string | null {
    try {
      const keyPath = path.join(this.certDir, 'sso.key');
      if (fs.existsSync(keyPath)) {
        return fs.readFileSync(keyPath, 'utf8');
      }
      return null;
    } catch {
      return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private verifySignatureWithJWK(message: string, signature: string, jwk: any): boolean {
    try {
      const publicKeyPem = this.jwkToPem(jwk);
      if (!publicKeyPem) {
        return false;
      }
      
      const signatureBuffer = this.base64UrlToBuffer(signature);
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(message, 'utf8');
      
      return verifier.verify(publicKeyPem, signatureBuffer);
    } catch {
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private jwkToPem(jwk: any): string | null {
    try {
      if (jwk.kty !== 'RSA') {
        return null;
      }

      const keyObject = crypto.createPublicKey({
        key: {
          kty: jwk.kty,
          n: jwk.n,
          e: jwk.e
        },
        format: 'jwk'
      });

      const pemKey = keyObject.export({
        type: 'spki',
        format: 'pem'
      });
      
      return pemKey.toString();
      
    } catch {
      return null;
    }
  }

  private decodeBase64Url(str: string): unknown {
    const padded = str + '='.repeat((4 - str.length % 4) % 4);
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  }

  private base64UrlToBuffer(str: string): Buffer {
    const padded = str + '='.repeat((4 - str.length % 4) % 4);
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64');
  }


}
