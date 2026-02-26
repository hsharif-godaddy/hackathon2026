import { Logger } from '@aws-lambda-powertools/logger';
import { Context, Handler } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import forge from 'node-forge';

const logger = new Logger({ serviceName: 'qdrant-tls-bootstrap' });

// Environment variables set by CDK
const caSecretName = process.env.CA_SECRET_NAME as string;
const certSecretName = process.env.CERT_SECRET_NAME as string;
const commonName = process.env.COMMON_NAME as string;

// Certificate validity periods
const CA_VALIDITY_YEARS = 10;
const CERT_VALIDITY_YEARS = 1;
const RENEWAL_THRESHOLD_DAYS = 90;

interface CAData {
    key: string;
    cert: string;
    isNew: boolean;
}

interface CertSecret {
    crt: string;
    key: string;
    chain: string;
}

function randomSerialNumber(): string {
    // Generate a random 20 byte number for the serial
    // Ensure leftmost bit is 0 per X.509 spec
    let serialNumber = BigInt('0x' + forge.util.bytesToHex(forge.random.getBytesSync(20)));
    const mask = BigInt('0x' + '7F'.padEnd(40, 'F'));
    const fixedSerial = serialNumber & mask;
    return fixedSerial.toString(16).padStart(40, '0');
}

async function fetchSecret(secretName: string): Promise<string | undefined> {
    const secretsManager = new SecretsManagerClient({});
    logger.info(`Fetching secret: ${secretName}`);

    try {
        const response = await secretsManager.send(
            new GetSecretValueCommand({ SecretId: secretName })
        );
        return response.SecretString;
    } catch (error) {
        if ((error as any).name === 'ResourceNotFoundException') {
            logger.info(`Secret not found: ${secretName}`);
            return undefined;
        }
        throw error;
    }
}

async function storeSecret(secretName: string, value: object): Promise<void> {
    const secretsManager = new SecretsManagerClient({});
    const secretString = JSON.stringify(value);

    logger.info(`Storing secret: ${secretName}`);
    await secretsManager.send(
        new PutSecretValueCommand({
            SecretId: secretName,
            SecretString: secretString,
        })
    );
    logger.info(`Secret stored: ${secretName}`);
}

function createCACertificate(): { cert: forge.pki.Certificate; keyPair: forge.pki.rsa.KeyPair } {
    logger.info('Generating new CA certificate');

    const keyPair = forge.pki.rsa.generateKeyPair(4096);

    const attributes: forge.pki.CertificateField[] = [
        { shortName: 'C', value: 'US' },
        { shortName: 'ST', value: 'Arizona' },
        { shortName: 'L', value: 'Tempe' },
        { shortName: 'O', value: 'GoDaddy Inc.' },
        { shortName: 'CN', value: 'Qdrant Internal CA' },
    ];

    const extensions = [
        {
            name: 'keyUsage',
            digitalSignature: true,
            keyCertSign: true,
            cRLSign: true,
            critical: true,
        },
        {
            name: 'basicConstraints',
            cA: true,
            critical: true,
        },
        { name: 'subjectKeyIdentifier' },
        {
            name: 'authorityKeyIdentifier',
            keyIdentifier: true,
        },
    ];

    const cert = forge.pki.createCertificate();
    cert.publicKey = keyPair.publicKey;
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + CA_VALIDITY_YEARS);
    cert.serialNumber = randomSerialNumber();
    cert.setSubject(attributes);
    cert.setIssuer(attributes);
    cert.setExtensions(extensions);

    cert.sign(keyPair.privateKey, forge.md.sha512.create());

    logger.info('CA certificate generated', {
        notBefore: cert.validity.notBefore.toISOString(),
        notAfter: cert.validity.notAfter.toISOString(),
    });

    return { cert, keyPair };
}

async function getOrCreateCA(): Promise<CAData> {
    const caSecret = await fetchSecret(caSecretName);

    if (caSecret) {
        try {
            const parsed = JSON.parse(caSecret);
            if (parsed.key && parsed.cert) {
                // Verify CA cert is still valid
                const caCert = forge.pki.certificateFromPem(parsed.cert);
                const now = new Date();
                if (caCert.validity.notAfter > now) {
                    logger.info('Using existing CA certificate', {
                        notAfter: caCert.validity.notAfter.toISOString(),
                    });
                    return { key: parsed.key, cert: parsed.cert, isNew: false };
                }
                logger.warn('CA certificate has expired, generating new one');
            }
        } catch (error) {
            logger.warn('Failed to parse existing CA secret, generating new CA', {
                error: (error as Error).message,
            });
        }
    }

    // Generate new CA
    const { cert, keyPair } = createCACertificate();
    const caData = {
        key: forge.pki.privateKeyToPem(keyPair.privateKey),
        cert: forge.pki.certificateToPem(cert),
    };

    await storeSecret(caSecretName, caData);

    return { ...caData, isNew: true };
}

function createServerCertificate(
    caCert: forge.pki.Certificate,
    caPrivateKey: forge.pki.rsa.PrivateKey,
    cn: string
): { cert: forge.pki.Certificate; keyPair: forge.pki.rsa.KeyPair } {
    logger.info('Generating server certificate', { commonName: cn });

    const keyPair = forge.pki.rsa.generateKeyPair(4096);

    const extensions = [
        {
            name: 'keyUsage',
            digitalSignature: true,
            keyEncipherment: true,
        },
        {
            name: 'extKeyUsage',
            serverAuth: true,
        },
        {
            name: 'basicConstraints',
            cA: false,
            critical: true,
        },
        { name: 'subjectKeyIdentifier' },
        {
            name: 'authorityKeyIdentifier',
            keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes(),
        },
        {
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: cn }, // DNS name
            ],
        },
    ];

    const cert = forge.pki.createCertificate();
    cert.publicKey = keyPair.publicKey;
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + CERT_VALIDITY_YEARS);
    cert.serialNumber = randomSerialNumber();
    cert.setSubject([{ name: 'commonName', value: cn }]);
    cert.setIssuer(caCert.subject.attributes);
    cert.setExtensions(extensions);

    cert.sign(caPrivateKey, forge.md.sha512.create());

    logger.info('Server certificate generated', {
        commonName: cn,
        notBefore: cert.validity.notBefore.toISOString(),
        notAfter: cert.validity.notAfter.toISOString(),
    });

    return { cert, keyPair };
}

function needsRenewal(certPem: string): boolean {
    try {
        const cert = forge.pki.certificateFromPem(certPem);
        const now = new Date();
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() + RENEWAL_THRESHOLD_DAYS);

        if (cert.validity.notAfter <= thresholdDate) {
            logger.info('Certificate needs renewal', {
                notAfter: cert.validity.notAfter.toISOString(),
                threshold: thresholdDate.toISOString(),
            });
            return true;
        }
        return false;
    } catch (error) {
        logger.warn('Failed to parse certificate, will regenerate', {
            error: (error as Error).message,
        });
        return true;
    }
}

async function maybeCreateServerCert(caData: CAData): Promise<void> {
    const existingSecret = await fetchSecret(certSecretName);

    // Check if we need to regenerate
    let needsRegeneration = caData.isNew; // Always regenerate if CA is new

    if (!needsRegeneration && existingSecret) {
        try {
            const parsed: CertSecret = JSON.parse(existingSecret);
            if (parsed.crt && parsed.key && parsed.chain) {
                if (!needsRenewal(parsed.crt)) {
                    logger.info('Server certificate is still valid, skipping regeneration');
                    return;
                }
                needsRegeneration = true;
            } else {
                logger.warn('Existing certificate secret missing required fields');
                needsRegeneration = true;
            }
        } catch (error) {
            logger.warn('Failed to parse existing certificate secret', {
                error: (error as Error).message,
            });
            needsRegeneration = true;
        }
    } else if (!existingSecret) {
        needsRegeneration = true;
    }

    if (!needsRegeneration) {
        return;
    }

    // Generate new server certificate
    const caCert = forge.pki.certificateFromPem(caData.cert);
    const caPrivateKey = forge.pki.privateKeyFromPem(caData.key);

    const { cert, keyPair } = createServerCertificate(caCert, caPrivateKey, commonName);

    // Store in format expected by entrypoint: {crt, key, chain}
    const certSecret: CertSecret = {
        crt: forge.pki.certificateToPem(cert),
        key: forge.pki.privateKeyToPem(keyPair.privateKey),
        chain: caData.cert, // CA cert as chain
    };

    await storeSecret(certSecretName, certSecret);
}

export const handler: Handler = async (event: unknown, context: Context) => {
    logger.addContext(context);
    logger.info('Lambda invocation', { event });

    // Validate required environment variables
    if (!caSecretName || !certSecretName || !commonName) {
        throw new Error('Missing required environment variables: CA_SECRET_NAME, CERT_SECRET_NAME, COMMON_NAME');
    }

    logger.info('Configuration', {
        caSecretName,
        certSecretName,
        commonName,
    });

    // Get or create CA
    const caData = await getOrCreateCA();

    // Create server certificate if needed
    await maybeCreateServerCert(caData);

    logger.info('TLS bootstrap complete');

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'TLS certificates ready' }),
    };
};
