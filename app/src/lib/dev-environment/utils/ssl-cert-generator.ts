import { existsSync, mkdirSync, writeFileSync } from 'fs';
import forge from 'node-forge';
import { join } from 'path';

import { CAManager } from './ca-manager';
import { logger } from '../../request-context';

export interface SSLCertificateResult {
  success: boolean;
  certPath?: string;
  keyPath?: string;
  error?: string;
}

export class SSLCertificateGenerator {
  private sslDir: string;
  private caManager: CAManager;

  constructor(appPath: string) {
    this.sslDir = join(appPath, '.ssl');
    this.caManager = new CAManager();
  }

  async generateCertificates(): Promise<SSLCertificateResult> {
    try {
      logger.info('ssl.generation.start', {
        sslDir: this.sslDir,
        message: 'Starting SSL certificate generation'
      });

      if (!existsSync(this.sslDir)) {
        mkdirSync(this.sslDir, { recursive: true });
      }

      const certPath = join(this.sslDir, 'cert.pem');
      const keyPath = join(this.sslDir, 'key.pem');

      if (existsSync(certPath) && existsSync(keyPath)) {
        logger.info('ssl.generation.skip', {
          message: 'SSL certificates already exist',
          certPath,
          keyPath
        });
        return {
          success: true,
          certPath,
          keyPath
        };
      }

      return await this.generateCASignedCertificate(certPath, keyPath);

    } catch (error) {
      logger.error('ssl.generation.failure', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sslDir: this.sslDir
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async generateCASignedCertificate(certPath: string, keyPath: string): Promise<SSLCertificateResult> {
    try {
      logger.info('ssl.generation.ca_signed.start', {
        message: 'Generating CA-signed certificates'
      });

      const caResult = await this.caManager.ensureCA();
      if (!caResult.success || !caResult.cert || !caResult.key) {
        throw new Error('Failed to load or generate CA');
      }

      const caCert = forge.pki.certificateFromPem(caResult.cert);
      const caKey = forge.pki.privateKeyFromPem(caResult.key);

      const keys = forge.pki.rsa.generateKeyPair(2048);
      const cert = forge.pki.createCertificate();

      cert.publicKey = keys.publicKey;
      // Use static serial number to avoid x509 negative serial number errors.
      // Random values (e.g., 50000 = 0xC350) can have the high bit set when DER-encoded,
      // causing Go's x509 parser to interpret them as negative in two's complement.
      // Static '01' is sufficient for sandbox/dev environments where uniqueness doesn't matter.
      cert.serialNumber = '01';
      cert.validity.notBefore = new Date();
      cert.validity.notAfter = new Date();
      cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

      cert.setSubject([
        { name: 'commonName', value: 'localhost' }
      ]);

      cert.setIssuer(caCert.subject.attributes);

      cert.setExtensions([
        {
          name: 'basicConstraints',
          cA: false
        },
        {
          name: 'keyUsage',
          digitalSignature: true,
          keyEncipherment: true
        },
        {
          name: 'extKeyUsage',
          serverAuth: true,
          clientAuth: true
        },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' }
          ]
        }
      ]);

      cert.sign(caKey, forge.md.sha256.create());

      const certPem = forge.pki.certificateToPem(cert);
      const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

      writeFileSync(certPath, certPem, 'utf8');
      writeFileSync(keyPath, keyPem, 'utf8');

      logger.info('ssl.generation.ca_signed.success', {
        message: 'CA-signed SSL certificates generated',
        certPath,
        keyPath,
        caPath: this.caManager.getCAPath()
      });

      return {
        success: true,
        certPath,
        keyPath
      };
    } catch (error) {
      logger.error('ssl.generation.ca_signed.failure', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate CA-signed certificate'
      };
    }
  }

  static async ensureCertificates(appPath: string): Promise<SSLCertificateResult> {
    const generator = new SSLCertificateGenerator(appPath);
    return await generator.generateCertificates();
  }
}

