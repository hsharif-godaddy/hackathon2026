import forge from 'node-forge';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../../request-context';

export interface CAResult {
  success: boolean;
  certPath?: string;
  keyPath?: string;
  cert?: string;
  key?: string;
  error?: string;
}

export class CAManager {
  private caDir: string;
  private certPath: string;
  private keyPath: string;

  constructor(projectRoot?: string) {
    const root = projectRoot || join(process.cwd(), '..');
    this.caDir = join(root, '.dev-ca');
    this.certPath = join(this.caDir, 'ca-cert.pem');
    this.keyPath = join(this.caDir, 'ca-key.pem');
  }

  async ensureCA(): Promise<CAResult> {
    try {
      if (existsSync(this.certPath) && existsSync(this.keyPath)) {
        logger.info('ca.load.success', {
          message: 'Loading existing CA',
          certPath: this.certPath
        });

        return {
          success: true,
          certPath: this.certPath,
          keyPath: this.keyPath,
          cert: readFileSync(this.certPath, 'utf8'),
          key: readFileSync(this.keyPath, 'utf8')
        };
      }

      logger.info('ca.generation.start', {
        message: 'Generating new CA for project',
        caDir: this.caDir
      });

      if (!existsSync(this.caDir)) {
        mkdirSync(this.caDir, { recursive: true });
      }

      const keys = forge.pki.rsa.generateKeyPair(2048);
      const cert = forge.pki.createCertificate();

      cert.publicKey = keys.publicKey;
      cert.serialNumber = '01';
      cert.validity.notBefore = new Date();
      cert.validity.notAfter = new Date();
      cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

      const attrs = [
        { name: 'commonName', value: 'Airo App Builder Development CA' },
        { name: 'organizationName', value: 'Airo Development' },
        { name: 'organizationalUnitName', value: 'Development' }
      ];

      cert.setSubject(attrs);
      cert.setIssuer(attrs);

      cert.setExtensions([
        {
          name: 'basicConstraints',
          cA: true,
          critical: true
        },
        {
          name: 'keyUsage',
          keyCertSign: true,
          cRLSign: true,
          critical: true
        },
        {
          name: 'subjectKeyIdentifier'
        }
      ]);

      cert.sign(keys.privateKey, forge.md.sha256.create());

      const certPem = forge.pki.certificateToPem(cert);
      const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

      writeFileSync(this.certPath, certPem, 'utf8');
      writeFileSync(this.keyPath, keyPem, 'utf8');

      logger.info('ca.generation.success', {
        message: 'CA generated successfully',
        certPath: this.certPath,
        keyPath: this.keyPath,
        validDays: 3650
      });

      return {
        success: true,
        certPath: this.certPath,
        keyPath: this.keyPath,
        cert: certPem,
        key: keyPem
      };

    } catch (error) {
      logger.error('ca.generation.failure', {
        error: error instanceof Error ? error.message : 'Unknown error',
        caDir: this.caDir
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  getCAPath(): string {
    return this.certPath;
  }

  getCADir(): string {
    return this.caDir;
  }
}
