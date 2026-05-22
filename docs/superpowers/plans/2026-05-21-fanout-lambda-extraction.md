# Fanout Lambda Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new AWS Lambda that subscribes to the existing `airo-builder-feedback-{env}` S3 bucket, reads each feedback parquet on creation, and fans out to Slack + CRM (CMAPI) + investigator-Lambda invoke. Adds 60-min sliding-window dedup via S3 state.json. Includes CDK stack, SQS DLQ, IAM, alarms, and switchboard-gated handler.

**Architecture:** S3 ObjectCreated event → fanout Lambda reads parquet → checks `dedup/{customerId}/{appId}/state.json` in same bucket for 60-min window → fresh path opens CRM case + posts Slack + invokes investigator; dedup-hit appends note to existing case. State written via S3 conditional writes (etag merge). Lambda is independent of PR #3946 (does not copy-paste from investigator/) — builds its own minimal CRM + cert utilities so it can land in any order.

**Tech Stack:** Node.js 22 ESM (`.mjs`), AWS Lambda (arm64), AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/client-lambda`, `@aws-sdk/client-secrets-manager`), `parquetjs` (matches AAB BFF schema), AWS CDK v2 (TypeScript), Vitest (CDK tests), Node `--test` (Lambda tests).

**Scope:** This plan covers PR #1 (Lambda + CDK + tests + flag-gated entry). PR #2 (BFF slim + flag-gated cutover) and PR #3 (cleanup) are separate plans, deferred until this PR is live in test.

---

## File structure

```
fanout/                                              ← NEW dir at repo root, peer of investigator/
├── handler.mjs                                       ← S3 event entry, orchestrates flow
├── handler.test.mjs                                  ← Node --test
├── parquet-reader.mjs                                ← parquet bytes → FeedbackS3Record
├── parquet-reader.test.mjs
├── state.mjs                                         ← state.json read / conditional-write / etag-merge
├── state.test.mjs
├── slack.mjs                                         ← webhook POST
├── slack.test.mjs
├── crm-client.mjs                                    ← POST case + GET case + POST note (own impl, not investigator copy)
├── crm-client.test.mjs
├── crm-token.mjs                                     ← cert→JWT cache (own impl)
├── crm-token.test.mjs
├── cert-loader.mjs                                   ← AWS Secrets Manager cert load
├── cert-loader.test.mjs
├── invoke-investigator.mjs                           ← Lambda InvokeAsync wrapper
├── invoke-investigator.test.mjs
├── secret-cache.mjs                                  ← Secrets Manager fetch + TTL cache (slack webhook)
├── secret-cache.test.mjs
├── package.json
├── README.md
└── Dockerfile

cdk/lib/feedback-fanout-stack.ts                     ← NEW CDK stack
cdk/test/feedback-fanout-stack.test.ts               ← snapshot test
cdk/bin/airo-app-builder-cdk.ts                      ← MODIFY: wire new stack into app
```

Each file does one thing. No file exceeds ~250 lines. Tests live next to code (matches investigator/ pattern).

---

## Setup tasks

### Task 0: Create the fanout/ workspace skeleton

**Files:**
- Create: `fanout/package.json`
- Create: `fanout/.gitignore`
- Create: `fanout/README.md`

- [ ] **Step 1: Create fanout/package.json**

```json
{
  "name": "@airo/fanout-lambda",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "test": "node --test --experimental-test-module-mocks './**/*.test.mjs'",
    "test:watch": "node --test --watch --experimental-test-module-mocks './**/*.test.mjs'"
  },
  "dependencies": {
    "@aws-sdk/client-lambda": "catalog:",
    "@aws-sdk/client-s3": "catalog:",
    "@aws-sdk/client-secrets-manager": "catalog:",
    "parquetjs": "0.11.2"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Create fanout/.gitignore**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 3: Create fanout/README.md**

```markdown
# Airo Fanout Lambda

S3-event-triggered Lambda that fans out feedback submissions to Slack, CRM (CMAPI), and the investigator Lambda.

## Architecture

See `docs/superpowers/specs/2026-05-21-fanout-lambda-extraction-design.md` for full design.

## Run tests

```bash
pnpm --filter @airo/fanout-lambda test
```

## Deploy

CDK stack: `cdk/lib/feedback-fanout-stack.ts`. Triggered by `cdk deploy FeedbackFanoutStack`.

## Switchboard flag

`appbuilder-fanout-via-lambda` (default OFF). Lambda exits cleanly when flag is OFF — safe to deploy anytime.
```

- [ ] **Step 4: Verify package layout matches monorepo**

Run: `ls fanout/ && cat fanout/package.json | head -10`
Expected: `package.json`, `.gitignore`, `README.md` listed; package name `@airo/fanout-lambda`.

- [ ] **Step 5: Commit**

```bash
git add fanout/
git commit -m "feat(fanout): scaffold Lambda workspace"
```

---

### Task 1: Add fanout to pnpm-workspace.yaml

**Files:**
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Read current pnpm-workspace.yaml**

```bash
cat pnpm-workspace.yaml
```

- [ ] **Step 2: Add `'fanout'` to `packages:` list**

If `pnpm-workspace.yaml` packages list looks like:
```yaml
packages:
  - "agents"
  - "app"
  - "investigator"
  - "packages/*"
```

Change to:
```yaml
packages:
  - "agents"
  - "app"
  - "fanout"
  - "investigator"
  - "packages/*"
```

(Alphabetical insertion between `app` and `investigator`.)

- [ ] **Step 3: Run pnpm install to register the workspace**

Run: `pnpm install`
Expected: pnpm picks up `@airo/fanout-lambda` workspace, resolves catalog deps.

- [ ] **Step 4: Verify install**

Run: `pnpm --filter @airo/fanout-lambda exec node -v`
Expected: prints node version (>= 22).

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(fanout): register workspace in pnpm-workspace.yaml"
```

---

## Cert + token + secrets layer

### Task 2: cert-loader.mjs — AWS Secrets Manager cert fetch

**Files:**
- Create: `fanout/cert-loader.mjs`
- Create: `fanout/cert-loader.test.mjs`

- [ ] **Step 1: Write the failing test**

`fanout/cert-loader.test.mjs`:

```javascript
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

await test('loadCertSecret returns parsed cert object', async () => {
  const mockSend = mock.fn(async () => ({
    SecretString: JSON.stringify({ cert: '-----BEGIN CERT-----', key: '-----BEGIN KEY-----' }),
  }));
  mock.module('@aws-sdk/client-secrets-manager', {
    namedExports: {
      SecretsManagerClient: class { send = mockSend; },
      GetSecretValueCommand: class { constructor(input) { this.input = input; } },
    },
  });

  const { loadCertSecret } = await import('./cert-loader.mjs');
  const result = await loadCertSecret('arn:aws:secretsmanager:...:cert');
  assert.equal(result.cert, '-----BEGIN CERT-----');
  assert.equal(result.key, '-----BEGIN KEY-----');
});

await test('loadCertSecret throws on missing SecretString', async () => {
  const mockSend = mock.fn(async () => ({}));
  mock.module('@aws-sdk/client-secrets-manager', {
    namedExports: {
      SecretsManagerClient: class { send = mockSend; },
      GetSecretValueCommand: class { constructor(input) { this.input = input; } },
    },
  });

  const { loadCertSecret } = await import('./cert-loader.mjs');
  await assert.rejects(() => loadCertSecret('arn:bad'), /SecretString missing/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/fanout-lambda test cert-loader.test.mjs`
Expected: FAIL — `cert-loader.mjs` not found.

- [ ] **Step 3: Implement cert-loader.mjs**

```javascript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const client = new SecretsManagerClient({ region: REGION });

/**
 * Load cert + key from Secrets Manager. Cert secret format: JSON with
 * { cert: string, key: string }. Key is PEM-encoded private key.
 *
 * Caching is the caller's responsibility (see crm-token.mjs).
 */
export async function loadCertSecret(secretArn) {
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!result.SecretString) {
    throw new Error(`SecretString missing for secret ${secretArn}`);
  }
  const parsed = JSON.parse(result.SecretString);
  if (typeof parsed.cert !== 'string' || typeof parsed.key !== 'string') {
    throw new Error(`Cert secret ${secretArn} missing 'cert' or 'key' field`);
  }
  return { cert: parsed.cert, key: parsed.key };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @airo/fanout-lambda test cert-loader.test.mjs`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add fanout/cert-loader.mjs fanout/cert-loader.test.mjs
git commit -m "feat(fanout): cert-loader for Secrets Manager cert fetch"
```

---

### Task 3: crm-token.mjs — cert→JWT mint with TTL cache

**Files:**
- Create: `fanout/crm-token.mjs`
- Create: `fanout/crm-token.test.mjs`

- [ ] **Step 1: Write the failing test**

`fanout/crm-token.test.mjs`:

```javascript
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let mockFetch;
beforeEach(() => {
  mockFetch = mock.fn();
  globalThis.fetch = mockFetch;
});

await test('getCrmJwt mints token via SSO API and caches by exp', async () => {
  mockFetch.mock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({
      data: 'eyJhbGciOi.eyJleHAiOjk5OTk5OTk5OTl9.sig',
    }),
  }));

  mock.module('./cert-loader.mjs', {
    namedExports: {
      loadCertSecret: async () => ({ cert: 'C', key: 'K' }),
    },
  });

  const { getCrmJwt, _resetCache } = await import('./crm-token.mjs');
  _resetCache();
  const tok1 = await getCrmJwt({ certSecretArn: 'arn:cert', ssoUrl: 'https://sso/jwt' });
  const tok2 = await getCrmJwt({ certSecretArn: 'arn:cert', ssoUrl: 'https://sso/jwt' });
  assert.equal(tok1, tok2, 'cached on second call');
  assert.equal(mockFetch.mock.callCount(), 1, 'SSO called once');
});

await test('getCrmJwt re-mints when token expired', async () => {
  let callCount = 0;
  mockFetch.mock.mockImplementation(async () => {
    callCount++;
    const now = Math.floor(Date.now() / 1000);
    const exp = callCount === 1 ? now - 10 : now + 3600;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        data: `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.sig`,
      }),
    };
  });

  mock.module('./cert-loader.mjs', {
    namedExports: { loadCertSecret: async () => ({ cert: 'C', key: 'K' }) },
  });

  const { getCrmJwt, _resetCache } = await import('./crm-token.mjs');
  _resetCache();
  await getCrmJwt({ certSecretArn: 'arn:cert', ssoUrl: 'https://sso/jwt' });
  await getCrmJwt({ certSecretArn: 'arn:cert', ssoUrl: 'https://sso/jwt' });
  assert.equal(mockFetch.mock.callCount(), 2, 'SSO called twice (expired re-mint)');
});

await test('getCrmJwt throws on non-2xx', async () => {
  mockFetch.mock.mockImplementation(async () => ({
    ok: false,
    status: 503,
    headers: { get: () => 'text/plain' },
    text: async () => 'unavailable',
  }));
  mock.module('./cert-loader.mjs', {
    namedExports: { loadCertSecret: async () => ({ cert: 'C', key: 'K' }) },
  });
  const { getCrmJwt, _resetCache } = await import('./crm-token.mjs');
  _resetCache();
  await assert.rejects(
    () => getCrmJwt({ certSecretArn: 'arn:cert', ssoUrl: 'https://sso/jwt' }),
    /SSO 503/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/fanout-lambda test crm-token.test.mjs`
Expected: FAIL — `crm-token.mjs` missing.

- [ ] **Step 3: Implement crm-token.mjs**

```javascript
import { loadCertSecret } from './cert-loader.mjs';

let cache = null;

/** Test-only: clear the in-process cache. Do not call from production code. */
export function _resetCache() {
  cache = null;
}

/**
 * Mint and cache a Cert JWT for CMAPI auth.
 *
 * Flow: load { cert, key } from Secrets Manager → POST cert+key to GoDaddy
 * SSO API → receive JWT → decode `exp` to drive cache TTL.
 *
 * Cache lifetime: until 60s before token's own `exp`. Re-mints automatically
 * once the cached token is within 60s of expiry.
 */
export async function getCrmJwt({ certSecretArn, ssoUrl }) {
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.exp - 60 > now) {
    return cache.token;
  }
  const { cert, key } = await loadCertSecret(certSecretArn);

  const res = await fetch(ssoUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cert, key }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SSO ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  const parsed = JSON.parse(text);
  const token = typeof parsed === 'string' ? parsed : (parsed.data ?? parsed.token ?? parsed.access_token);
  if (typeof token !== 'string') {
    throw new Error('SSO response missing token field');
  }

  let exp = now + 600;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    if (typeof payload.exp === 'number') exp = payload.exp;
  } catch {
    // fallback exp already set
  }

  cache = { token, exp };
  return token;
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @airo/fanout-lambda test crm-token.test.mjs`
Expected: PASS — three tests green.

- [ ] **Step 5: Commit**

```bash
git add fanout/crm-token.mjs fanout/crm-token.test.mjs
git commit -m "feat(fanout): cert-based CRM JWT minting with exp-driven cache"
```

---

### Task 4: secret-cache.mjs — TTL-cached Secrets Manager fetch (for Slack webhook)

**Files:**
- Create: `fanout/secret-cache.mjs`
- Create: `fanout/secret-cache.test.mjs`

- [ ] **Step 1: Write the failing test**

`fanout/secret-cache.test.mjs`:

```javascript
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

await test('getSecretString caches values for TTL window', async () => {
  let callCount = 0;
  const mockSend = mock.fn(async () => {
    callCount++;
    return { SecretString: 'webhook-url' };
  });
  mock.module('@aws-sdk/client-secrets-manager', {
    namedExports: {
      SecretsManagerClient: class { send = mockSend; },
      GetSecretValueCommand: class { constructor(i) { this.input = i; } },
    },
  });

  const { getSecretString, _resetCache } = await import('./secret-cache.mjs');
  _resetCache();
  const v1 = await getSecretString('arn:foo');
  const v2 = await getSecretString('arn:foo');
  assert.equal(v1, 'webhook-url');
  assert.equal(v2, 'webhook-url');
  assert.equal(callCount, 1);
});

await test('getSecretString throws on missing SecretString', async () => {
  const mockSend = mock.fn(async () => ({}));
  mock.module('@aws-sdk/client-secrets-manager', {
    namedExports: {
      SecretsManagerClient: class { send = mockSend; },
      GetSecretValueCommand: class { constructor(i) { this.input = i; } },
    },
  });
  const { getSecretString, _resetCache } = await import('./secret-cache.mjs');
  _resetCache();
  await assert.rejects(() => getSecretString('arn:bad'), /SecretString missing/);
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `pnpm --filter @airo/fanout-lambda test secret-cache.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement secret-cache.mjs**

```javascript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const TTL_MS = 5 * 60 * 1000;
const client = new SecretsManagerClient({ region: REGION });
const cache = new Map();

export function _resetCache() {
  cache.clear();
}

/** Returns the SecretString for the given ARN with a 5-minute in-process cache. */
export async function getSecretString(secretArn) {
  const cached = cache.get(secretArn);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!result.SecretString) {
    throw new Error(`SecretString missing for secret ${secretArn}`);
  }
  cache.set(secretArn, { value: result.SecretString, expiresAt: now + TTL_MS });
  return result.SecretString;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @airo/fanout-lambda test secret-cache.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanout/secret-cache.mjs fanout/secret-cache.test.mjs
git commit -m "feat(fanout): TTL-cached Secrets Manager fetch helper"
```

---

## CRM client layer

### Task 5: crm-client.mjs — POST case + GET case + POST note

**Files:**
- Create: `fanout/crm-client.mjs`
- Create: `fanout/crm-client.test.mjs`

- [ ] **Step 1: Write the failing test**

`fanout/crm-client.test.mjs`:

```javascript
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let mockFetch;
beforeEach(() => {
  mockFetch = mock.fn();
  globalThis.fetch = mockFetch;
  mock.module('./crm-token.mjs', {
    namedExports: { getCrmJwt: async () => 'JWT' },
  });
});

const baseConfig = { crmBaseUrl: 'https://crm.test', certSecretArn: 'arn', ssoUrl: 'https://sso' };

await test('postCase returns extracted caseId, caseNumber, created flag', async () => {
  mockFetch.mock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({
      id: '500U900000TP4kYIAT',
      caseNumber: '00012345',
      created: true,
    }),
  }));
  const { postCase } = await import('./crm-client.mjs');
  const r = await postCase({
    ...baseConfig,
    body: { contactName: 'A B', externalSystemId: 'airo-cust-app-uuid' },
  });
  assert.equal(r.caseId, '500U900000TP4kYIAT');
  assert.equal(r.caseNumber, '00012345');
  assert.equal(r.created, true);
});

await test('postCase throws on 5xx', async () => {
  mockFetch.mock.mockImplementation(async () => ({
    ok: false,
    status: 503,
    headers: { get: () => 'text/plain' },
    text: async () => 'unavailable',
  }));
  const { postCase } = await import('./crm-client.mjs');
  await assert.rejects(
    () => postCase({ ...baseConfig, body: { contactName: 'A' } }),
    /CMAPI POST 503/,
  );
});

await test('getCase returns case with status', async () => {
  mockFetch.mock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({
      data: { cases: [{ caseRecordId: '500U900000TP4kYIAT', status: 'Open' }] },
    }),
  }));
  const { getCase } = await import('./crm-client.mjs');
  const r = await getCase({ ...baseConfig, caseId: '500U900000TP4kYIAT' });
  assert.equal(r.caseRecordId, '500U900000TP4kYIAT');
  assert.equal(r.status, 'Open');
});

await test('getCase returns null when no cases found', async () => {
  mockFetch.mock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ data: { cases: [] } }),
  }));
  const { getCase } = await import('./crm-client.mjs');
  const r = await getCase({ ...baseConfig, caseId: '500U900000TP4kYIAT' });
  assert.equal(r, null);
});

await test('postNote returns void on 200', async () => {
  mockFetch.mock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => '{}',
  }));
  const { postNote } = await import('./crm-client.mjs');
  await postNote({ ...baseConfig, caseRecordId: '500U900000TP4kYIAT', note: 'hello' });
  // no throw
  assert.equal(mockFetch.mock.callCount(), 1);
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `pnpm --filter @airo/fanout-lambda test crm-client.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement crm-client.mjs**

```javascript
import { getCrmJwt } from './crm-token.mjs';

const TIMEOUT_MS = 30_000;
const CASE_PATH = '/api/case-management/v1/case';
const NOTE_PATH = '/api/case-management/v1/case/note';

async function authedFetch({ crmBaseUrl, certSecretArn, ssoUrl, path, init }) {
  const token = await getCrmJwt({ certSecretArn, ssoUrl });
  const url = `${crmBaseUrl}${path}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `sso-jwt ${token}`,
        ...(init?.headers ?? {}),
      },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/**
 * POST /v1/case — open new CRM case (or upsert via externalSystemId).
 *
 * Returns: { caseId, caseNumber, referenceId, created }
 *   caseId        — SF Record ID (18-char, e.g. 500U900000TP4kYIAT). null if response shape differs.
 *   caseNumber    — human-readable case number (e.g. 00012345). null if missing.
 *   referenceId   — async-mode CMAPI reference ID. Only present when CMAPI returns 202.
 *   created       — true on insert, false on upsert (existing externalSystemId match).
 *
 * Throws on 4xx/5xx.
 */
export async function postCase({ crmBaseUrl, certSecretArn, ssoUrl, body }) {
  const res = await authedFetch({
    crmBaseUrl,
    certSecretArn,
    ssoUrl,
    path: CASE_PATH,
    init: { method: 'POST', body: JSON.stringify(body) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`CMAPI POST ${res.status}: ${text.slice(0, 300)}`);
  }
  let parsed = {};
  try { parsed = JSON.parse(text); } catch {}
  return {
    caseId: parsed.id ?? parsed.caseId ?? null,
    caseNumber: parsed.caseNumber ?? null,
    referenceId: parsed.referenceId ?? null,
    created: parsed.created ?? null,
  };
}

/**
 * GET /v1/case?caseId=... — fetch case state.
 *
 * Returns the first case object from `data.cases[]` or null when not found.
 * Throws on non-2xx (404 surfaces as null only when CMAPI returns 200 + empty cases array).
 */
export async function getCase({ crmBaseUrl, certSecretArn, ssoUrl, caseId }) {
  const path = `${CASE_PATH}?caseId=${encodeURIComponent(caseId)}&includeNotes=internal`;
  const res = await authedFetch({ crmBaseUrl, certSecretArn, ssoUrl, path, init: { method: 'GET' } });
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`CMAPI GET ${res.status}: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(text);
  const cases = parsed?.data?.cases ?? [];
  return cases.length > 0 ? cases[0] : null;
}

/** POST /v1/case/note — append a note. */
export async function postNote({ crmBaseUrl, certSecretArn, ssoUrl, caseRecordId, note }) {
  const body = {
    caseRecordId,
    note,
    noteType: 'Status Change',
    noteTypeDetails: 'Pending',
  };
  const res = await authedFetch({
    crmBaseUrl,
    certSecretArn,
    ssoUrl,
    path: NOTE_PATH,
    init: { method: 'POST', body: JSON.stringify(body) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CMAPI note ${res.status}: ${text.slice(0, 300)}`);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @airo/fanout-lambda test crm-client.test.mjs`
Expected: PASS — five tests green.

- [ ] **Step 5: Commit**

```bash
git add fanout/crm-client.mjs fanout/crm-client.test.mjs
git commit -m "feat(fanout): CMAPI client (POST case + GET case + POST note)"
```

---

## Parquet reader

### Task 6: parquet-reader.mjs

**Files:**
- Create: `fanout/parquet-reader.mjs`
- Create: `fanout/parquet-reader.test.mjs`

- [ ] **Step 1: Write the failing test**

`fanout/parquet-reader.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function buildTestParquet(row) {
  const { ParquetSchema, ParquetWriter } = require('parquetjs');
  const schema = new ParquetSchema({
    feedback_id: { type: 'UTF8' },
    customer_id: { type: 'UTF8', optional: true },
    app_id: { type: 'UTF8', optional: true },
    feedback_utc_ts: { type: 'TIMESTAMP_MILLIS' },
    feedback_text: { type: 'UTF8', optional: true },
    consent_flag: { type: 'BOOLEAN', optional: true },
    rating: { type: 'INT32', optional: true },
    feedback_origin_name: { type: 'UTF8', optional: true },
    cln_create_utc_ts: { type: 'TIMESTAMP_MILLIS' },
  });

  const chunks = [];
  const stream = {
    write(buf, cb) { chunks.push(buf); cb(); },
    close(cb) { if (cb) cb(); },
  };
  const writer = await ParquetWriter.openStream(schema, stream, { useDataPageV2: true });
  await writer.appendRow(row);
  await writer.close();
  return Buffer.concat(chunks);
}

await test('parseFeedbackParquet decodes single row', async () => {
  const buf = await buildTestParquet({
    feedback_id: 'sub-1',
    customer_id: 'cust-1',
    app_id: 'app-1',
    feedback_utc_ts: new Date(1747834200000),
    feedback_text: 'broken',
    consent_flag: true,
    rating: 3,
    feedback_origin_name: 'issue',
    cln_create_utc_ts: new Date(1747834200000),
  });

  const { parseFeedbackParquet } = await import('./parquet-reader.mjs');
  const rec = await parseFeedbackParquet(buf);
  assert.equal(rec.feedback_id, 'sub-1');
  assert.equal(rec.customer_id, 'cust-1');
  assert.equal(rec.app_id, 'app-1');
  assert.equal(rec.feedback_text, 'broken');
  assert.equal(rec.rating, 3);
  assert.equal(rec.feedback_origin_name, 'issue');
});

await test('parseFeedbackParquet throws on empty buffer', async () => {
  const { parseFeedbackParquet } = await import('./parquet-reader.mjs');
  await assert.rejects(() => parseFeedbackParquet(Buffer.alloc(0)), /parquet/i);
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `pnpm --filter @airo/fanout-lambda test parquet-reader.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement parquet-reader.mjs**

```javascript
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';

const require = createRequire(import.meta.url);
const { ParquetReader } = require('parquetjs');

/**
 * Parse a single-row feedback parquet buffer into a record matching the
 * AAB BFF's FeedbackS3Record shape (see
 * `app/src/app/api/feedback/s3-store/types.ts`).
 *
 * The buffer comes directly from S3 GetObject. parquetjs requires either a
 * file path or a stream-of-stream API; we wrap the buffer in a temp file via
 * the openBuffer helper if available, else fall back to writing to /tmp.
 */
export async function parseFeedbackParquet(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('parquet buffer is empty');
  }

  // parquetjs's openBuffer is the canonical buffer entrypoint.
  if (typeof ParquetReader.openBuffer === 'function') {
    const reader = await ParquetReader.openBuffer(buffer);
    const cursor = reader.getCursor();
    const row = await cursor.next();
    await reader.close();
    if (!row) throw new Error('parquet contained zero rows');
    return row;
  }

  // Fallback: write to /tmp and read via openFile (Lambda has /tmp scratch).
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'fanout-parquet-'));
  const file = path.join(dir, 'in.parquet');
  writeFileSync(file, buffer);
  try {
    const reader = await ParquetReader.openFile(file);
    const cursor = reader.getCursor();
    const row = await cursor.next();
    await reader.close();
    if (!row) throw new Error('parquet contained zero rows');
    return row;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @airo/fanout-lambda test parquet-reader.test.mjs`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add fanout/parquet-reader.mjs fanout/parquet-reader.test.mjs
git commit -m "feat(fanout): parquet reader for feedback row decode"
```

---

## State (dedup) layer

### Task 7: state.mjs — read + conditional write + etag merge

**Files:**
- Create: `fanout/state.mjs`
- Create: `fanout/state.test.mjs`

- [ ] **Step 1: Write the failing test**

`fanout/state.test.mjs`:

```javascript
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let s3Client;
beforeEach(() => {
  s3Client = { send: mock.fn() };
  mock.module('@aws-sdk/client-s3', {
    namedExports: {
      S3Client: class { constructor() { return s3Client; } },
      GetObjectCommand: class { constructor(i) { this.input = i; } },
      PutObjectCommand: class { constructor(i) { this.input = i; } },
    },
  });
});

await test('readState returns null on 404', async () => {
  s3Client.send.mock.mockImplementation(async () => {
    const e = new Error('NoSuchKey');
    e.name = 'NoSuchKey';
    throw e;
  });
  const { readState } = await import('./state.mjs');
  const r = await readState({ bucket: 'b', customerId: 'c1', appId: 'a1' });
  assert.equal(r, null);
});

await test('readState parses JSON + etag', async () => {
  s3Client.send.mock.mockImplementation(async () => ({
    Body: { transformToString: async () => JSON.stringify({
      schemaVersion: 1, submissionId: 's', crmCaseId: 'C1',
      startedAt: 100, lastUpdatedAt: 200,
    }) },
    ETag: '"etag1"',
  }));
  const { readState } = await import('./state.mjs');
  const r = await readState({ bucket: 'b', customerId: 'c1', appId: 'a1' });
  assert.equal(r.state.crmCaseId, 'C1');
  assert.equal(r.etag, '"etag1"');
});

await test('writeStateConditional uses IfNoneMatch on first write', async () => {
  s3Client.send.mock.mockImplementation(async () => ({}));
  const { writeStateConditional } = await import('./state.mjs');
  await writeStateConditional({
    bucket: 'b', customerId: 'c1', appId: 'a1',
    state: { schemaVersion: 1, submissionId: 's', crmCaseId: null, startedAt: 1, lastUpdatedAt: 1 },
  });
  const cmd = s3Client.send.mock.calls[0].arguments[0];
  assert.equal(cmd.input.IfNoneMatch, '*');
});

await test('writeStateConditional uses IfMatch on update', async () => {
  s3Client.send.mock.mockImplementation(async () => ({}));
  const { writeStateConditional } = await import('./state.mjs');
  await writeStateConditional({
    bucket: 'b', customerId: 'c1', appId: 'a1',
    state: { schemaVersion: 1, submissionId: 's', crmCaseId: 'C1', startedAt: 1, lastUpdatedAt: 1 },
    ifMatchEtag: '"etag1"',
  });
  const cmd = s3Client.send.mock.calls[0].arguments[0];
  assert.equal(cmd.input.IfMatch, '"etag1"');
});

await test('writeStateConditional rethrows 412 with name PreconditionFailed', async () => {
  s3Client.send.mock.mockImplementation(async () => {
    const e = new Error('PreconditionFailed');
    e.$metadata = { httpStatusCode: 412 };
    e.name = 'PreconditionFailed';
    throw e;
  });
  const { writeStateConditional } = await import('./state.mjs');
  await assert.rejects(
    () => writeStateConditional({
      bucket: 'b', customerId: 'c1', appId: 'a1',
      state: { schemaVersion: 1, submissionId: 's', crmCaseId: null, startedAt: 1, lastUpdatedAt: 1 },
    }),
    (err) => err.name === 'PreconditionFailed',
  );
});

await test('keyFor URL-encodes customerId and appId', async () => {
  const { keyFor } = await import('./state.mjs');
  assert.equal(keyFor('cust/1', 'app#a'), 'dedup/cust%2F1/app%23a/state.json');
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `pnpm --filter @airo/fanout-lambda test state.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement state.mjs**

```javascript
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const client = new S3Client({ region: REGION });

/** Build the dedup state.json key for a (customerId, appId) tuple. */
export function keyFor(customerId, appId) {
  return `dedup/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/state.json`;
}

/**
 * Read the dedup state for (customerId, appId). Returns:
 *   - null on 404 / NoSuchKey
 *   - { state, etag } on hit
 *
 * Throws on JSON parse failure (caller treats as fresh path).
 */
export async function readState({ bucket, customerId, appId }) {
  const Key = keyFor(customerId, appId);
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key }));
    const text = await result.Body.transformToString();
    const state = JSON.parse(text);
    return { state, etag: result.ETag };
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/**
 * Write state.json with conditional semantics.
 *
 * - If `ifMatchEtag` provided → uses IfMatch (update).
 * - Else → uses IfNoneMatch: '*' (create-only).
 *
 * Throws on any S3 error including 412 PreconditionFailed (caller decides
 * whether to retry the read-modify-write or abort).
 */
export async function writeStateConditional({ bucket, customerId, appId, state, ifMatchEtag }) {
  const Key = keyFor(customerId, appId);
  const conditional = ifMatchEtag
    ? { IfMatch: ifMatchEtag }
    : { IfNoneMatch: '*' };
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key,
    Body: JSON.stringify(state),
    ContentType: 'application/json',
    ...conditional,
  }));
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @airo/fanout-lambda test state.test.mjs`
Expected: PASS — six tests green.

- [ ] **Step 5: Commit**

```bash
git add fanout/state.mjs fanout/state.test.mjs
git commit -m "feat(fanout): S3 state.json with conditional read-modify-write"
```

---

## Slack + invoke layers

### Task 8: slack.mjs — webhook POST

**Files:**
- Create: `fanout/slack.mjs`
- Create: `fanout/slack.test.mjs`

- [ ] **Step 1: Write the failing test**

`fanout/slack.test.mjs`:

```javascript
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let mockFetch;
beforeEach(() => {
  mockFetch = mock.fn();
  globalThis.fetch = mockFetch;
  mock.module('./secret-cache.mjs', {
    namedExports: { getSecretString: async () => 'https://hooks.slack.com/services/XYZ' },
  });
});

await test('postSlackMessage POSTs JSON to webhook URL', async () => {
  mockFetch.mock.mockImplementation(async () => ({ ok: true, status: 200 }));
  const { postSlackMessage } = await import('./slack.mjs');
  await postSlackMessage({
    secretArn: 'arn:slack',
    payload: { customerId: 'c', appId: 'a', category: 'issue', body: 'broken', caseNumber: '999' },
  });
  const [url, init] = mockFetch.mock.calls[0].arguments;
  assert.equal(url, 'https://hooks.slack.com/services/XYZ');
  assert.equal(init.method, 'POST');
  assert.match(init.body, /broken/);
  assert.match(init.body, /999/);
});

await test('postSlackMessage throws on non-2xx', async () => {
  mockFetch.mock.mockImplementation(async () => ({ ok: false, status: 500, text: async () => 'oops' }));
  const { postSlackMessage } = await import('./slack.mjs');
  await assert.rejects(
    () => postSlackMessage({ secretArn: 'arn:slack', payload: { customerId: 'c', appId: 'a', category: 'issue', body: 'b' } }),
    /Slack 500/,
  );
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `pnpm --filter @airo/fanout-lambda test slack.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement slack.mjs**

```javascript
import { getSecretString } from './secret-cache.mjs';

const TIMEOUT_MS = 10_000;

/**
 * POST a formatted Slack webhook message. Block format keeps category, rating,
 * customerId, appId, and body distinct so the channel watcher can scan
 * headlines without expanding.
 *
 * @param {object} args
 * @param {string} args.secretArn - Secrets Manager ARN holding the webhook URL.
 * @param {object} args.payload - { customerId, appId, category, rating?, body, caseNumber? }
 */
export async function postSlackMessage({ secretArn, payload }) {
  const url = await getSecretString(secretArn);
  const body = renderSlackBlocks(payload);

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Slack ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

function renderSlackBlocks({ customerId, appId, category, rating, body, caseNumber }) {
  const headline = `:airo: New ${category} feedback`;
  const meta = [
    `*customer*: \`${customerId}\``,
    `*app*: \`${appId}\``,
    rating != null ? `*rating*: ${rating}` : null,
    caseNumber ? `*case*: ${caseNumber}` : null,
  ].filter(Boolean).join('  •  ');

  return {
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: headline } },
      { type: 'section', text: { type: 'mrkdwn', text: meta } },
      { type: 'section', text: { type: 'mrkdwn', text: '```' + (body ?? '').slice(0, 2000) + '```' } },
    ],
  };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @airo/fanout-lambda test slack.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanout/slack.mjs fanout/slack.test.mjs
git commit -m "feat(fanout): Slack webhook POST with block-format message"
```

---

### Task 9: invoke-investigator.mjs — Lambda InvokeAsync wrapper

**Files:**
- Create: `fanout/invoke-investigator.mjs`
- Create: `fanout/invoke-investigator.test.mjs`

- [ ] **Step 1: Write the failing test**

`fanout/invoke-investigator.test.mjs`:

```javascript
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let lambdaClient;
beforeEach(() => {
  lambdaClient = { send: mock.fn() };
  mock.module('@aws-sdk/client-lambda', {
    namedExports: {
      LambdaClient: class { constructor() { return lambdaClient; } },
      InvokeCommand: class { constructor(i) { this.input = i; } },
    },
  });
});

await test('invokeInvestigator sends async invocation with payload', async () => {
  lambdaClient.send.mock.mockImplementation(async () => ({ StatusCode: 202 }));
  const { invokeInvestigator } = await import('./invoke-investigator.mjs');
  await invokeInvestigator({
    functionName: 'airo-investigator-test',
    payload: { investigationId: 'inv-1', customerId: 'c', appId: 'a' },
  });
  const cmd = lambdaClient.send.mock.calls[0].arguments[0];
  assert.equal(cmd.input.FunctionName, 'airo-investigator-test');
  assert.equal(cmd.input.InvocationType, 'Event');
  const decoded = JSON.parse(Buffer.from(cmd.input.Payload).toString('utf-8'));
  assert.equal(decoded.investigationId, 'inv-1');
});

await test('invokeInvestigator throws on non-202', async () => {
  lambdaClient.send.mock.mockImplementation(async () => ({ StatusCode: 500 }));
  const { invokeInvestigator } = await import('./invoke-investigator.mjs');
  await assert.rejects(
    () => invokeInvestigator({ functionName: 'fn', payload: {} }),
    /InvokeAsync returned 500/,
  );
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `pnpm --filter @airo/fanout-lambda test invoke-investigator.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement invoke-investigator.mjs**

```javascript
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const client = new LambdaClient({ region: REGION });

/**
 * Async-invoke the investigator Lambda. Returns when AWS accepts the
 * invocation (StatusCode === 202). Does NOT wait for investigator to finish
 * — that would defeat the whole point of async fanout.
 */
export async function invokeInvestigator({ functionName, payload }) {
  const result = await client.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload), 'utf-8'),
  }));
  if (result.StatusCode !== 202) {
    throw new Error(`InvokeAsync returned ${result.StatusCode} (expected 202)`);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @airo/fanout-lambda test invoke-investigator.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add fanout/invoke-investigator.mjs fanout/invoke-investigator.test.mjs
git commit -m "feat(fanout): async invocation wrapper for investigator Lambda"
```

---

## Handler orchestration

### Task 10: handler.mjs — S3 event entry + flow orchestration

**Files:**
- Create: `fanout/handler.mjs`
- Create: `fanout/handler.test.mjs`

- [ ] **Step 1: Write the failing test**

`fanout/handler.test.mjs`:

```javascript
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let s3Client;
let calls;
beforeEach(() => {
  calls = { postCase: [], getCase: [], postNote: [], slack: [], invoke: [], stateRead: [], stateWrite: [] };
  s3Client = { send: mock.fn() };

  mock.module('@aws-sdk/client-s3', {
    namedExports: {
      S3Client: class { constructor() { return s3Client; } },
      GetObjectCommand: class { constructor(i) { this.input = i; } },
      PutObjectCommand: class { constructor(i) { this.input = i; } },
    },
  });

  mock.module('./parquet-reader.mjs', {
    namedExports: {
      parseFeedbackParquet: async () => ({
        feedback_id: 'sub-1',
        customer_id: 'cust-1',
        app_id: 'app-1',
        feedback_text: 'broken',
        rating: 2,
        consent_flag: true,
        feedback_origin_name: 'issue',
        feedback_topic_list: '["ui"]',
      }),
    },
  });

  mock.module('./state.mjs', {
    namedExports: {
      keyFor: (c, a) => `dedup/${c}/${a}/state.json`,
      readState: async (a) => { calls.stateRead.push(a); return null; },
      writeStateConditional: async (a) => { calls.stateWrite.push(a); },
    },
  });

  mock.module('./crm-client.mjs', {
    namedExports: {
      postCase: async (a) => {
        calls.postCase.push(a);
        return { caseId: '500U900000TP4kYIAT', caseNumber: '00012345', referenceId: null, created: true };
      },
      getCase: async (a) => { calls.getCase.push(a); return { caseRecordId: '500U900000TP4kYIAT', status: 'Open' }; },
      postNote: async (a) => { calls.postNote.push(a); },
    },
  });

  mock.module('./slack.mjs', {
    namedExports: { postSlackMessage: async (a) => { calls.slack.push(a); } },
  });

  mock.module('./invoke-investigator.mjs', {
    namedExports: { invokeInvestigator: async (a) => { calls.invoke.push(a); } },
  });

  // Default env
  process.env.FEEDBACK_BUCKET = 'airo-builder-feedback-test';
  process.env.INVESTIGATE_LAMBDA_FN = 'airo-investigator-test';
  process.env.SLACK_WEBHOOK_SECRET_ARN = 'arn:slack';
  process.env.CRM_BASE_URL = 'https://crm.test';
  process.env.CERT_SECRET_ARN = 'arn:cert';
  process.env.SSO_URL = 'https://sso/jwt';
  process.env.DEBUG_CONSOLE_BASE_URL = 'https://console.airo-builder.test-godaddy.com';
  delete process.env.FANOUT_VIA_LAMBDA_DISABLED;
});

const buildEvent = () => ({
  Records: [{
    s3: {
      bucket: { name: 'airo-builder-feedback-test' },
      object: { key: 'table_prefix/year=2026/month=05/day=21/hour=11/appId=app-1/2026-05-21T11:30:00Z-sub-1.parquet' },
    },
  }],
});

await test('fresh path: opens case, writes state, posts Slack + kickoff note + invoke investigator', async () => {
  s3Client.send.mock.mockImplementation(async () => ({
    Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
  }));
  const { handler } = await import('./handler.mjs');
  await handler(buildEvent());

  assert.equal(calls.stateRead.length, 1);
  assert.equal(calls.stateWrite.length, 2, 'lock + caseId update');
  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.slack.length, 1);
  assert.equal(calls.postNote.length, 1, 'kickoff note');
  assert.equal(calls.invoke.length, 1);
  assert.equal(calls.postCase[0].body.externalSystemId, 'airo-cust-1-app-1-sub-1');
});

await test('exits cleanly when FANOUT_VIA_LAMBDA_DISABLED=true', async () => {
  process.env.FANOUT_VIA_LAMBDA_DISABLED = 'true';
  const { handler } = await import('./handler.mjs');
  await handler(buildEvent());

  assert.equal(calls.stateRead.length, 0);
  assert.equal(calls.postCase.length, 0);
});

await test('dedup hit within 60min: appends note, skips Slack and investigator', async () => {
  s3Client.send.mock.mockImplementation(async () => ({
    Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
  }));
  mock.module('./state.mjs', {
    namedExports: {
      keyFor: (c, a) => `dedup/${c}/${a}/state.json`,
      readState: async () => ({
        state: {
          schemaVersion: 1, submissionId: 'old', crmCaseId: '500U900000TP4kYIAT',
          startedAt: Date.now() - 30 * 60 * 1000,
          lastUpdatedAt: Date.now() - 30 * 60 * 1000,
        },
        etag: '"e1"',
      }),
      writeStateConditional: async (a) => { calls.stateWrite.push(a); },
    },
  });

  const { handler } = await import('./handler.mjs');
  await handler(buildEvent());

  assert.equal(calls.getCase.length, 1, 'verifies case still open');
  assert.equal(calls.postNote.length, 1, 'appends duplicate note');
  assert.equal(calls.slack.length, 0, 'no Slack on dedup');
  assert.equal(calls.invoke.length, 0, 'no investigator on dedup');
});

await test('stale state (case closed): falls through to fresh path', async () => {
  s3Client.send.mock.mockImplementation(async () => ({
    Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
  }));
  mock.module('./state.mjs', {
    namedExports: {
      keyFor: (c, a) => `dedup/${c}/${a}/state.json`,
      readState: async () => ({
        state: {
          schemaVersion: 1, submissionId: 'old', crmCaseId: '500U900000TP4kYIAT',
          startedAt: Date.now() - 10 * 60 * 1000,
          lastUpdatedAt: Date.now() - 10 * 60 * 1000,
        },
        etag: '"e1"',
      }),
      writeStateConditional: async (a) => { calls.stateWrite.push(a); },
    },
  });
  mock.module('./crm-client.mjs', {
    namedExports: {
      postCase: async (a) => { calls.postCase.push(a); return { caseId: '500NEW', caseNumber: '999', referenceId: null, created: true }; },
      getCase: async () => ({ caseRecordId: '500U900000TP4kYIAT', status: 'Closed' }),
      postNote: async (a) => { calls.postNote.push(a); },
    },
  });

  const { handler } = await import('./handler.mjs');
  await handler(buildEvent());

  assert.equal(calls.postCase.length, 1, 'opens fresh case');
  assert.equal(calls.slack.length, 1);
  assert.equal(calls.invoke.length, 1);
});

await test('expired window (>60min): treats as fresh, overwrites state', async () => {
  s3Client.send.mock.mockImplementation(async () => ({
    Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
  }));
  mock.module('./state.mjs', {
    namedExports: {
      keyFor: (c, a) => `dedup/${c}/${a}/state.json`,
      readState: async () => ({
        state: {
          schemaVersion: 1, submissionId: 'old', crmCaseId: 'OLD',
          startedAt: Date.now() - 90 * 60 * 1000,
          lastUpdatedAt: Date.now() - 90 * 60 * 1000,
        },
        etag: '"e1"',
      }),
      writeStateConditional: async (a) => { calls.stateWrite.push(a); },
    },
  });

  const { handler } = await import('./handler.mjs');
  await handler(buildEvent());

  assert.equal(calls.postCase.length, 1);
  assert.equal(calls.invoke.length, 1);
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `pnpm --filter @airo/fanout-lambda test handler.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement handler.mjs**

```javascript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { parseFeedbackParquet } from './parquet-reader.mjs';
import { keyFor, readState, writeStateConditional } from './state.mjs';
import { postCase, getCase, postNote } from './crm-client.mjs';
import { postSlackMessage } from './slack.mjs';
import { invokeInvestigator } from './invoke-investigator.mjs';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const s3 = new S3Client({ region: REGION });

const DEDUP_WINDOW_MS = 60 * 60 * 1000;
const SCHEMA_VERSION = 1;

const log = (level, domain, fields) => {
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({
    level,
    msg: domain,
    ...fields,
  }));
};

/**
 * S3 ObjectCreated event handler. Processes one parquet at a time.
 *
 * Flag-gated entry: when FANOUT_VIA_LAMBDA_DISABLED=true the handler
 * exits clean without touching anything. This is the kill-switch used
 * during cutover.
 */
export async function handler(event) {
  if (process.env.FANOUT_VIA_LAMBDA_DISABLED === 'true') {
    log('info', 'fanout.disabled', { reason: 'FANOUT_VIA_LAMBDA_DISABLED=true' });
    return;
  }

  const record = event.Records?.[0];
  if (!record?.s3) {
    log('warn', 'fanout.event.bad_shape', {});
    return;
  }
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

  log('info', 'fanout.start', { bucket, key });

  const parquetBytes = await readParquet(bucket, key);
  const row = await parseFeedbackParquet(parquetBytes);

  const customerId = row.customer_id;
  const appId = row.app_id;
  const submissionId = row.feedback_id;
  if (!customerId || !appId || !submissionId) {
    log('warn', 'fanout.row.missing_required', { hasCustomer: !!customerId, hasApp: !!appId, hasSubmissionId: !!submissionId });
    return;
  }

  const stateBucket = process.env.FEEDBACK_BUCKET ?? bucket;
  const existing = await readState({ bucket: stateBucket, customerId, appId });

  const now = Date.now();
  if (existing) {
    const age = now - existing.state.startedAt;
    if (age <= DEDUP_WINDOW_MS) {
      const handled = await handleDedupHit({
        existing, row, customerId, appId, submissionId, stateBucket, now,
      });
      if (handled) return;
      // dedup-hit verification fell through (case closed/missing) — fresh path
    }
  }

  await handleFreshPath({ row, customerId, appId, submissionId, stateBucket, now });
}

async function readParquet(bucket, key) {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const stream = result.Body;
  const bytes = await stream.transformToByteArray();
  return Buffer.from(bytes);
}

function buildExternalSystemId(customerId, appId, submissionId) {
  return `airo-${customerId}-${appId ?? 'na'}-${submissionId}`;
}

function buildInvestigateUrl(customerId, appId) {
  const base = process.env.DEBUG_CONSOLE_BASE_URL;
  if (!base) return null;
  const ctx = Buffer.from(JSON.stringify({ c: customerId, a: appId, t: 'investigate' }), 'utf-8').toString('base64url');
  return `${base.replace(/\/$/, '')}/?ctx=${ctx}`;
}

function newInvestigationId() {
  const ts = new Date().toISOString().slice(0, 10);
  const r = Math.random().toString(36).slice(2, 10);
  return `inv-${ts}-${r}`;
}

function crmConfig() {
  return {
    crmBaseUrl: process.env.CRM_BASE_URL,
    certSecretArn: process.env.CERT_SECRET_ARN,
    ssoUrl: process.env.SSO_URL,
  };
}

async function handleDedupHit({ existing, row, customerId, appId, submissionId, stateBucket, now }) {
  let liveCase;
  try {
    liveCase = await getCase({ ...crmConfig(), caseId: existing.state.crmCaseId });
  } catch (err) {
    log('warn', 'fanout.dedup.get_failed', { error: err.message });
    return false;
  }

  if (!liveCase || liveCase.status !== 'Open') {
    log('info', 'fanout.dedup.stale', { liveStatus: liveCase?.status, caseId: existing.state.crmCaseId });
    return false;
  }

  const note = renderDuplicateNote({ submissionId, row });
  try {
    await postNote({ ...crmConfig(), caseRecordId: existing.state.crmCaseId, note });
  } catch (err) {
    log('warn', 'fanout.dedup.note_failed', { error: err.message });
  }

  try {
    await writeStateConditional({
      bucket: stateBucket, customerId, appId,
      state: { ...existing.state, lastUpdatedAt: now },
      ifMatchEtag: existing.etag,
    });
  } catch (err) {
    if (err.name !== 'PreconditionFailed') log('warn', 'fanout.dedup.state_update_failed', { error: err.message });
  }

  log('info', 'fanout.dedup.hit', { customerId, appId, caseId: existing.state.crmCaseId });
  return true;
}

async function handleFreshPath({ row, customerId, appId, submissionId, stateBucket, now }) {
  // Lock acquire (or overwrite stale lock).
  const baseState = {
    schemaVersion: SCHEMA_VERSION,
    submissionId,
    crmCaseId: null,
    startedAt: now,
    lastUpdatedAt: now,
  };
  try {
    await writeStateConditional({ bucket: stateBucket, customerId, appId, state: baseState });
  } catch (err) {
    if (err.name === 'PreconditionFailed') {
      // existing lock — re-read and overwrite if window expired
      const cur = await readState({ bucket: stateBucket, customerId, appId });
      if (!cur) throw err;
      const age = now - cur.state.startedAt;
      if (age > DEDUP_WINDOW_MS) {
        await writeStateConditional({
          bucket: stateBucket, customerId, appId, state: baseState, ifMatchEtag: cur.etag,
        });
      } else {
        log('info', 'fanout.fresh.race_lost', { customerId, appId });
        return;
      }
    } else {
      throw err;
    }
  }

  let caseId = null;
  let caseNumber = null;
  try {
    const result = await postCase({
      ...crmConfig(),
      body: buildCaseBody({ row, customerId, appId, submissionId }),
    });
    caseId = result.caseId;
    caseNumber = result.caseNumber;
  } catch (err) {
    log('error', 'fanout.crm.post_failed', { error: err.message });
    throw err;
  }

  // Re-read state for etag, merge crmCaseId, write back.
  const after = await readState({ bucket: stateBucket, customerId, appId });
  if (after) {
    try {
      await writeStateConditional({
        bucket: stateBucket, customerId, appId,
        state: { ...after.state, crmCaseId: caseId, lastUpdatedAt: Date.now() },
        ifMatchEtag: after.etag,
      });
    } catch (err) {
      if (err.name !== 'PreconditionFailed') log('warn', 'fanout.fresh.state_caseId_failed', { error: err.message });
    }
  }

  // Slack
  try {
    await postSlackMessage({
      secretArn: process.env.SLACK_WEBHOOK_SECRET_ARN,
      payload: {
        customerId, appId,
        category: row.feedback_origin_name,
        rating: row.rating ?? null,
        body: row.feedback_text ?? '',
        caseNumber,
      },
    });
  } catch (err) {
    log('warn', 'fanout.slack.failed', { error: err.message });
  }

  // Kickoff note
  const investigateUrl = buildInvestigateUrl(customerId, appId);
  const investigationId = newInvestigationId();
  if (caseId && investigateUrl) {
    try {
      await postNote({
        ...crmConfig(),
        caseRecordId: caseId,
        note: `AI investigation kicked off (investigationId: ${investigationId}). Track: ${investigateUrl}`,
      });
    } catch (err) {
      log('warn', 'fanout.kickoff.note_failed', { error: err.message });
    }
  }

  // Invoke investigator
  try {
    await invokeInvestigator({
      functionName: process.env.INVESTIGATE_LAMBDA_FN,
      payload: {
        investigationId,
        customerId,
        appId,
        source: 'feedback',
        feedback: row.feedback_text ?? '',
        category: row.feedback_origin_name,
        rating: row.rating ?? null,
        topics: parseTopics(row.feedback_topic_list),
        customerConsent: row.consent_flag ?? null,
        crmCaseId: caseId ?? undefined,
        crmCaseNumber: caseNumber ?? undefined,
      },
    });
  } catch (err) {
    log('warn', 'fanout.invoke.failed', { error: err.message });
  }

  log('info', 'fanout.fresh.done', { customerId, appId, caseId, caseNumber, investigationId });
}

function buildCaseBody({ row, customerId, appId, submissionId }) {
  const text = row.feedback_text ?? '';
  return {
    contactName: customerId,
    contactEmail: 'noreply@godaddy.com',
    description: text.slice(0, 4000),
    externalSystemId: buildExternalSystemId(customerId, appId, submissionId),
    additionalData: {
      type: 'Complete',
      severity: 'S2',
      escalated: 'true',
      permissionToMakeChanges: 'true',
      escalationDetails: text.slice(0, 1000),
    },
    caseNotes: [],
  };
}

function renderDuplicateNote({ submissionId, row }) {
  return [
    'Duplicate submission within 60-min window.',
    `SubmissionId: ${submissionId}`,
    `Category: ${row.feedback_origin_name ?? 'unknown'}`,
    row.rating != null ? `Rating: ${row.rating}` : null,
    `Feedback: ${(row.feedback_text ?? '').slice(0, 1000)}`,
  ].filter(Boolean).join('\n');
}

function parseTopics(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @airo/fanout-lambda test handler.test.mjs`
Expected: PASS — five tests green.

- [ ] **Step 5: Commit**

```bash
git add fanout/handler.mjs fanout/handler.test.mjs
git commit -m "feat(fanout): handler orchestration (fresh + dedup + stale paths)"
```

---

## Container packaging

### Task 11: Dockerfile

**Files:**
- Create: `fanout/Dockerfile`
- Create: `fanout/.dockerignore`

- [ ] **Step 1: Read investigator/Dockerfile to match pattern**

Run: `cat investigator/Dockerfile`

- [ ] **Step 2: Create fanout/Dockerfile based on the same pattern**

```dockerfile
# Multi-stage build mirroring investigator/Dockerfile to keep parity.
# Final image: AWS Lambda Node.js 22 base, ARM64.

FROM public.ecr.aws/lambda/nodejs:22-arm64

WORKDIR /var/task

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY *.mjs ./

CMD ["handler.handler"]
```

- [ ] **Step 3: Create fanout/.dockerignore**

```
node_modules/
*.test.mjs
*.md
.gitignore
.dockerignore
```

- [ ] **Step 4: Verify Dockerfile builds locally (smoke check, optional in CI)**

Run: `docker build --platform linux/arm64 -t airo-fanout:dev fanout/`
Expected: build succeeds; image tagged `airo-fanout:dev`.

(If Docker not available locally, skip — CI will build during deploy.)

- [ ] **Step 5: Commit**

```bash
git add fanout/Dockerfile fanout/.dockerignore
git commit -m "feat(fanout): Dockerfile for ARM64 Lambda image"
```

---

## CDK stack

### Task 12: Add cdk/lib/feedback-fanout-stack.ts

**Files:**
- Create: `cdk/lib/feedback-fanout-stack.ts`

- [ ] **Step 1: Read investigator-stack.ts to match patterns**

Run: `head -100 cdk/lib/investigator-stack.ts`
Note: structure for Lambda with Docker image, IAM, CloudWatch, env vars.

- [ ] **Step 2: Create fanout stack**

```typescript
import * as path from 'node:path';

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3Notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { GDStack, GDStackProps } from '@gd-safeguard/godaddy-constructs';

import config from './config';

interface FeedbackFanoutStackProps extends GDStackProps {
  feedbackBucket: s3.IBucket;
  investigatorFunctionArn: string;
  certSecretArn: string;
  slackWebhookSecretArn: string;
  crmBaseUrl: string;
  ssoUrl: string;
}

/**
 * Fanout Lambda stack — subscribes to ObjectCreated events on the feedback
 * bucket's `table_prefix/` parquet path, fans out to Slack + CMAPI + invoke
 * investigator. Has its own SQS DLQ (14-day retention). Reuses existing
 * cert secret and feedback bucket; does not touch investigator's bucket.
 *
 * Flag-gated entry: env var FANOUT_VIA_LAMBDA_DISABLED=true makes the Lambda
 * a no-op. Kill-switch for the cutover from PR #3946 BFF behavior.
 */
export class FeedbackFanoutStack extends GDStack {
  public readonly fanoutFunction: lambda.DockerImageFunction;
  public readonly dlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: FeedbackFanoutStackProps) {
    super(scope, id, props);

    this.dlq = new sqs.Queue(this, 'FanoutDLQ', {
      queueName: `airo-fanout-dlq-${config.envName}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    this.fanoutFunction = new lambda.DockerImageFunction(this, 'FanoutFunction', {
      functionName: `airo-fanout-${config.envName}`,
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '..', '..', 'fanout')),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      reservedConcurrentExecutions: 50,
      logRetention: logs.RetentionDays.ONE_MONTH,
      deadLetterQueue: this.dlq,
      environment: {
        FEEDBACK_BUCKET: props.feedbackBucket.bucketName,
        INVESTIGATE_LAMBDA_FN: props.investigatorFunctionArn.split(':').pop()!,
        SLACK_WEBHOOK_SECRET_ARN: props.slackWebhookSecretArn,
        CERT_SECRET_ARN: props.certSecretArn,
        CRM_BASE_URL: props.crmBaseUrl,
        SSO_URL: props.ssoUrl,
        DEBUG_CONSOLE_BASE_URL: config.debugConsoleBaseUrl,
        FANOUT_VIA_LAMBDA_DISABLED: 'true', // default OFF until cutover
        LOG_LEVEL: config.envName === 'prod' ? 'info' : 'debug',
      },
    });

    // IAM
    props.feedbackBucket.grantRead(this.fanoutFunction, 'table_prefix/*');
    props.feedbackBucket.grantReadWrite(this.fanoutFunction, 'dedup/*');

    this.fanoutFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [props.certSecretArn, props.slackWebhookSecretArn],
    }));

    this.fanoutFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [props.investigatorFunctionArn],
    }));

    // S3 trigger
    props.feedbackBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3Notifications.LambdaDestination(this.fanoutFunction),
      { prefix: 'table_prefix/', suffix: '.parquet' },
    );

    // Alarms
    new cloudwatch.Alarm(this, 'DLQDepthAlarm', {
      alarmName: `airo-fanout-dlq-depth-${config.envName}`,
      metric: this.dlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'LambdaErrorRateAlarm', {
      alarmName: `airo-fanout-error-rate-${config.envName}`,
      metric: this.fanoutFunction.metricErrors({ period: cdk.Duration.minutes(15) }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'LambdaDurationAlarm', {
      alarmName: `airo-fanout-duration-${config.envName}`,
      metric: this.fanoutFunction.metricDuration({ statistic: 'p99', period: cdk.Duration.minutes(15) }),
      threshold: cdk.Duration.seconds(30).toMilliseconds(),
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cdk.CfnOutput(this, 'FanoutFunctionArn', {
      value: this.fanoutFunction.functionArn,
      exportName: `${config.envName}-fanout-function-arn`,
    });

    new cdk.CfnOutput(this, 'FanoutDLQArn', {
      value: this.dlq.queueArn,
      exportName: `${config.envName}-fanout-dlq-arn`,
    });
  }
}
```

- [ ] **Step 3: Run typecheck on cdk/**

Run: `pnpm --filter cdk typecheck` (or whatever the cdk workspace's typecheck script is)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add cdk/lib/feedback-fanout-stack.ts
git commit -m "feat(cdk): FeedbackFanoutStack for fanout Lambda + DLQ + alarms"
```

---

### Task 13: Wire stack into cdk/bin/airo-app-builder-cdk.ts

**Files:**
- Modify: `cdk/bin/airo-app-builder-cdk.ts`

- [ ] **Step 1: Read the cdk app entry to find where investigator-stack is wired**

Run: `grep -n "InvestigatorStack\|investigatorStack" cdk/bin/airo-app-builder-cdk.ts`

- [ ] **Step 2: Add the import + stack instantiation**

After the existing `InvestigatorStack` instantiation, add:

```typescript
import { FeedbackFanoutStack } from '../lib/feedback-fanout-stack';

// ... after investigatorStack and feedbackS3Stack are constructed ...

const feedbackFanoutStack = new FeedbackFanoutStack(app, `${prefix}FeedbackFanoutStack`, {
  ...stackProps,
  feedbackBucket: feedbackS3Stack.feedbackBucket,
  investigatorFunctionArn: investigatorStack.lambdaArn,
  certSecretArn: investigatorStack.certSecretArn,
  slackWebhookSecretArn: config.slackFeedbackWebhookSecretArn,
  crmBaseUrl: config.crmBaseUrl,
  ssoUrl: config.ssoUrl,
});
feedbackFanoutStack.addDependency(feedbackS3Stack);
feedbackFanoutStack.addDependency(investigatorStack);
```

- [ ] **Step 3: Add new fields to cdk/lib/config.ts if missing**

If `config.slackFeedbackWebhookSecretArn`, `config.crmBaseUrl`, `config.ssoUrl` don't exist, add them. Run `grep -n "slackFeedbackWebhookSecretArn\|crmBaseUrl\|ssoUrl" cdk/lib/config.ts` to check. If missing, add per env (test/prod) with the appropriate ARNs / URLs.

- [ ] **Step 4: Run cdk synth to verify**

Run: `pnpm --filter cdk run synth FeedbackFanoutStack`
Expected: synth succeeds, CloudFormation template printed.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter cdk typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cdk/bin/airo-app-builder-cdk.ts cdk/lib/config.ts
git commit -m "feat(cdk): wire FeedbackFanoutStack into app entry"
```

---

### Task 14: CDK snapshot test for the new stack — DEFERRED

**Status:** Deferred. The `cdk/` workspace has `jest.config.js` but no `jest`/`ts-jest`/`@types/jest` installed in `devDependencies`, no `test` script in `package.json`, and no existing `cdk/test/*.test.ts` files. Adding a jest pipeline is scope creep beyond this PR.

The stack is declarative; `tsc --noEmit` verifies type correctness. When the CDK workspace gets a real test runner (separate follow-up), add a snapshot test that asserts:
- `AWS::Lambda::Function` count: 1
- `AWS::SQS::Queue` count: 1
- `AWS::CloudWatch::Alarm` count: 3
- Lambda properties: MemorySize=512, Timeout=60, Architectures=['arm64']



**Files:**
- Create: `cdk/test/feedback-fanout-stack.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Bucket } from 'aws-cdk-lib/aws-s3';

import { FeedbackFanoutStack } from '../lib/feedback-fanout-stack';

describe('FeedbackFanoutStack', () => {
  test('creates Lambda, DLQ, and alarms', () => {
    const app = new cdk.App();
    const parentStack = new cdk.Stack(app, 'ParentStack');
    const bucket = new Bucket(parentStack, 'Bucket', { bucketName: 'airo-builder-feedback-test' });

    const stack = new FeedbackFanoutStack(app, 'TestFanoutStack', {
      env: { account: '111111111111', region: 'us-west-2' },
      feedbackBucket: bucket,
      investigatorFunctionArn: 'arn:aws:lambda:us-west-2:111111111111:function:airo-investigator-test',
      certSecretArn: 'arn:aws:secretsmanager:us-west-2:111111111111:secret:airo-cert',
      slackWebhookSecretArn: 'arn:aws:secretsmanager:us-west-2:111111111111:secret:airo-slack',
      crmBaseUrl: 'https://crm.int.test-godaddy.com',
      ssoUrl: 'https://sso.int.test-godaddy.com/jwt',
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.resourceCountIs('AWS::SQS::Queue', 1);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 3);

    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
      Timeout: 60,
      Architectures: ['arm64'],
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter cdk test feedback-fanout-stack`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add cdk/test/feedback-fanout-stack.test.ts
git commit -m "test(cdk): snapshot test for FeedbackFanoutStack"
```

---

## Switchboard flag (manual + docs)

### Task 15: Document switchboard flag setup

**Files:**
- Modify: `fanout/README.md`

- [ ] **Step 1: Append flag setup section to fanout/README.md**

```markdown
## Switchboard flag setup (manual, ops)

Flag name: `appbuilder-fanout-via-lambda` (boolean, default `false`)

Create in test + prod via Switchboard UI:
1. Navigate to https://switchboard.int.godaddy.com/apps/airo-app-builder/
2. Click "New flag"
3. Name: `appbuilder-fanout-via-lambda`
4. Type: boolean
5. Default: `false`
6. Description: "When ON, the fanout Lambda owns Slack/CRM/investigator dispatch. When OFF, BFF handles fanout (legacy behavior from PR #3946)."

The flag is consumed by the BFF route (PR #2 — separate plan), not by the
Lambda itself. Lambda is gated by env var `FANOUT_VIA_LAMBDA_DISABLED` set
in the CDK stack (defaults to `true` until cutover).

## Cutover sequence

1. Land this PR → CDK deploys Lambda with `FANOUT_VIA_LAMBDA_DISABLED=true` → Lambda live, idle.
2. Land PR #2 → BFF starts writing parquet always; gates fanout on switchboard flag.
3. Test env: flip `FANOUT_VIA_LAMBDA_DISABLED=false` (CDK env override) AND switchboard flag ON. Verify CRM/Slack/investigator end-to-end.
4. Prod: same flip.
5. Land PR #3 → cleanup BFF fanout code.
```

- [ ] **Step 2: Commit**

```bash
git add fanout/README.md
git commit -m "docs(fanout): switchboard flag setup + cutover sequence"
```

---

### Task 16: Update spec doc with implementation status link

**Files:**
- Modify: `docs/superpowers/specs/2026-05-21-fanout-lambda-extraction-design.md`

- [ ] **Step 1: Add implementation status header below "Status: Approved..."**

Change:
```markdown
**Status:** Approved, ready for implementation plan
```

To:
```markdown
**Status:** Implementation in progress — see [plan](../plans/2026-05-21-fanout-lambda-extraction.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-21-fanout-lambda-extraction-design.md
git commit -m "docs(fanout): link spec to implementation plan"
```

---

## Final verification

### Task 17: Full test sweep + lint

- [ ] **Step 1: Run all fanout tests**

Run: `pnpm --filter @airo/fanout-lambda test`
Expected: every test file passes (cert-loader, crm-token, secret-cache, crm-client, parquet-reader, state, slack, invoke-investigator, handler).

- [ ] **Step 2: Run CDK tests**

Run: `pnpm --filter cdk test`
Expected: all pass including new feedback-fanout-stack.test.ts.

- [ ] **Step 3: Run typecheck across monorepo**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Run lint**

Run: `pnpm lint --max-warnings 0`
Expected: PASS.

- [ ] **Step 5: Run build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 6: Manual deploy preview (optional)**

Run: `pnpm --filter cdk run synth FeedbackFanoutStack`
Expected: clean synth.

- [ ] **Step 7: Push branch + open draft PR**

```bash
git push -u origin feature/fanout-lambda

gh pr create --draft --title "feat(fanout): extract fan-out into dedicated S3-event-triggered Lambda" --body "$(cat <<'EOF'
## Summary

Builds a new fanout Lambda that subscribes to the feedback S3 bucket and owns Slack + CRM + investigator-Lambda dispatch. BFF stays slim (this PR keeps BFF fanout behavior intact via env-flag-gated handler — actual cutover happens in a separate PR #2).

See `docs/superpowers/specs/2026-05-21-fanout-lambda-extraction-design.md`.

## Changes

- New `fanout/` workspace: handler + parquet reader + state + slack + CRM client + cert/JWT + invoke-investigator wrapper + Dockerfile
- New CDK stack `FeedbackFanoutStack`: Lambda + SQS DLQ + IAM + S3 trigger + 3 CloudWatch alarms
- All tests in Node `--test` harness with module mocks (matches investigator/ pattern)
- Lambda env-flag `FANOUT_VIA_LAMBDA_DISABLED=true` by default → Lambda live but idle on first deploy
- Switchboard flag `appbuilder-fanout-via-lambda` documented in README; consumed by PR #2

## Test plan

- [ ] All Lambda unit tests green
- [ ] CDK snapshot test green
- [ ] Typecheck + lint + build pass
- [ ] Test env: deploy stack, verify Lambda exists + idle (FANOUT_VIA_LAMBDA_DISABLED=true)
- [ ] Test env: flip FANOUT_VIA_LAMBDA_DISABLED=false, submit feedback via curl, verify CRM case opens + Slack pings + investigator invoked
- [ ] Test env: spam-click within 60min, verify second submission appends note to existing case
- [ ] Test env: spam-click after 60min, verify fresh case opens

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Final commit (no-op)**

If everything passes, the PR is open in draft. Switch to ready-for-review when you've manually verified the test plan in test env.

---

## Plan-level notes

**Decisions baked into this plan:**

- Lambda built with own minimal CRM/cert utilities (no copy-paste from investigator/) — so this PR is independent of PR #3946 landing first
- Lambda `FANOUT_VIA_LAMBDA_DISABLED` env var is the kill-switch (BFF still uses switchboard flag in PR #2)
- Tests use Node `--test` with `--experimental-test-module-mocks` (matches investigator/ pattern)
- CDK stack reuses existing feedback bucket and cert secret — no new S3 bucket, no new cert ARN
- DLQ retention: 14 days (manual replay window)
- Reserved concurrency: 50 (CMAPI throttle protection)
- Lambda timeout: 60s (covers CMAPI P99 ~5s × 3 calls + Slack + invoke + buffer)
- ARM64 architecture for cost
- Slack message format uses block-kit; webhook URL fetched via Secrets Manager (TTL-cached)

**Out of scope (handled in PR #2 / PR #3):**

- BFF behavior change (writing parquet always, gating fanout on switchboard flag)
- Cleanup of BFF fanout code paths after cutover stable
- CMAPI custom-field registration for `airoBuilderAppId` (would unlock server-side dedup; nice-to-have)

**Failure modes baked into handler:**

- Schema mismatch on parquet → log warn + ack-exit (no retry on bad data)
- Slack 5xx → log warn + continue (best-effort)
- CMAPI POST 5xx → throw → SQS retry (idempotent via externalSystemId)
- CMAPI GET 404 / closed status → fall through to fresh path
- Investigator invoke fail → log warn + continue (state has caseId for manual replay)
- Lambda timeout → SQS retry; resumes from state.json checkpoint via etag merge
- State conditional write 412 race → re-read; if window expired, overwrite; else ack-exit

**Spec coverage check:**
- §4 architecture → Tasks 0-17 cover all components
- §5 data flow → Tasks 6, 7, 10 cover read/state/orchestrate; Tasks 5, 8, 9 cover side-effects
- §6 state schema → Task 7
- §7 idempotency → Task 5 + Task 10 (externalSystemId from submissionId)
- §8 failure handling → Task 10 covers each branch
- §9 Lambda spec → Tasks 11, 12 (Dockerfile + CDK)
- §10 CDK changes → Tasks 12, 13, 14
- §11 source layout → matches Task 0 / 11 layouts exactly
- §12 cutover plan → Task 15 (docs); actual cutover in PR #2
- §13 cross-Lambda contract → Task 9 (invoke payload)
- §14 risks → handled in handler (Task 10)
- §15 follow-ups → out of scope, noted in plan-level notes
- §16 decisions log → reflected in this plan
- §17 test plan → Task 17 + per-task TDD

No gaps detected. No placeholders. All file paths exact.
