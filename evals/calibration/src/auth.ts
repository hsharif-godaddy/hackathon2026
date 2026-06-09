import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { Page } from 'playwright';

import type { Logger } from './logger.js';

export interface BrowserAuthConfig {
  type: 'none' | 'form' | 'cookie' | 'sso';
  credentialsSecretId?: string;
  loginUrl?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  cookies?: Array<Record<string, unknown>>;
}

interface LoginCredentials {
  username: string;
  password: string;
}

const DEFAULT_SELECTORS = {
  username:
    'input[type="email"], input[name="username"], input[name="email"], #username, #email',
  password: 'input[type="password"], input[name="password"], #password',
  submit:
    'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in")',
};

const credentialsCache = new Map<string, { creds: LoginCredentials; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getCredentials(params: {
  region: string;
  secretId: string;
  log: Logger;
}): Promise<LoginCredentials> {
  const cached = credentialsCache.get(params.secretId);
  if (cached && Date.now() < cached.expiresAt) return cached.creds;

  params.log.info('auth.secrets.fetch.start', { secretId: params.secretId, region: params.region });
  const client = new SecretsManagerClient({ region: params.region });
  try {
    const res = await client.send(new GetSecretValueCommand({ SecretId: params.secretId }));
    if (!res.SecretString) throw new Error(`Secret ${params.secretId} is empty or binary`);
    const parsed = JSON.parse(res.SecretString) as Partial<LoginCredentials> | null;
    if (!parsed?.username || !parsed?.password) {
      throw new Error(`Secret ${params.secretId} must contain 'username' and 'password' fields`);
    }
    const creds: LoginCredentials = { username: parsed.username, password: parsed.password };
    credentialsCache.set(params.secretId, { creds, expiresAt: Date.now() + CACHE_TTL_MS });
    params.log.info('auth.secrets.fetch.done', { secretId: params.secretId });
    return creds;
  } finally {
    client.destroy();
  }
}

function joinSelectors(...parts: Array<string | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(', ');
}

async function applyFormAuth(params: {
  page: Page;
  auth: BrowserAuthConfig;
  region: string;
  startUrl: string;
  log: Logger;
}): Promise<void> {
  if (!params.auth.credentialsSecretId) {
    throw new Error('browserAuth.type=form requires credentialsSecretId');
  }

  const creds = await getCredentials({
    region: params.region,
    secretId: params.auth.credentialsSecretId,
    log: params.log,
  });

  const loginUrl = params.auth.loginUrl;
  if (!loginUrl) {
    throw new Error('browserAuth.type=form requires loginUrl');
  }

  params.log.info('auth.form.start', { loginUrl, startUrl: params.startUrl });
  await params.page.goto(loginUrl, { waitUntil: 'load', timeout: 60_000 });

  const usernameSel = joinSelectors(params.auth.usernameSelector, DEFAULT_SELECTORS.username);
  const passwordSel = joinSelectors(params.auth.passwordSelector, DEFAULT_SELECTORS.password);
  const submitSel = joinSelectors(params.auth.submitSelector, DEFAULT_SELECTORS.submit);

  await params.page.waitForSelector(usernameSel, { timeout: 15_000 });
  await params.page.fill(usernameSel, creds.username);
  await params.page.fill(passwordSel, creds.password);

  await Promise.all([
    params.page.waitForNavigation({ waitUntil: 'load', timeout: 60_000 }).catch(() => undefined),
    params.page.click(submitSel),
  ]);

  // Navigate back to preview URL after login if needed.
  if (params.page.url() !== params.startUrl) {
    await params.page.goto(params.startUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  params.log.info('auth.form.done', { finalUrl: params.page.url() });
}

export async function applyAuthentication(params: {
  page: Page;
  auth: BrowserAuthConfig | null;
  region: string;
  startUrl: string;
  log: Logger;
}): Promise<void> {
  if (!params.auth || params.auth.type === 'none') return;
  if (params.auth.type === 'form' || params.auth.type === 'sso') {
    await applyFormAuth({ ...params, auth: params.auth });
    return;
  }
  throw new Error(`Unsupported browserAuth.type: ${params.auth.type}`);
}

