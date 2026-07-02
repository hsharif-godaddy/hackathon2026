/**
 * Agents JWT Signer
 *
 * Mints short-lived RS256 JWTs accepted by the agents service for read-only
 * conversation lookups. Two key sources:
 *   - Primary: AWS Secrets Manager (same JSON shape as app/'s JWTService)
 *   - Fallback: AGENT_JWT_PRIVATE_KEY + AGENT_JWT_KEY_ID env vars
 */

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createSign } from 'node:crypto';

import { logger } from '@/lib/logger';

interface KeyMetadata {
    keyId: string;
    privateKey: string;
    publicKey: string;
    status: 'active' | 'rotating';
    createdAt: string;
    expiresAt: string;
}

interface JWTSecretValue {
    keys: KeyMetadata[];
    lastRotation: string;
    nextRotation: string;
}

interface SigningKey {
    keyId: string;
    privateKey: string;
}

interface AgentTokenOptions {
    appId: string;
    canDownload?: boolean;
    canPublish?: boolean;
    canPurchaseDomain?: boolean;
}

interface TokenResult {
    token: string;
    expires: Date;
}

const ISSUER = 'airo-app';
const AUDIENCE = 'agents-service';
const ALGORITHM = 'RS256';
const TOKEN_TTL_SECONDS = 5 * 60;
const KEY_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

let secretsClient: SecretsManagerClient | null = null;
let keyCache: { keys: KeyMetadata[]; cachedAt: Date } | null = null;
let fetchKeysPromise: Promise<KeyMetadata[]> | null = null;

function getSecretsClient(): SecretsManagerClient {
    if (!secretsClient) {
        secretsClient = new SecretsManagerClient({
            region: process.env.AWS_REGION || 'us-west-2',
        });
    }
    return secretsClient;
}

function isJwtSecretValue(value: unknown): value is JWTSecretValue {
    if (!value || typeof value !== 'object') return false;
    const v = value as { keys?: unknown };
    if (!Array.isArray(v.keys) || v.keys.length === 0) return false;
    return v.keys.every(function isKeyMetadata(k) {
        if (!k || typeof k !== 'object') return false;
        const m = k as Record<string, unknown>;
        return typeof m.keyId === 'string'
            && typeof m.privateKey === 'string'
            && typeof m.status === 'string';
    });
}

async function fetchKeysFromAWS(secretName: string): Promise<KeyMetadata[]> {
    const response = await getSecretsClient().send(new GetSecretValueCommand({ SecretId: secretName }));
    if (!response.SecretString) {
        throw new Error(`Secret ${secretName} has no SecretString`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(response.SecretString);
    } catch (error) {
        throw new Error(`Secret ${secretName} is not valid JSON: ${(error as Error).message}`);
    }
    if (!isJwtSecretValue(parsed)) {
        throw new Error(`Secret ${secretName} is missing a non-empty 'keys' array of {keyId, privateKey, status}`);
    }
    const secretValue: JWTSecretValue = parsed;
    keyCache = { keys: secretValue.keys, cachedAt: new Date() };
    return secretValue.keys;
}

async function fetchKeys(secretName: string): Promise<KeyMetadata[]> {
    if (keyCache && (Date.now() - keyCache.cachedAt.getTime()) < KEY_CACHE_MAX_AGE_MS) {
        return keyCache.keys;
    }
    if (fetchKeysPromise) {
        return fetchKeysPromise;
    }
    fetchKeysPromise = fetchKeysFromAWS(secretName);
    try {
        return await fetchKeysPromise;
    } finally {
        fetchKeysPromise = null;
    }
}

async function getActiveKey(secretName: string): Promise<SigningKey> {
    const keys = await fetchKeys(secretName);
    const active = keys.find(key => key.status === 'active');
    if (!active) {
        throw new Error(`No active signing key found in secret ${secretName}`);
    }
    return { keyId: active.keyId, privateKey: active.privateKey };
}

function getStaticKey(): SigningKey {
    const privateKey = process.env.AGENT_JWT_PRIVATE_KEY;
    const keyId = process.env.AGENT_JWT_KEY_ID;
    if (!privateKey || !keyId) {
        throw new Error(
            'Agents JWT signing not configured: set JWT_SECRETS_NAME (preferred) ' +
            'or AGENT_JWT_PRIVATE_KEY + AGENT_JWT_KEY_ID'
        );
    }
    return { keyId, privateKey: privateKey.replace(/\\n/g, '\n') };
}

async function getSigningKey(): Promise<SigningKey> {
    const secretName = process.env.JWT_SECRETS_NAME;
    if (!secretName) {
        return getStaticKey();
    }

    try {
        return await getActiveKey(secretName);
    } catch (error) {
        if (process.env.AGENT_JWT_ALLOW_STATIC_FALLBACK === 'true') {
            logger.warn('agent-jwt.secrets-manager.fallback', {
                secretName,
                message: error instanceof Error ? error.message : String(error),
            });
            return getStaticKey();
        }
        logger.error('agent-jwt.secrets-manager.error', { secretName }, { error: error as Error });
        throw error;
    }
}

export async function mintAgentToken(options: AgentTokenOptions): Promise<TokenResult> {
    const { appId, canDownload = false, canPublish = false, canPurchaseDomain = false } = options;
    const { keyId, privateKey } = await getSigningKey();

    const now = Math.floor(Date.now() / 1000);
    const exp = now + TOKEN_TTL_SECONDS;

    const header = {
        typ: 'JWT',
        alg: ALGORITHM,
        kid: keyId,
    };

    const claims = {
        iss: ISSUER,
        aud: AUDIENCE,
        exp,
        iat: now,
        siteId: appId,
        canDownload,
        canPublish,
        canPurchaseDomain,
        authType: 'basic' as const,
        isE2S: false,
        useTestBudget: false,
        budgetServiceEnabled: false,
        enableAssessmentAgent: false,
        enableAssessmentOverride: false,
        product: 'AiroAppBuilder' as const,
        modelSelectorEnabled: false,
        costAttributionDryRun: false,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const message = `${headerB64}.${payloadB64}`;

    const sign = createSign('RSA-SHA256');
    sign.update(message);
    sign.end();
    const signature = sign.sign(privateKey, 'base64url');

    logger.debug('agent-jwt.minted', { appId, keyId, expiresAt: new Date(exp * 1000).toISOString() });

    return {
        token: `${message}.${signature}`,
        expires: new Date(exp * 1000),
    };
}
