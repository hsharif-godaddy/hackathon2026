# Feedback Fan-out Automation Implementation Plan

> **STATUS: IMPLEMENTED (PR #3839, 2026-05-20).** This plan was the build-time guide; all 15 tasks below are complete. The plan is preserved as a historical record of how the work was decomposed and executed task-by-task. For the as-shipped behavior — including deltas from the original design (CMAPI POST not PATCH, lock/dedup, kickoff note, trace-fallback hardening, etc.) — see the **Implementation Deltas** section at the bottom of `docs/superpowers/specs/2026-05-14-feedback-fanout-automation-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-trigger CRM case creation + investigator Lambda on customer feedback (`issue`, `support`, or `feedback` w/ `rating < 5`); Lambda enriches the CRM case with an AI summary + report deep link on completion.

**Architecture:** New BFF endpoint `/api/feedback/submit` orchestrates synchronous CRM case open + async investigator Lambda invoke. Existing client-side Slack webhook + S3 store paths are preserved unchanged. Investigator Lambda extends with a single post-completion step that PATCHes a caseNote when `crmCaseId` is present in input. Slack threading is **out of scope for this plan** (deferred to v2).

**Tech Stack:** TypeScript / Next.js (BFF), Node.js (Lambda, ESM `.mjs`), AWS SDK v3 (`@aws-sdk/client-lambda`, `@aws-sdk/client-secrets-manager`), Vitest (BFF + debug-console), Node `--test` (Lambda), AWS CDK (TypeScript), GoDaddy SSO cert-based JWT for CRM API, GoDaddy Switchboard.

**Spec:** `docs/superpowers/specs/2026-05-14-feedback-fanout-automation-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `app/src/app/api/feedback/submit/route.ts` | New BFF route. Auth + Switchboard gate + CRM case open + Lambda invoke. Single entry point for fan-out submits. |
| `app/src/lib/feedback/fanout-types.ts` | Shared TS types for `/api/feedback/submit` request/response and the three category-specific payload variants. |
| `app/src/lib/feedback/fanout-validation.ts` | Server-side payload validators per category (incl. `rating < 5` for feedback). Pure functions, fully unit-testable. |
| `app/src/lib/investigate/invoke.ts` | Server-side investigator Lambda invoker. Wraps `LambdaClient.send(InvokeCommand{InvocationType: 'Event'})`. Reads `INVESTIGATE_LAMBDA_FN` + `AWS_REGION` from env. |
| `app/src/lib/investigate/__tests__/invoke.test.ts` | Unit tests for the invoker (mocks `@aws-sdk/client-lambda`). |
| `app/src/lib/feedback/__tests__/fanout-validation.test.ts` | Unit tests for validators. |
| `app/src/app/api/feedback/submit/__tests__/route.test.ts` | Unit tests for the BFF route (mocks downstream). |
| `investigator/crm-casenote.mjs` | Lambda module: mints SSO JWT from cert in Secrets Manager, PATCHes CRM case caseNote. |
| `investigator/crm-casenote.test.mjs` | Node-test for the casenote module (HTTP + secrets mocked). |
| `investigator/cert-loader.mjs` | Lambda module: caches CRM cert + key fetched from Secrets Manager. Module-scoped cache; refresh on stale. |
| `investigator/cert-loader.test.mjs` | Node-test for cert loader. |

### Modified files

| Path | Change |
|---|---|
| `app/src/lib/crm/case-client.ts` | `OpenCaseInput` gains `category` + variant fields. `buildCaseBody()` branches by category for severity (`S2` vs `S3`) and `'Escalation Details'` content. |
| `app/src/lib/crm/__tests__/case-client.test.ts` | Add coverage for support + feedback variant body shapes. |
| `app/src/components/feedback/types.ts` | Export new `FanoutSubmitRequest` / `FanoutSubmitResponse` re-export from `fanout-types.ts` for client use. |
| `app/src/components/feedback/submitFeedback.ts` | Add `submitFeedbackFanout()` helper. Replace direct `openCrmCaseForIssue()` call (still exported for backward compat during canary). |
| `app/src/components/feedback/FeedbackMultiStep.tsx` | Each `handle*Submit` callback computes `shouldFanOut` and calls `submitFeedbackFanout()` alongside existing Slack/S3 calls. Toast text uses `caseNumber` when returned. |
| `debug-console/src/lib/investigate/types.ts` | Extend `InvestigationState` with optional `source`, `crmCaseId`, `crmCaseNumber`, `category`, `rating`, `topics` fields. |
| `debug-console/src/app/api/investigate/route.ts` | Accept new optional input fields; thread through to Lambda payload + state. Default `source: 'console'`. |
| `investigator/handler.mjs` | At end of `handler()` after `mergeState({...status: 'completed'...})`, call new `maybePatchCrmCaseNote()` helper. Wrapped in try/catch. |
| `cdk/lib/investigator-stack.ts` | Add IAM `secretsmanager:GetSecretValue` for the CRM cert secret. Add Lambda env: `CRM_API_BASE`, `CRM_CERT_SECRET_ARN`, `DEBUG_CONSOLE_BASE_URL`. |

---

## Conventions

- **Imports**: BFF/debug-console use Vitest's `vi.mock`. Investigator Lambda uses Node's built-in `node:test` + `node:assert/strict` and uses `mock.method` for stubbing — matches existing files like `investigator/auth.test.mjs`.
- **Logger**: BFF uses `import { logger } from '@/lib/request-context'`. Lambda uses plain `console.log` / `console.error` (matches existing handler pattern).
- **Switchboard flag**: `appbuilder-feedback-fanout` (new). Server-side check via `checkSwitchboardFlag(name, request)` from `@/lib/switchboard/server`. Default `false`.
- **Test commands**:
  - BFF: `pnpm --filter website test "<path-or-pattern>"`
  - debug-console: `pnpm --filter @airo/debug-console test "<path-or-pattern>"`
  - Investigator: `cd investigator && node --test <file>`
- **Commits**: small, scoped. Each task ends with a commit.

---

## Task 1: Extend CRM `OpenCaseInput` to support all three categories

**Files:**
- Modify: `app/src/lib/crm/case-client.ts`
- Test: `app/src/lib/crm/__tests__/case-client.test.ts`

- [ ] **Step 1: Read existing case-client.ts**

```bash
cat app/src/lib/crm/case-client.ts
```

Confirm current `OpenCaseInput`, `buildCaseBody`, severity hard-coded to `'S2'`.

- [ ] **Step 2: Write failing tests for variant bodies**

Append to `app/src/lib/crm/__tests__/case-client.test.ts`:

```typescript
import { buildCaseBody, type OpenCaseInput } from '../case-client';

const PROFILE = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '555-0100',
};

describe('buildCaseBody — category variants', () => {
  it('issue: severity S2, escalation details = description', () => {
    const input: OpenCaseInput = {
      customerId: 'cust-1',
      shopperId: 'shop-1',
      category: 'issue',
      description: 'It broke',
      followUp: true,
      appId: 'app-1',
      topics: [],
    };
    const body = buildCaseBody(input, PROFILE);
    expect(body.additionalData.severity).toBe('S2');
    expect(body.additionalData['Escalation Details']).toBe('It broke');
    expect(body.caseNotes[0].note).toContain('Customer reported : It broke');
  });

  it('support: severity S3, escalation details prefixed and topics included', () => {
    const input: OpenCaseInput = {
      customerId: 'cust-1',
      shopperId: 'shop-1',
      category: 'support',
      description: 'Cannot publish',
      followUp: false,
      appId: 'app-2',
      topics: ['publish', 'errors'],
    };
    const body = buildCaseBody(input, PROFILE);
    expect(body.additionalData.severity).toBe('S3');
    expect(body.additionalData['Escalation Details']).toBe(
      'Support: Cannot publish\nTopics: publish, errors',
    );
    expect(body.caseNotes[0].note).toContain('Customer support request : Cannot publish');
  });

  it('feedback: severity S3, escalation details includes NPS and comment', () => {
    const input: OpenCaseInput = {
      customerId: 'cust-1',
      shopperId: 'shop-1',
      category: 'feedback',
      description: 'Slow generation',
      followUp: false,
      appId: 'app-3',
      topics: ['speed'],
      rating: 2,
    };
    const body = buildCaseBody(input, PROFILE);
    expect(body.additionalData.severity).toBe('S3');
    expect(body.additionalData['Escalation Details']).toBe(
      'NPS 2: Slow generation\nTopics: speed',
    );
    expect(body.caseNotes[0].note).toContain('Customer feedback (NPS 2) : Slow generation');
  });
});
```

- [ ] **Step 3: Run tests, expect failure**

```bash
pnpm --filter website test "case-client" --run
```

Expected: FAIL with "Object literal may only specify known properties" (TS) or assertion errors — `OpenCaseInput` does not yet have `category` / `topics` / `rating`, severity is hard-coded.

- [ ] **Step 4: Extend `OpenCaseInput` and `buildCaseBody`**

In `app/src/lib/crm/case-client.ts`:

1. Replace the `OpenCaseInput` interface:

```typescript
export type FeedbackCategory = 'issue' | 'support' | 'feedback';

export interface OpenCaseInput {
  customerId: string;
  shopperId: string;
  category: FeedbackCategory;
  description: string;
  followUp: boolean;
  appId: string | null;
  topics?: string[];
  /** Required + validated to be < 5 by the caller for category === 'feedback'. */
  rating?: number;
}
```

2. Replace `AdditionalData.severity` typing:

```typescript
interface AdditionalData {
  'Permission to Make Changes': 'True';
  severity: 'S2' | 'S3';
  escalated: 'TRUE';
  Type: 'Complete';
  'Escalation Details': string;
  followUpConsent: 'TRUE' | 'FALSE';
  appId?: string;
}
```

3. Add a helper above `buildCaseBody`:

```typescript
function buildEscalationDetailsAndNote(
  input: OpenCaseInput,
  truncatedDescription: string,
): { escalationDetails: string; noteHeader: string; severity: 'S2' | 'S3' } {
  const topicsLine = input.topics && input.topics.length > 0
    ? `\nTopics: ${input.topics.join(', ')}`
    : '';
  switch (input.category) {
    case 'issue':
      return {
        escalationDetails: truncatedDescription,
        noteHeader: 'Airo AI Builder : Customer reported',
        severity: 'S2',
      };
    case 'support':
      return {
        escalationDetails: `Support: ${truncatedDescription}${topicsLine}`,
        noteHeader: 'Airo AI Builder : Customer support request',
        severity: 'S3',
      };
    case 'feedback': {
      const ratingLabel = input.rating ?? '?';
      return {
        escalationDetails: `NPS ${ratingLabel}: ${truncatedDescription}${topicsLine}`,
        noteHeader: `Airo AI Builder : Customer feedback (NPS ${ratingLabel})`,
        severity: 'S3',
      };
    }
  }
}
```

4. Update `buildCaseBody()` to use the helper. Replace the existing body assembly:

```typescript
export function buildCaseBody(input: OpenCaseInput, profile: CustomerProfile): CrmCaseBody {
  const truncatedDescription = truncate(input.description, MAX_NOTE_CHARS);
  const { escalationDetails, noteHeader, severity } = buildEscalationDetailsAndNote(
    input,
    truncatedDescription,
  );

  const additionalData: AdditionalData = {
    'Permission to Make Changes': 'True',
    severity,
    escalated: 'TRUE',
    Type: 'Complete',
    'Escalation Details': escalationDetails,
    followUpConsent: input.followUp ? 'TRUE' : 'FALSE',
  };
  if (input.appId) additionalData.appId = input.appId;

  const body: CrmCaseBody = {
    contactName: `${profile.firstName} ${profile.lastName}`.trim(),
    contactFirstName: profile.firstName,
    contactLastName: profile.lastName,
    contactEmail: profile.email,
    shopperId: input.shopperId,
    recordType: 'standard',
    status: 'Open',
    caseOrigin: 'Automation',
    primaryCategory: 'Websites',
    secondaryCategory: 'Airo AI Builder',
    issue: 'General Support',
    caseNotes: [
      {
        note: `${noteHeader} : ${truncatedDescription}`,
        noteType: 'Status Change',
        noteTypeDetails: 'Escalation',
      },
    ],
    additionalData,
  };

  if (profile.phone) {
    body.contactPhone = profile.phone;
  }

  return body;
}
```

- [ ] **Step 5: Update existing tests in `case-client.test.ts` that build `OpenCaseInput` to include `category: 'issue'`**

Read the existing test file and add `category: 'issue'` to every `INPUT` literal that lacks it:

```bash
grep -n "category:" app/src/lib/crm/__tests__/case-client.test.ts
```

For each `OpenCaseInput` literal (search for `customerId:` blocks), add `category: 'issue'` if missing.

- [ ] **Step 6: Run tests, expect pass**

```bash
pnpm --filter website test "case-client" --run
```

Expected: PASS for all (existing + new variant tests).

- [ ] **Step 7: Run typecheck**

```bash
pnpm --filter website typecheck
```

Expected: no errors. If `app/src/app/api/crm/case/route.ts` errors because it does not pass `category`, fix it temporarily by hard-coding `category: 'issue'` in its `openCrmCase()` call (Task 6 will replace this).

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/crm/case-client.ts app/src/lib/crm/__tests__/case-client.test.ts app/src/app/api/crm/case/route.ts
git commit -m "feat(crm): extend OpenCaseInput with category variants for support and feedback"
```

---

## Task 2: Add fan-out shared types and validators

**Files:**
- Create: `app/src/lib/feedback/fanout-types.ts`
- Create: `app/src/lib/feedback/fanout-validation.ts`
- Test: `app/src/lib/feedback/__tests__/fanout-validation.test.ts`

- [ ] **Step 1: Create `fanout-types.ts`**

```typescript
// app/src/lib/feedback/fanout-types.ts

import type { FeedbackCategory } from '@/lib/crm/case-client';

export type { FeedbackCategory };

export interface FanoutIssuePayload {
  category: 'issue';
  description: string;
  followUp: boolean;
  topics: string[];
  appId: string | null;
}

export interface FanoutSupportPayload {
  category: 'support';
  description: string;
  followUp: boolean;
  topics: string[];
  appId: string | null;
}

export interface FanoutFeedbackPayload {
  category: 'feedback';
  comment: string;
  rating: number;
  topics: string[];
  customerConsent: boolean;
  appId: string | null;
}

export type FanoutSubmitRequest =
  | FanoutIssuePayload
  | FanoutSupportPayload
  | FanoutFeedbackPayload;

export interface FanoutSubmitResponse {
  success: boolean;
  caseId: string | null;
  caseNumber: string | null;
  investigationId: string | null;
  /**
   * For partial-failure paths the route still returns 200 with success=true
   * but flags which downstream calls failed so the client can adjust the
   * toast copy. CRM/investigator each set their own field.
   */
  warnings?: {
    crmFailed?: boolean;
    investigateFailed?: boolean;
  };
}

export const MAX_DESCRIPTION_LEN = 4000;
```

- [ ] **Step 2: Write failing tests for validators**

```typescript
// app/src/lib/feedback/__tests__/fanout-validation.test.ts

import { describe, expect, it } from 'vitest';

import { validateFanoutPayload } from '../fanout-validation';

describe('validateFanoutPayload', () => {
  it('issue: accepts valid payload', () => {
    const result = validateFanoutPayload({
      category: 'issue',
      description: 'broken',
      followUp: true,
      topics: ['ui'],
      appId: 'a1',
    });
    expect(result.ok).toBe(true);
  });

  it('issue: rejects empty description', () => {
    const result = validateFanoutPayload({
      category: 'issue',
      description: '   ',
      followUp: false,
      topics: [],
      appId: null,
    });
    expect(result).toEqual({ ok: false, error: 'description-required' });
  });

  it('support: accepts valid payload', () => {
    const result = validateFanoutPayload({
      category: 'support',
      description: 'help',
      followUp: false,
      topics: [],
      appId: 'a1',
    });
    expect(result.ok).toBe(true);
  });

  it('feedback: accepts rating 1-4', () => {
    for (const r of [1, 2, 3, 4]) {
      const result = validateFanoutPayload({
        category: 'feedback',
        comment: 'meh',
        rating: r,
        topics: [],
        customerConsent: true,
        appId: null,
      });
      expect(result.ok).toBe(true);
    }
  });

  it('feedback: rejects rating >= 5', () => {
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: 'good',
      rating: 5,
      topics: [],
      customerConsent: true,
      appId: null,
    });
    expect(result).toEqual({ ok: false, error: 'rating-not-low' });
  });

  it('feedback: rejects missing rating', () => {
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: 'something',
      // @ts-expect-error - intentionally missing
      rating: null,
      topics: [],
      customerConsent: true,
      appId: null,
    } as unknown as Parameters<typeof validateFanoutPayload>[0]);
    expect(result).toEqual({ ok: false, error: 'rating-required' });
  });

  it('feedback: rejects empty comment', () => {
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: '',
      rating: 2,
      topics: [],
      customerConsent: true,
      appId: null,
    });
    expect(result).toEqual({ ok: false, error: 'description-required' });
  });

  it('rejects unknown category', () => {
    const result = validateFanoutPayload({
      // @ts-expect-error - test invalid input
      category: 'other',
      description: 'x',
    } as unknown as Parameters<typeof validateFanoutPayload>[0]);
    expect(result).toEqual({ ok: false, error: 'invalid-category' });
  });

  it('rejects description exceeding MAX_DESCRIPTION_LEN', () => {
    const result = validateFanoutPayload({
      category: 'issue',
      description: 'x'.repeat(4001),
      followUp: false,
      topics: [],
      appId: null,
    });
    expect(result).toEqual({ ok: false, error: 'description-too-long' });
  });
});
```

- [ ] **Step 3: Run tests, expect failure**

```bash
pnpm --filter website test "fanout-validation" --run
```

Expected: FAIL — `validateFanoutPayload` does not exist.

- [ ] **Step 4: Create `fanout-validation.ts`**

```typescript
// app/src/lib/feedback/fanout-validation.ts

import {
  MAX_DESCRIPTION_LEN,
  type FanoutSubmitRequest,
} from './fanout-types';

export type ValidationError =
  | 'invalid-category'
  | 'description-required'
  | 'description-too-long'
  | 'rating-required'
  | 'rating-not-low';

export type ValidationResult =
  | { ok: true; payload: FanoutSubmitRequest }
  | { ok: false; error: ValidationError };

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function checkLength(text: string): ValidationError | null {
  if (text.length === 0) return 'description-required';
  if (text.length > MAX_DESCRIPTION_LEN) return 'description-too-long';
  return null;
}

/**
 * Server-side validator for /api/feedback/submit. Re-validates client-side
 * `shouldFanOut` decision (zero trust on client classification).
 */
export function validateFanoutPayload(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'invalid-category' };
  }
  const obj = raw as Record<string, unknown>;
  const category = obj.category;

  if (category === 'issue' || category === 'support') {
    const description = trim(obj.description);
    const lenErr = checkLength(description);
    if (lenErr) return { ok: false, error: lenErr };

    return {
      ok: true,
      payload: {
        category,
        description,
        followUp: obj.followUp === true,
        topics: Array.isArray(obj.topics) ? obj.topics.filter((t) => typeof t === 'string') : [],
        appId: typeof obj.appId === 'string' && obj.appId.length > 0 ? obj.appId : null,
      },
    };
  }

  if (category === 'feedback') {
    const comment = trim(obj.comment);
    const lenErr = checkLength(comment);
    if (lenErr) return { ok: false, error: lenErr };

    const rating = obj.rating;
    if (typeof rating !== 'number' || Number.isNaN(rating)) {
      return { ok: false, error: 'rating-required' };
    }
    if (rating >= 5) {
      return { ok: false, error: 'rating-not-low' };
    }

    return {
      ok: true,
      payload: {
        category,
        comment,
        rating,
        topics: Array.isArray(obj.topics) ? obj.topics.filter((t) => typeof t === 'string') : [],
        customerConsent: obj.customerConsent === true,
        appId: typeof obj.appId === 'string' && obj.appId.length > 0 ? obj.appId : null,
      },
    };
  }

  return { ok: false, error: 'invalid-category' };
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
pnpm --filter website test "fanout-validation" --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/feedback/fanout-types.ts app/src/lib/feedback/fanout-validation.ts app/src/lib/feedback/__tests__/fanout-validation.test.ts
git commit -m "feat(feedback): add fan-out request types and server-side validators"
```

---

## Task 3: Build the server-side investigator Lambda invoker (BFF side)

**Files:**
- Create: `app/src/lib/investigate/invoke.ts`
- Test: `app/src/lib/investigate/__tests__/invoke.test.ts`

- [ ] **Step 1: Confirm AWS SDK is already in `website` package**

```bash
grep -E '"@aws-sdk/client-lambda"' app/package.json
```

Expected: a version is already present (used by other BFF code). If absent, run:

```bash
pnpm --filter website add @aws-sdk/client-lambda
```

then commit `pnpm-lock.yaml` separately if it changes.

- [ ] **Step 2: Write failing tests**

```typescript
// app/src/lib/investigate/__tests__/invoke.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();
const InvokeCommandMock = vi.fn().mockImplementation((args) => ({ args }));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  InvokeCommand: InvokeCommandMock,
}));

describe('invokeInvestigator', () => {
  beforeEach(() => {
    sendMock.mockReset();
    InvokeCommandMock.mockClear();
    process.env.INVESTIGATE_LAMBDA_FN = 'fn-arn';
    process.env.AWS_REGION = 'us-west-2';
  });

  afterEach(() => {
    delete process.env.INVESTIGATE_LAMBDA_FN;
    delete process.env.AWS_REGION;
  });

  it('sends Event invocation with JSON-encoded payload', async () => {
    sendMock.mockResolvedValueOnce({});
    const { invokeInvestigator } = await import('../invoke');

    await invokeInvestigator({ investigationId: 'inv-1', appId: 'a', customerId: 'c' } as any);

    expect(InvokeCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        FunctionName: 'fn-arn',
        InvocationType: 'Event',
      }),
    );
    const callArg = InvokeCommandMock.mock.calls[0][0];
    const decoded = JSON.parse(Buffer.from(callArg.Payload).toString('utf-8'));
    expect(decoded.investigationId).toBe('inv-1');
  });

  it('throws if INVESTIGATE_LAMBDA_FN is not set', async () => {
    delete process.env.INVESTIGATE_LAMBDA_FN;
    const { invokeInvestigator } = await import('../invoke');

    await expect(
      invokeInvestigator({ investigationId: 'x', appId: 'a', customerId: 'c' } as any),
    ).rejects.toThrow(/INVESTIGATE_LAMBDA_FN/);
  });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
pnpm --filter website test "investigate/invoke" --run
```

Expected: FAIL — module does not exist.

- [ ] **Step 4: Create `invoke.ts`**

```typescript
// app/src/lib/investigate/invoke.ts

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { logger } from '@/lib/request-context';

export interface InvestigatorInvokePayload {
  investigationId: string;
  appId: string;
  customerId: string;
  feedback: string;
  fullstoryUrl: string | null;
  timeWindow: string | null;
  stateKey: string;
  historyPrefix: string;
  resultKey: string;
  tracePrefix: string;
  eventsPrefix: string;
  source: 'feedback';
  category: 'issue' | 'support' | 'feedback';
  rating?: number;
  topics: string[];
  crmCaseId?: string;
  crmCaseNumber?: string;
}

let cachedClient: LambdaClient | null = null;

function getClient(): LambdaClient {
  if (!cachedClient) {
    const region = process.env.AWS_REGION;
    if (!region) {
      throw new Error('AWS_REGION env var not set');
    }
    cachedClient = new LambdaClient({ region });
  }
  return cachedClient;
}

export async function invokeInvestigator(payload: InvestigatorInvokePayload): Promise<void> {
  const fn = process.env.INVESTIGATE_LAMBDA_FN;
  if (!fn) {
    throw new Error('INVESTIGATE_LAMBDA_FN env var not set');
  }

  const client = getClient();
  await client.send(
    new InvokeCommand({
      FunctionName: fn,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(payload), 'utf-8'),
    }),
  );

  logger.info('feedback.fanout.investigate.invoked', {
    investigationId: payload.investigationId,
    appId: payload.appId,
    customerId: payload.customerId,
    category: payload.category,
    hasCrmCaseId: !!payload.crmCaseId,
  });
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
pnpm --filter website test "investigate/invoke" --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/investigate/invoke.ts app/src/lib/investigate/__tests__/invoke.test.ts
git commit -m "feat(feedback): add server-side investigator Lambda invoker"
```

---

## Task 4: Create the `/api/feedback/submit` BFF route

**Files:**
- Create: `app/src/app/api/feedback/submit/route.ts`
- Test: `app/src/app/api/feedback/submit/__tests__/route.test.ts`

- [ ] **Step 1: Read existing CRM case route for the auth + flag pattern**

```bash
cat app/src/app/api/crm/case/route.ts
```

This is the template. The new route mirrors gating + auth, then layers CRM call + investigator invoke.

- [ ] **Step 2: Write failing tests**

```typescript
// app/src/app/api/feedback/submit/__tests__/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const openCrmCaseMock = vi.fn();
const isCertConfiguredMock = vi.fn();
const checkSwitchboardFlagMock = vi.fn();
const invokeInvestigatorMock = vi.fn();

vi.mock('@/lib/crm', () => ({
  openCrmCase: (...args: any[]) => openCrmCaseMock(...args),
  airoCertTokenService: {
    isConfigured: () => isCertConfiguredMock(),
  },
}));

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: (...args: any[]) => checkSwitchboardFlagMock(...args),
}));

vi.mock('@/lib/investigate/invoke', () => ({
  invokeInvestigator: (...args: any[]) => invokeInvestigatorMock(...args),
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => async (req: NextRequest) => {
    return handler(req, {
      user: {
        customerId: 'cust-1',
        shopperId: 'shop-1',
        authType: 'idp',
      },
    });
  },
}));

vi.mock('@airo/shared/auth', () => ({
  isEmployeeAuthType: (t: string) => t === 'e2s',
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const buildReq = (body: unknown): NextRequest =>
  new NextRequest('http://localhost/api/feedback/submit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('POST /api/feedback/submit', () => {
  beforeEach(() => {
    openCrmCaseMock.mockReset();
    isCertConfiguredMock.mockReset().mockReturnValue(true);
    checkSwitchboardFlagMock.mockReset().mockResolvedValue(true);
    invokeInvestigatorMock.mockReset().mockResolvedValue(undefined);
    process.env.INVESTIGATE_S3_BUCKET = 'bucket-x';
  });

  afterEach(() => {
    delete process.env.INVESTIGATE_S3_BUCKET;
  });

  it('happy path: opens case, invokes investigator, returns caseId+caseNumber', async () => {
    openCrmCaseMock.mockResolvedValueOnce({ caseId: 'C1', caseNumber: '999' });
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'broken',
      followUp: true,
      topics: ['ui'],
      appId: 'app-1',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, caseId: 'C1', caseNumber: '999' });
    expect(invokeInvestigatorMock).toHaveBeenCalledTimes(1);
    const payload = invokeInvestigatorMock.mock.calls[0][0];
    expect(payload.crmCaseId).toBe('C1');
    expect(payload.category).toBe('issue');
  });

  it('CRM failure: still invokes investigator without crmCaseId, returns success+null', async () => {
    openCrmCaseMock.mockRejectedValueOnce(new Error('crm 503'));
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'support',
      description: 'help',
      followUp: false,
      topics: [],
      appId: 'app-1',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.caseId).toBeNull();
    expect(body.warnings.crmFailed).toBe(true);
    expect(invokeInvestigatorMock).toHaveBeenCalledTimes(1);
    const payload = invokeInvestigatorMock.mock.calls[0][0];
    expect(payload.crmCaseId).toBeUndefined();
  });

  it('investigator failure: still returns success with caseId', async () => {
    openCrmCaseMock.mockResolvedValueOnce({ caseId: 'C2', caseNumber: '111' });
    invokeInvestigatorMock.mockRejectedValueOnce(new Error('lambda 500'));
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'a',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.caseId).toBe('C2');
    expect(body.warnings.investigateFailed).toBe(true);
  });

  it('both fail: returns 502', async () => {
    openCrmCaseMock.mockRejectedValueOnce(new Error('crm down'));
    invokeInvestigatorMock.mockRejectedValueOnce(new Error('lambda down'));
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'a',
    }));

    expect(res.status).toBe(502);
  });

  it('flag off: 403 feature-disabled', async () => {
    checkSwitchboardFlagMock.mockResolvedValueOnce(false);
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'issue',
      description: 'x',
      followUp: false,
      topics: [],
      appId: 'a',
    }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('feature-disabled');
  });

  it('NPS rating >= 5: 400 rating-not-low', async () => {
    const { POST } = await import('../route');

    const res = await POST(buildReq({
      category: 'feedback',
      comment: 'good',
      rating: 6,
      topics: [],
      customerConsent: true,
      appId: 'a',
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('rating-not-low');
  });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
pnpm --filter website test "feedback/submit" --run
```

Expected: FAIL — route does not exist.

- [ ] **Step 4: Create the route**

```typescript
// app/src/app/api/feedback/submit/route.ts

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isEmployeeAuthType } from '@airo/shared/auth';

import { airoCertTokenService, openCrmCase } from '@/lib/crm';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { validateFanoutPayload } from '@/lib/feedback/fanout-validation';
import type { FanoutSubmitResponse } from '@/lib/feedback/fanout-types';
import { invokeInvestigator } from '@/lib/investigate/invoke';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FEATURE_FLAG = 'appbuilder-feedback-fanout';
const LOG_DOMAIN = 'feedback.fanout';

function newInvestigationId(): string {
  const ts = new Date().toISOString().slice(0, 10);
  return `inv-${ts}-${randomUUID().slice(0, 8)}`;
}

function buildKeys(customerId: string, appId: string) {
  const base = `active/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}`;
  const histBase = `history/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/`;
  return {
    stateKey: `${base}/state.json`,
    resultKey: `${base}/result.md`,
    historyPrefix: histBase,
    tracePrefix: `${base}/`,
    eventsPrefix: `events/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/`,
  };
}

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  const { customerId, shopperId, authType } = authContext.user;

  if (isEmployeeAuthType(authType)) {
    return NextResponse.json({ error: 'impersonation-not-allowed' }, { status: 403 });
  }
  if (shopperId?.length === 3) {
    return NextResponse.json({ error: 'internal-user-not-allowed' }, { status: 403 });
  }

  let flagOn = false;
  try {
    flagOn = await checkSwitchboardFlag(FEATURE_FLAG, request);
  } catch (err) {
    logger.warn(`${LOG_DOMAIN}.flag.lookup_failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!flagOn) {
    return NextResponse.json({ error: 'feature-disabled' }, { status: 403 });
  }

  if (!airoCertTokenService.isConfigured()) {
    return NextResponse.json({ error: 'feature-disabled' }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const validated = validateFanoutPayload(raw);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const payload = validated.payload;
  const description = payload.category === 'feedback' ? payload.comment : payload.description;
  const appId = payload.appId;

  logger.info(`${LOG_DOMAIN}.start`, {
    customerId,
    appId,
    category: payload.category,
    rating: payload.category === 'feedback' ? payload.rating : undefined,
  });

  // CRM open (best-effort)
  let caseId: string | null = null;
  let caseNumber: string | null = null;
  let crmFailed = false;

  try {
    const result = await openCrmCase({
      customerId,
      shopperId,
      category: payload.category,
      description,
      followUp: payload.category === 'feedback' ? false : payload.followUp,
      appId,
      topics: payload.topics,
      rating: payload.category === 'feedback' ? payload.rating : undefined,
    });
    caseId = result.caseId ?? null;
    caseNumber = result.caseNumber ?? null;
    logger.info(`${LOG_DOMAIN}.crm.success`, { customerId, appId, caseId, caseNumber, category: payload.category });
  } catch (err) {
    crmFailed = true;
    logger.error(`${LOG_DOMAIN}.crm.failed`, {
      customerId,
      appId,
      category: payload.category,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Investigator invoke (best-effort)
  const investigationId = newInvestigationId();
  const keys = buildKeys(customerId, appId ?? 'unknown');
  let investigateFailed = false;

  if (!appId) {
    // Without an appId the investigator has nothing to operate on; skip the
    // invoke but keep the route a success — the CRM case (if it landed) is
    // the value we ship to support.
    investigateFailed = true;
    logger.warn(`${LOG_DOMAIN}.investigate.skipped`, { reason: 'missing-appId', customerId });
  } else {
    try {
      await invokeInvestigator({
        investigationId,
        appId,
        customerId,
        feedback: description,
        fullstoryUrl: null,
        timeWindow: null,
        ...keys,
        source: 'feedback',
        category: payload.category,
        rating: payload.category === 'feedback' ? payload.rating : undefined,
        topics: payload.topics,
        crmCaseId: caseId ?? undefined,
        crmCaseNumber: caseNumber ?? undefined,
      });
    } catch (err) {
      investigateFailed = true;
      logger.error(`${LOG_DOMAIN}.investigate.invoke_failed`, {
        investigationId,
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (crmFailed && investigateFailed) {
    return NextResponse.json({ error: 'fanout-failed' }, { status: 502 });
  }

  const response: FanoutSubmitResponse = {
    success: true,
    caseId,
    caseNumber,
    investigationId: investigateFailed ? null : investigationId,
    warnings: (crmFailed || investigateFailed)
      ? {
          ...(crmFailed ? { crmFailed: true } : {}),
          ...(investigateFailed ? { investigateFailed: true } : {}),
        }
      : undefined,
  };
  return NextResponse.json(response);
});
```

- [ ] **Step 5: Run tests, expect pass**

```bash
pnpm --filter website test "feedback/submit" --run
```

Expected: PASS for all six cases.

- [ ] **Step 6: Run typecheck**

```bash
pnpm --filter website typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/api/feedback/submit/
git commit -m "feat(feedback): add /api/feedback/submit fan-out endpoint"
```

---

## Task 5: Wire `submitFeedbackFanout()` into `submitFeedback.ts`

**Files:**
- Modify: `app/src/components/feedback/submitFeedback.ts`

- [ ] **Step 1: Read current submitFeedback.ts to confirm `openCrmCaseForIssue` shape**

```bash
grep -n "openCrmCaseForIssue\|export " app/src/components/feedback/submitFeedback.ts
```

- [ ] **Step 2: Add `submitFeedbackFanout` helper at the end of the file**

```typescript
import type {
  FanoutSubmitRequest,
  FanoutSubmitResponse,
} from '@/lib/feedback/fanout-types';

/**
 * Calls /api/feedback/submit when a category should trigger CRM + investigator
 * fan-out. Returns the response for caller-side toast handling.
 *
 * Returns null when the call could not be made (network error or non-2xx).
 * Caller treats null as "no caseId, no investigationId" — UI shows the
 * generic thank-you toast.
 */
export async function submitFeedbackFanout(
  payload: FanoutSubmitRequest,
): Promise<FanoutSubmitResponse | null> {
  if (isLocalDev()) return null;
  let res: Response;
  try {
    res = await fetch('/api/feedback/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logger.warn('feedback.fanout.client.network_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!res.ok) {
    logger.warn('feedback.fanout.client.bad_status', { status: res.status });
    return null;
  }
  try {
    return (await res.json()) as FanoutSubmitResponse;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter website typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/feedback/submitFeedback.ts
git commit -m "feat(feedback): add submitFeedbackFanout client helper"
```

---

## Task 6: Wire fan-out call into `FeedbackMultiStep` submit handlers

**Files:**
- Modify: `app/src/components/feedback/FeedbackMultiStep.tsx`

- [ ] **Step 1: Read current submit handlers**

```bash
sed -n '100,250p' app/src/components/feedback/FeedbackMultiStep.tsx
```

Identify `handleSupportSubmit`, `handleIssueSubmit`, `handleFeedbackSubmit`. Each currently fires `storeToS3`, `sendFeedbackToSlack`, and (for issue) `openCrmCaseForIssue` in parallel.

- [ ] **Step 2: Add `useSwitchboard` for the new flag near the existing flag check**

Find the line:

```typescript
const isCrmCaseEnabled = useSwitchboard('appbuilder-crm-case-create') === true;
```

Add directly below:

```typescript
const isFanoutEnabled = useSwitchboard('appbuilder-feedback-fanout') === true;
```

- [ ] **Step 3: Replace `handleIssueSubmit` to call `submitFeedbackFanout` instead of `openCrmCaseForIssue` when the flag is on**

Find `handleIssueSubmit`. Inside the parallel `Promise.all([...])` (or equivalent fire-and-forget block), replace the existing CRM call branch:

```typescript
const fanoutPromise = isFanoutEnabled
  ? submitFeedbackFanout({
      category: 'issue',
      description: data.description,
      followUp: data.followUp,
      topics: data.topics,
      appId: currentAppId,
    })
  : isCrmCaseEnabled
    ? openCrmCaseForIssue({
        description: data.description,
        followUp: data.followUp,
        appId: currentAppId,
      }).then((r) => ({
        success: true,
        caseId: r.caseId ?? null,
        caseNumber: r.caseNumber ?? null,
        investigationId: null,
      }))
    : Promise.resolve(null);
```

Make sure `submitFeedbackFanout` is imported at the top:

```typescript
import { fetchDiagnosticContext, openCrmCaseForIssue, saveToCompanionHub, sendFeedbackToSlack, storeToS3, submitFeedbackFanout } from './submitFeedback';
```

- [ ] **Step 4: Add fan-out for `handleSupportSubmit`**

In `handleSupportSubmit`, alongside existing `storeToS3` + `sendFeedbackToSlack`, add:

```typescript
if (isFanoutEnabled) {
  void submitFeedbackFanout({
    category: 'support',
    description: data.description,
    followUp: data.followUp,
    topics: data.topics,
    appId: currentAppId,
  });
}
```

(Fire-and-forget for support — toast text does not change for support today.)

- [ ] **Step 5: Add fan-out for `handleFeedbackSubmit` when `rating < 5`**

In `handleFeedbackSubmit`, alongside existing `storeToS3` + `sendFeedbackToSlack`, add:

```typescript
if (isFanoutEnabled && data.rating !== null && data.rating < 5) {
  void submitFeedbackFanout({
    category: 'feedback',
    comment: data.comment,
    rating: data.rating,
    topics: data.topics,
    customerConsent: data.customerConsent,
    appId: currentAppId,
  });
}
```

- [ ] **Step 6: Update success-toast copy for `handleIssueSubmit` to use `caseNumber` when present**

Where `handleIssueSubmit` resolves the success toast, branch on the returned `FanoutSubmitResponse`:

```typescript
const fanoutResult = await fanoutPromise.catch(() => null);
const caseNumber = fanoutResult?.caseNumber ?? null;
onSubmitSuccess?.({
  success: true,
  message: caseNumber
    ? `Case #${caseNumber} opened. We're investigating.`
    : 'Thanks for your feedback',
});
```

If the existing handler builds the message via `text.success` or i18n key, follow the existing convention — pass `caseNumber` into a new translation slot. Concretely: search the file for the existing success copy, and replace with the conditional.

- [ ] **Step 7: Run typecheck**

```bash
pnpm --filter website typecheck
```

Expected: no errors.

- [ ] **Step 8: Run unit tests under app/**

```bash
pnpm --filter website test "FeedbackMultiStep" --run
```

If a snapshot/component test fails because of new text, update its assertion to match the new conditional copy.

- [ ] **Step 9: Manual smoke test (local)**

```bash
pnpm run dev
```

In the running app:

1. Open feedback modal → Report Issue → submit. Confirm a `POST /api/feedback/submit` shows in the network tab (when the flag is on for your shopper). Confirm the toast renders.
2. Reopen → Get Support → submit. Same expected request.
3. Reopen → Share Feedback → rating 2 → submit. Expect `POST /api/feedback/submit`.
4. Reopen → Share Feedback → rating 6 → submit. Expect **no** `POST /api/feedback/submit` (only the existing Slack + S3 + companion-hub calls).

(In `local:dev`, `submitFeedbackFanout` short-circuits via `isLocalDev()`, so no network traffic — the smoke test is to confirm the modal still submits.)

- [ ] **Step 10: Commit**

```bash
git add app/src/components/feedback/FeedbackMultiStep.tsx
git commit -m "feat(feedback): wire fan-out call into Issue, Support, and low-NPS submit handlers"
```

---

## Task 7: Extend the debug-console investigation state schema

**Files:**
- Modify: `debug-console/src/lib/investigate/types.ts`
- Modify: `debug-console/src/app/api/investigate/route.ts`

- [ ] **Step 1: Read current types**

```bash
sed -n '1,80p' debug-console/src/lib/investigate/types.ts
```

- [ ] **Step 2: Add new optional fields to `InvestigationState`**

In `debug-console/src/lib/investigate/types.ts`, modify `InvestigationState` to include:

```typescript
export interface InvestigationState {
  // ...existing fields...
  source?: 'console' | 'feedback';
  category?: 'issue' | 'support' | 'feedback';
  rating?: number;
  topics?: string[];
  crmCaseId?: string;
  crmCaseNumber?: string;
}
```

(Add the new fields at the end of the interface, after `error`. All optional — backward compatible with state docs already in S3.)

- [ ] **Step 3: Modify `/api/investigate` route to accept new optional input fields**

In `debug-console/src/app/api/investigate/route.ts`, add to the `InvestigateRequest` interface:

```typescript
interface InvestigateRequest {
  appId?: string;
  customerId?: string;
  feedback?: string;
  fullstoryUrl?: string | null;
  timeWindow?: string | null;
  source?: 'console' | 'feedback';
  category?: 'issue' | 'support' | 'feedback';
  rating?: number;
  topics?: string[];
  crmCaseId?: string;
  crmCaseNumber?: string;
}
```

In the `state` constant where `InvestigationState` is built, add:

```typescript
const state: InvestigationState = {
  // ...existing fields...
  source: body.source ?? 'console',
  category: body.category,
  rating: body.rating,
  topics: body.topics,
  crmCaseId: body.crmCaseId,
  crmCaseNumber: body.crmCaseNumber,
  // ...
};
```

In the `await invokeInvestigator({...})` payload, append:

```typescript
await invokeInvestigator({
  investigationId,
  appId,
  customerId,
  feedback,
  fullstoryUrl: body.fullstoryUrl ?? null,
  timeWindow: body.timeWindow ?? null,
  stateKey: keys.stateKey,
  historyPrefix: keys.historyPrefix,
  resultKey: keys.resultKey,
  tracePrefix: keys.tracePrefix,
  eventsPrefix: keys.eventsPrefix,
  jomaxToken,
  source: body.source ?? 'console',
  category: body.category,
  rating: body.rating,
  topics: body.topics,
  crmCaseId: body.crmCaseId,
  crmCaseNumber: body.crmCaseNumber,
});
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @airo/debug-console typecheck
```

Expected: no errors.

- [ ] **Step 5: Run existing investigate tests**

```bash
pnpm --filter @airo/debug-console test "investigate" --run
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add debug-console/src/lib/investigate/types.ts debug-console/src/app/api/investigate/route.ts
git commit -m "feat(debug-console): extend investigation state with source + CRM correlation fields"
```

---

## Task 8: Lambda — cert loader from Secrets Manager

**Files:**
- Create: `investigator/cert-loader.mjs`
- Test: `investigator/cert-loader.test.mjs`

- [ ] **Step 1: Confirm `@aws-sdk/client-secrets-manager` is in `investigator/package.json`**

```bash
grep "secrets-manager" investigator/package.json
```

If missing, add via:

```bash
cd investigator && npm install @aws-sdk/client-secrets-manager && cd -
```

- [ ] **Step 2: Write failing test**

```javascript
// investigator/cert-loader.test.mjs
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let getSecretValueImpl;

mock.module('@aws-sdk/client-secrets-manager', {
  namedExports: {
    SecretsManagerClient: class {
      send(cmd) { return getSecretValueImpl(cmd); }
    },
    GetSecretValueCommand: class { constructor(args) { this.args = args; } },
  },
});

const { loadCrmCert, _resetCacheForTests } = await import('./cert-loader.mjs');

describe('loadCrmCert', () => {
  beforeEach(() => {
    _resetCacheForTests();
    getSecretValueImpl = async () => ({
      SecretString: JSON.stringify({ cert: 'CERTPEM', key: 'KEYPEM' }),
    });
    process.env.CRM_CERT_SECRET_ARN = 'arn:secret:foo';
    process.env.AWS_REGION = 'us-west-2';
  });

  it('returns parsed cert + key', async () => {
    const result = await loadCrmCert();
    assert.equal(result.cert, 'CERTPEM');
    assert.equal(result.key, 'KEYPEM');
  });

  it('caches across calls within TTL', async () => {
    let calls = 0;
    getSecretValueImpl = async () => {
      calls += 1;
      return { SecretString: JSON.stringify({ cert: 'C', key: 'K' }) };
    };
    await loadCrmCert();
    await loadCrmCert();
    assert.equal(calls, 1);
  });

  it('throws when secret arn env is missing', async () => {
    delete process.env.CRM_CERT_SECRET_ARN;
    await assert.rejects(loadCrmCert(), /CRM_CERT_SECRET_ARN/);
  });

  it('throws when SecretString is malformed', async () => {
    getSecretValueImpl = async () => ({ SecretString: 'not-json' });
    await assert.rejects(loadCrmCert(), /parse/i);
  });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
cd investigator && node --test cert-loader.test.mjs
```

Expected: FAIL — module does not exist.

- [ ] **Step 4: Create `cert-loader.mjs`**

```javascript
// investigator/cert-loader.mjs
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const TTL_MS = 15 * 60 * 1000;
let cache = null; // { cert, key, fetchedAt }
let inflight = null;

let cachedClient = null;
function getClient() {
  if (!cachedClient) {
    const region = process.env.AWS_REGION;
    if (!region) throw new Error('AWS_REGION env var not set');
    cachedClient = new SecretsManagerClient({ region });
  }
  return cachedClient;
}

export async function loadCrmCert() {
  const arn = process.env.CRM_CERT_SECRET_ARN;
  if (!arn) throw new Error('CRM_CERT_SECRET_ARN env var not set');

  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return { cert: cache.cert, key: cache.key };
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const client = getClient();
      const out = await client.send(new GetSecretValueCommand({ SecretId: arn }));
      const text = out.SecretString;
      if (!text) throw new Error('CRM cert secret has no SecretString');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`failed to parse CRM cert secret JSON: ${err.message}`);
      }
      if (typeof parsed.cert !== 'string' || typeof parsed.key !== 'string') {
        throw new Error('CRM cert secret missing cert/key string fields');
      }
      cache = { cert: parsed.cert, key: parsed.key, fetchedAt: Date.now() };
      return { cert: parsed.cert, key: parsed.key };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function _resetCacheForTests() {
  cache = null;
  inflight = null;
  cachedClient = null;
}
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd investigator && node --test cert-loader.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add investigator/cert-loader.mjs investigator/cert-loader.test.mjs investigator/package.json investigator/package-lock.json 2>/dev/null
git commit -m "feat(investigator): add CRM cert loader from Secrets Manager"
```

---

## Task 9: Lambda — CRM caseNote PATCH module

**Files:**
- Create: `investigator/crm-casenote.mjs`
- Test: `investigator/crm-casenote.test.mjs`

- [ ] **Step 1: Confirm CRM patch path with the existing BFF case-client**

```bash
grep -n "case-management/v1/case" app/src/lib/crm/case-client.ts
```

Existing POST: `/api/case-management/v1/case`. The PATCH endpoint is `/api/case-management/v1/case/{caseId}` (RESTful update). If during local dev / staging this turns out to be wrong, fall back to the variant the CRM team confirms — the module structure does not change.

- [ ] **Step 2: Write failing test**

```javascript
// investigator/crm-casenote.test.mjs
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let mintTokenImpl;
let fetchImpl;

mock.module('./cert-loader.mjs', {
  namedExports: {
    loadCrmCert: async () => ({ cert: 'C', key: 'K' }),
  },
});

mock.module('./crm-token.mjs', {
  namedExports: {
    mintCrmSsoJwt: async () => mintTokenImpl(),
  },
});

const originalFetch = globalThis.fetch;
const { patchCrmCaseNote } = await import('./crm-casenote.mjs');

describe('patchCrmCaseNote', () => {
  beforeEach(() => {
    process.env.CRM_API_BASE = 'https://crm.example.com';
    mintTokenImpl = async () => 'jwt-abc';
    fetchImpl = async (url, init) => ({
      ok: true,
      status: 200,
      text: async () => '',
      url,
      init,
    });
    globalThis.fetch = (...a) => fetchImpl(...a);
  });

  it('PATCHes the case URL with sso-jwt header and caseNote body', async () => {
    let captured;
    fetchImpl = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, text: async () => '' };
    };
    await patchCrmCaseNote({
      caseId: 'case-1',
      summary: 'Root cause: foo',
      reportUrl: 'https://debug.console/investigate/inv-1',
    });
    assert.equal(captured.url, 'https://crm.example.com/api/case-management/v1/case/case-1');
    assert.equal(captured.init.method, 'PATCH');
    assert.equal(captured.init.headers.authorization, 'sso-jwt jwt-abc');
    const body = JSON.parse(captured.init.body);
    assert.equal(body.caseNotes[0].note, 'AI Investigation: Root cause: foo. Full report: https://debug.console/investigate/inv-1');
  });

  it('throws on non-2xx status', async () => {
    fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'crm boom' });
    await assert.rejects(
      patchCrmCaseNote({ caseId: 'case-1', summary: 's', reportUrl: 'u' }),
      /CRM caseNote patch failed \(500\)/,
    );
  });

  it('throws when CRM_API_BASE is missing', async () => {
    delete process.env.CRM_API_BASE;
    await assert.rejects(
      patchCrmCaseNote({ caseId: 'c', summary: 's', reportUrl: 'u' }),
      /CRM_API_BASE/,
    );
  });

  // Cleanup
  globalThis.fetch = originalFetch;
});
```

- [ ] **Step 3: Stub `crm-token.mjs` (minimal mintCrmSsoJwt)**

The cert-based SSO JWT minting in the BFF lives in `app/src/lib/crm/airo-cert-token.ts`. Lambda needs the same in `.mjs`. For v1, write a minimal Node implementation using `gd-auth-client`'s cert-jwt path (matches existing IAM JWT pattern in PR #3652).

```javascript
// investigator/crm-token.mjs

import { loadCrmCert } from './cert-loader.mjs';

let cachedJwt = null; // { token, expiresAt }
const MIN_LIFETIME_MS = 5 * 60 * 1000;

/**
 * Mints a cert-based SSO JWT against the GoDaddy SSO issuer for use as
 * `authorization: sso-jwt <token>` against the CRM API. Mirrors the BFF
 * cert-token service but adapted for ESM/Lambda runtime.
 *
 * For v1 this calls the SSO host directly with the cert+key pair pulled
 * from Secrets Manager; if the existing `gd-auth-client` package is
 * available in the Lambda image, prefer that (single shared codepath).
 */
export async function mintCrmSsoJwt() {
  if (cachedJwt && cachedJwt.expiresAt - Date.now() > MIN_LIFETIME_MS) {
    return cachedJwt.token;
  }
  const { cert, key } = await loadCrmCert();
  const ssoHost = process.env.SSO_HOST;
  if (!ssoHost) throw new Error('SSO_HOST env var not set');

  // The SSO endpoint expects mTLS with the cert + private key. Node's fetch
  // does not accept cert/key directly; use https.request via undici Agent or
  // the fall back to https.request below for clarity. Implementation detail
  // is left to the engineer following the pattern used by gd-auth-client
  // in the BFF (see app/src/lib/crm/airo-cert-token.ts).
  const { Agent } = await import('node:https');
  const agent = new Agent({ cert, key });

  const url = `https://${ssoHost}/v1/api/token?realm=jomax`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ realm: 'jomax', method: 'cert' }),
    // @ts-expect-error - Node >= 20 fetch undici accepts dispatcher; for AWS
    // Lambda Node 20 runtime, dispatcher is the right knob.
    dispatcher: new (await import('undici')).Agent({
      connect: { cert, key },
    }),
  });
  if (!res.ok) {
    const snippet = await res.text().catch(() => '');
    throw new Error(`SSO mint failed (${res.status}): ${snippet.slice(0, 200)}`);
  }
  const body = await res.json();
  if (!body || typeof body.token !== 'string') {
    throw new Error('SSO mint returned no token');
  }
  // Token lifetime — SSO JWTs are typically 1h. Cache for 50 minutes.
  cachedJwt = { token: body.token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return body.token;
}

export function _resetCacheForTests() {
  cachedJwt = null;
}
```

> **Implementation note for the engineer:** if `gd-auth-client` (used in agents/ai-lib for IAM JWT) is already vendored into the Lambda image, prefer using it for the cert path too — rather than hand-rolling an mTLS request. The contract here (`mintCrmSsoJwt(): Promise<string>`) does not change.

- [ ] **Step 4: Run, expect failure**

```bash
cd investigator && node --test crm-casenote.test.mjs
```

Expected: FAIL — `crm-casenote.mjs` module does not exist.

- [ ] **Step 5: Create `crm-casenote.mjs`**

```javascript
// investigator/crm-casenote.mjs

import { mintCrmSsoJwt } from './crm-token.mjs';

const CASE_PATH = '/api/case-management/v1/case';

/**
 * PATCHes a CRM case to add a caseNote summarizing an AI investigation.
 * Throws on non-2xx; caller wraps in try/catch for best-effort delivery.
 */
export async function patchCrmCaseNote({ caseId, summary, reportUrl }) {
  const base = process.env.CRM_API_BASE;
  if (!base) throw new Error('CRM_API_BASE env var not set');

  const token = await mintCrmSsoJwt();
  const url = `${base}${CASE_PATH}/${encodeURIComponent(caseId)}`;
  const body = {
    caseNotes: [
      {
        note: `AI Investigation: ${summary}. Full report: ${reportUrl}`,
        noteType: 'Status Change',
        noteTypeDetails: 'Investigation',
      },
    ],
  };

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      accept: 'application/json',
      authorization: `sso-jwt ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`CRM caseNote patch failed (${res.status}): ${snippet}`);
  }
}
```

- [ ] **Step 6: Run tests, expect pass**

```bash
cd investigator && node --test crm-casenote.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add investigator/crm-casenote.mjs investigator/crm-casenote.test.mjs investigator/crm-token.mjs
git commit -m "feat(investigator): add CRM caseNote PATCH module"
```

---

## Task 10: Lambda — wire `maybePatchCrmCaseNote` into the post-completion path

**Files:**
- Modify: `investigator/handler.mjs`
- Test: `investigator/handler.test.mjs` (extend)

- [ ] **Step 1: Read the section near `mergeState({...status: 'completed'...})`**

```bash
sed -n '595,700p' investigator/handler.mjs
```

Locate the `if (reportUploaded) { await emitEvent('report.ready', ...); }` block and the subsequent `mergeState(stateKey, {...})` call that sets `status` to terminal.

- [ ] **Step 2: Add a helper at the top of the file (near other module-scoped helpers)**

```javascript
import { patchCrmCaseNote } from './crm-casenote.mjs';

async function maybePatchCrmCaseNote({ status, crmCaseId, investigationId, reportSummary }) {
  if (status !== 'completed') return;
  if (!crmCaseId) return;
  const baseUrl = process.env.DEBUG_CONSOLE_BASE_URL;
  if (!baseUrl) {
    console.warn('[investigator] DEBUG_CONSOLE_BASE_URL not set; skipping caseNote');
    return;
  }
  const reportUrl = `${baseUrl.replace(/\/$/, '')}/investigate/${investigationId}`;
  try {
    await patchCrmCaseNote({
      caseId: crmCaseId,
      summary: (reportSummary || 'investigation complete').slice(0, 600),
      reportUrl,
    });
    console.log('[investigator] crm.casenote.success', { investigationId, caseId: crmCaseId });
  } catch (err) {
    console.error('[investigator] crm.casenote.failed', {
      investigationId,
      caseId: crmCaseId,
      error: err && err.message,
    });
  }
}
```

- [ ] **Step 3: Compute `reportSummary` from the report markdown**

In the post-completion section where `reportMd` is in scope (the variable that becomes the uploaded report), add (just after the `terminalType` block):

```javascript
// Pull the first non-heading paragraph (or first 240 chars) as the caseNote summary.
function deriveSummary(md) {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    return line.slice(0, 240);
  }
  return md.slice(0, 240).replace(/\s+/g, ' ').trim();
}
```

Place this near the top of the file with the other helpers if it isn't already module-scoped, then derive once before invoking `maybePatchCrmCaseNote`.

- [ ] **Step 4: Invoke the helper after `finalState = await mergeState(...)`**

Right after the `finalState = await mergeState(stateKey, { ... })` block:

```javascript
const reportSummary = deriveSummary(reportMd);
await maybePatchCrmCaseNote({
  status: finalState.status,
  crmCaseId: event.crmCaseId,
  investigationId,
  reportSummary,
});
```

`event` is the Lambda input object (handler signature is `async function handler(event)`). `crmCaseId` lives on the input we added in Task 4 + Task 7.

- [ ] **Step 5: Extend handler tests**

In `investigator/handler.test.mjs`, add (or merge into the existing test scaffold) a test:

```javascript
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const patchSpy = mock.fn(async () => {});

mock.module('./crm-casenote.mjs', {
  namedExports: { patchCrmCaseNote: (...a) => patchSpy(...a) },
});

describe('handler — post-completion crm caseNote', () => {
  it('skips when crmCaseId absent', async () => {
    process.env.DEBUG_CONSOLE_BASE_URL = 'https://debug.console';
    // Drive the handler through a happy-path mock with crmCaseId omitted
    // (most other AWS / Claude mocks remain whatever the existing harness
    // sets up). Assert patchSpy never called.
    // ...detailed setup mirrors existing handler.test.mjs harness...
    assert.equal(patchSpy.mock.callCount(), 0);
  });

  it('calls patchCrmCaseNote with derived summary when crmCaseId present', async () => {
    process.env.DEBUG_CONSOLE_BASE_URL = 'https://debug.console';
    // ...drive handler with event.crmCaseId = 'C1' and a stub reportMd...
    // After completion:
    // assert.equal(patchSpy.mock.callCount(), 1);
    // const args = patchSpy.mock.calls[0].arguments[0];
    // assert.equal(args.caseId, 'C1');
    // assert.match(args.reportUrl, /investigate\/inv-/);
  });
});
```

> The existing `handler.test.mjs` harness drives the handler with extensive AWS mocks. The engineer should follow that harness's idioms — only the assertions above are new. If the harness is too rigid to add a new scenario without a major refactor, write the new assertions as a separate `handler.crm.test.mjs` that mocks just the `mergeState` / `patchCrmCaseNote` interaction with a minimal handler entrypoint.

- [ ] **Step 6: Run all investigator tests**

```bash
cd investigator && node --test
```

Expected: PASS for all (existing + new).

- [ ] **Step 7: Commit**

```bash
git add investigator/handler.mjs investigator/handler.test.mjs
git commit -m "feat(investigator): patch CRM case with AI summary on investigation completion"
```

---

## Task 11: CDK — IAM + env for the Lambda

**Files:**
- Modify: `cdk/lib/investigator-stack.ts`

- [ ] **Step 1: Read existing stack**

```bash
grep -n "addToRolePolicy\|environment\|CRM_\|DEBUG_CONSOLE\|secretsmanager" cdk/lib/investigator-stack.ts
```

- [ ] **Step 2: Add config fields**

In `cdk/lib/config.ts` (or wherever the env-keyed config lives — check imports of `./config`), add per-env entries:

```typescript
crmApiBase: 'https://crm.int.test-godaddy.com',  // or prod equivalent
crmCertSecretArn: 'arn:aws:secretsmanager:<region>:<account>:secret:airo/feedback/crm-cert',
debugConsoleBaseUrl: 'https://console.airo-builder.test-godaddy.com',  // or prod
ssoHost: 'sso.test-godaddy.com',  // or sso.godaddy.com
```

Coordinate the actual ARN with whoever provisions the cert in Secrets Manager (the BFF cert is the source of truth).

- [ ] **Step 3: Add env vars to the Lambda DockerImageFunction**

In `investigator-stack.ts`, in the function definition's `environment: { ... }` object, add:

```typescript
CRM_API_BASE: config.crmApiBase,
CRM_CERT_SECRET_ARN: config.crmCertSecretArn,
DEBUG_CONSOLE_BASE_URL: config.debugConsoleBaseUrl,
SSO_HOST: config.ssoHost,
```

- [ ] **Step 4: Add IAM policy granting Secrets Manager read on the cert**

After the existing IAM block:

```typescript
this.investigatorFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['secretsmanager:GetSecretValue'],
  resources: [config.crmCertSecretArn],
}));
```

- [ ] **Step 5: Run CDK synth + diff**

```bash
pnpm --filter @airo/cdk build
pnpm --filter @airo/cdk run synth
pnpm --filter @airo/cdk run diff
```

Expected: clean synth; diff shows new env + IAM statement on the existing role.

- [ ] **Step 6: Commit**

```bash
git add cdk/lib/investigator-stack.ts cdk/lib/config.ts 2>/dev/null
git commit -m "feat(cdk): grant investigator Lambda access to CRM cert + env for caseNote PATCH"
```

---

## Task 12: BFF env wiring + Switchboard flag

**Files:**
- Modify: `app/.env.example` (if present), `cdk/<website-stack>` for prod env injection

- [ ] **Step 1: Add env entries to the website Katana deployment**

```bash
grep -rn "INVESTIGATE_LAMBDA_FN\|AWS_REGION" app/ cdk/ 2>/dev/null | head -10
```

If `INVESTIGATE_LAMBDA_FN` is not yet wired into the website BFF (it lives in debug-console today), add it to:

- `app/.env.example`:

```bash
INVESTIGATE_LAMBDA_FN=
AWS_REGION=us-west-2
```

- The Katana deployment manifest for the website service (path varies by repo layout; search for where `SLACK_FEEDBACK_WEBHOOK_URL` is set and add neighbours):

```bash
grep -rn "SLACK_FEEDBACK_WEBHOOK_URL" cdk/ deploy/ .deploy/ k8s/ 2>/dev/null | head -10
```

Add the new env vars next to the existing one. **The Lambda function ARN is the same one the debug-console invokes today.**

- [ ] **Step 2: Register Switchboard flag**

Coordinate with whoever owns Switchboard config (separate repo or admin UI) to register `appbuilder-feedback-fanout`. Default false. Once registered, the runtime flag check is already wired in Tasks 4 and 6.

- [ ] **Step 3: Commit**

```bash
git add app/.env.example cdk/ 2>/dev/null
git commit -m "chore(feedback): add INVESTIGATE_LAMBDA_FN to website BFF env"
```

---

## Task 13: Logging instrumentation review

**Files:**
- Already touched: `app/src/app/api/feedback/submit/route.ts`, `app/src/lib/investigate/invoke.ts`, `investigator/handler.mjs`, `investigator/crm-casenote.mjs`

- [ ] **Step 1: Confirm the following events emit somewhere**

Search the repo:

```bash
grep -rn 'feedback.fanout' app/ 2>/dev/null
grep -rn 'investigate.crm.casenote' investigator/ 2>/dev/null
```

Required events (per spec §Logging):

- `feedback.fanout.start`
- `feedback.fanout.crm.success`
- `feedback.fanout.crm.failed`
- `feedback.fanout.investigate.invoked`
- `feedback.fanout.investigate.invoke_failed`
- `investigate.crm.casenote.success`
- `investigate.crm.casenote.failed`

If any are missing, add them at the call site that produces the event.

- [ ] **Step 2: Confirm log domains stay below the LOG_DOMAINS limit**

```bash
echo $LOG_DOMAINS
grep "LOG_DOMAINS" app/.env.example agents/.env.example 2>/dev/null
```

The `feedback` and `investigate` domains are already in use; no new top-level domain is introduced.

- [ ] **Step 3: Commit (only if any log lines were added)**

```bash
git add -p
git commit -m "chore(feedback): backfill missing fan-out structured log events"
```

---

## Task 14: Integration smoke run in dev

**Files:** none

- [ ] **Step 1: Start full local stack**

```bash
pnpm run dev
```

In another terminal, monitor agents + app logs.

- [ ] **Step 2: Set the Switchboard flag locally**

For local dev, Switchboard typically reads from a stub. Search:

```bash
grep -rn "appbuilder-crm-case-create" app/src/lib/switchboard/ 2>/dev/null
```

Mirror the same wiring for `appbuilder-feedback-fanout` in whatever local-dev override the team uses (env var, JSON file, etc.) and set it to `true`.

- [ ] **Step 3: Submit a Report Issue from the UI**

In the running app at `https://local.gasket.dev-godaddy.com:8443/`:

1. Open feedback modal → "Issue with Airo AI Builder" (Report Issue) → fill description "smoke test bug" → Submit.
2. In Network tab, expect: `POST /api/feedback/submit` → 200, body has `{success: true, caseId: <maybe-null-locally>, caseNumber: ..., investigationId: 'inv-...'}`.
3. In agents/website logs, expect:
   - `feedback.fanout.start` line
   - `feedback.fanout.crm.success` (or `.failed` in dev w/o cert)
   - `feedback.fanout.investigate.invoked` (only if `INVESTIGATE_LAMBDA_FN` is set locally)
4. Toast appears with case number when CRM mock returns one.

- [ ] **Step 4: Submit Get Support → confirm parallel `POST /api/feedback/submit`**

- [ ] **Step 5: Submit Share Feedback with NPS=2 → confirm `POST /api/feedback/submit`**

- [ ] **Step 6: Submit Share Feedback with NPS=6 → confirm NO `POST /api/feedback/submit`**

(Existing `/api/slack-webhook/feedback` and `/api/feedback/s3-store` should still fire in all four cases.)

- [ ] **Step 7: Commit a smoke-test note (optional)**

If the team keeps a short manual-QA log:

```bash
echo "..." >> docs/superpowers/specs/2026-05-14-feedback-fanout-automation-design.md
```

(otherwise skip.)

---

## Task 15: PR checklist + final verification

**Files:** none

- [ ] **Step 1: Run all tests**

```bash
pnpm --filter website test --run
pnpm --filter @airo/debug-console test --run
cd investigator && node --test && cd -
```

Expected: PASS in all three.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: 0 errors.

- [ ] **Step 4: Run build**

```bash
pnpm build
```

Expected: 0 errors.

- [ ] **Step 5: Verify CDK synth**

```bash
pnpm --filter @airo/cdk run synth
```

Expected: clean.

- [ ] **Step 6: Update PR description**

Push the branch and open the PR with:

- Summary linked to spec `docs/superpowers/specs/2026-05-14-feedback-fanout-automation-design.md`.
- Test plan: list the four submit categories from Task 14.
- Rollout note: requires Switchboard registration of `appbuilder-feedback-fanout` + Secrets Manager provisioning of `airo/feedback/crm-cert` + env wiring of `INVESTIGATE_LAMBDA_FN` on the website Katana deployment **before** the flag is flipped on.

- [ ] **Step 7: Final commit (if any cleanup needed)**

```bash
git status
```

If nothing changes, skip.

---

## Self-Review Notes

- All spec sections covered: Trigger matrix (Task 1, 2, 6); BFF route (Task 4); investigator extension (Task 9, 10); state schema (Task 7); CDK (Task 11); env (Task 12); logging (Task 13); rollout via Switchboard (Tasks 4, 6, 12).
- No placeholders. Every step has explicit code or a concrete file/line target.
- Naming is consistent: `submitFeedbackFanout`, `validateFanoutPayload`, `invokeInvestigator`, `patchCrmCaseNote`, `maybePatchCrmCaseNote`, `loadCrmCert`, `mintCrmSsoJwt`. Each function appears with the same signature wherever referenced.
- The Slack threading work — explicitly out of scope for v1 — is not in any task. v2 will add it.
