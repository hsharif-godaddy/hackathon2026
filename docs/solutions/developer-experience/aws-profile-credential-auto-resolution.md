---
title: "AWS Profile Credential Auto-Resolution in agents load-env"
date: 2026-03-25
category: developer-experience
module: agents
problem_type: developer_experience
component: tooling
root_cause: missing_tooling
resolution_type: tooling_addition
severity: medium
date_encountered: 2026-03-25
date_resolved: 2026-03-25
affected_services:
  - agents
tags:
  - aws-credentials
  - environment-setup
  - bedrock
  - sso
  - local-development
related_files:
  - agents/load-env.cjs
  - scripts/load-env.js
---

# AWS Profile Credential Auto-Resolution in agents load-env

## Problem

`agents/load-env.cjs` rejected `AWS_PROFILE` env var and exited, forcing developers to manually export raw AWS credentials to `agents/.env.local` every ~4 hours when Bedrock session tokens expired.

## Symptoms

- Running `pnpm run dev` fails with: "AWS_PROFILE is set in your environment. Please remove it before running the agents service"
- Must manually run `aws configure export-credentials --profile airobuild-dev-private-sso --format env-no-export | grep -v EXPIRATION > agents/.env.local` 2-3 times per day (auto memory [claude])
- After ~4 hours: Bedrock API calls fail with expired token errors
- `unset AWS_PROFILE` sometimes ineffective due to direnv re-injection (auto memory [claude])
- Contradiction: `setup/` generates `.env.local.dev` with `AWS_PROFILE=airobuild-dev-private-sso` but agents startup rejects it

## What Didn't Work

**Option B: Remove AWS_PROFILE rejection, trust AWS SDK to resolve**
- Rejected: SDK may cache stale credentials in long-running dev process, causing silent failures after expiration.

**Option C: Background credential refresh daemon**
- Rejected: Overkill for a dev-only problem. Adds process management complexity.

**Option D: Mid-session auto-refresh (detect Bedrock 403, re-resolve)**
- Deferred to v2: Crosses package boundaries (ai-lib -> agents error handling layer). Startup-only resolution already eliminates the manual export workflow.

## Solution

Modified `validateEnvironment()` in `agents/load-env.cjs` (line 99) to allow `AWS_PROFILE` in local dev instead of unconditionally rejecting it.

**Before:**
```javascript
async function validateEnvironment() {
  if (process.env.AWS_PROFILE) {
    console.error('\n AWS_PROFILE is set in your environment');
    console.error('   Please remove it before running the agents service\n');
    process.exit(1);
  }
}
```

**After:**
```javascript
async function validateEnvironment() {
  // AWS_PROFILE is expected in local dev for S2S auth (logo generation,
  // budget service, knowledge service, etc.). In non-local environments
  // it should not be set — it interferes with instance-profile credentials.
  const isLocal = (process.env.GASKET_ENV || '').startsWith('local') || process.env.NODE_ENV === 'development';
  if (process.env.AWS_PROFILE && !isLocal) {
    console.error('\n❌ AWS_PROFILE is set in your environment');
    console.error('   Please remove it before running the agents service\n');
    process.exit(1);
  }
}
```

The function still exists and still rejects `AWS_PROFILE` in non-local environments. The fix was adding the `isLocal` guard so local dev is allowed through. The AWS SDK then resolves credentials from the profile automatically at call time.

**Note:** Bedrock was removed from the codebase on 2026-03-30. The AI provider is now GoCode proxy (OpenAI-compatible). AWS_PROFILE is still needed locally for S2S auth to other AWS services (logo generation, budget service, knowledge service).

**Developer flow change:**
- Before: `aws sso login` -> `aws configure export-credentials ... > agents/.env.local` -> `pnpm dev` (repeat export every 4hrs)
- After: `aws sso login` (once/day) -> `pnpm dev` (SDK resolves creds from profile at call time)

## Why This Works

**Root cause:** The agents startup script enforced a policy (reject AWS_PROFILE) that contradicted setup tooling output (generate `.env.local.dev` with AWS_PROFILE). This forced a manual workaround loop.

**Fix mechanism:**
1. **Local guard:** `isLocal` check (`GASKET_ENV.startsWith('local') || NODE_ENV === 'development'`) skips the rejection
2. **SDK resolution:** AWS SDK resolves credentials from the profile at call time (no manual export needed)
3. **Non-local rejection preserved:** In deployed environments, `AWS_PROFILE` still causes an error (it interferes with instance-profile credentials)

**Key insight:** The app service's `scripts/load-env.js` already handled `AWS_PROFILE` correctly for Switchboard auth. The agents service was the only place rejecting it.

## Prevention

- When adding env var validation/rejection to startup scripts, grep for that var in setup tooling output (`.env.example`, `setup/src/env-generator.ts`) to catch contradictions
- If a manual workaround appears in developer memory or onboarding docs, treat it as a signal of tooling misalignment worth fixing
- The app service (`scripts/load-env.js`) and agents service (`agents/load-env.cjs`) have different credential needs: app uses `AWS_PROFILE` for Switchboard auth, agents uses it for S2S auth to AWS services
- Bedrock was removed 2026-03-30; AWS creds are no longer needed for AI provider calls, only for S2S auth to other services
