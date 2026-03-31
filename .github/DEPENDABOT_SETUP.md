# Dependabot Configuration

## Overview

This repository uses **Dependabot** to automatically check for dependency updates across the pnpm workspace. **npm**-ecosystem jobs are configured to use the **GoDaddy JFrog virtual npm registry** (`node-virt`) as the **base** registry (`replaces-base: true` in `.github/dependabot.yml`), so resolution goes through Artifactory—not directly to `registry.npmjs.org`.

Public packages are still available when the virtual repository proxies the public npm registry (typical setup). Internal or private packages are resolvable **only if** they are exposed through that virtual repo **and** Dependabot can authenticate.

## Configuration

**Registry:** `jfrog-npm` in `dependabot.yml` points at `https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt` with `jfrog-oidc-provider-name: github`.

**Authentication:** Dependabot must have **authenticated access** to that registry (for example **JFrog OIDC for GitHub** configured at the organization or repository level). Without valid auth, updates fail with `401` / `private_source_authentication_failure`.

**Security updates:** GitHub-triggered security update jobs also need registry credentials where the updater uses the same registry; align org/repo Dependabot secrets and OIDC with platform guidance.

## What Dependabot Will Do

Dependabot will:

- ✅ **Scan weekly** - Every Monday morning (staggered times in UTC)
- ✅ **Monitor all workspace packages** - root, agents, app, cdk, proxy, packages/ai-lib, packages/design-extractor, setup, bedrock-log-viewer, debug-console
- ✅ **Resolve npm dependencies via Artifactory** - Public (proxied) and internal packages, subject to virtual repo composition and auth
- ✅ **Create grouped PRs** - Related updates bundled together
- ✅ **Monitor GitHub Actions** - Also checks for workflow dependency updates (no npm registry)

### Update Groups

To reduce PR noise, updates are grouped by:

- **aws-sdk** - AWS SDK, Smithy packages
- **react** - React, React DOM, and types
- **nextjs** - Next.js packages
- **ai-sdk** - AI SDK packages
- **testing** - Jest, Vitest, Playwright, Testing Library
- **code-quality** - ESLint, TypeScript, Prettier
- **prisma** - Prisma client and CLI

## Limitations

- **Virtual repo scope** - Only packages available through the configured JFrog virtual repository can be resolved.
- **Auth** - Misconfigured or missing OIDC/secrets produces `401` or similar; fix registry access, not `dependabot.yml` alone.
- **pnpm workspace** - Root `pnpm update -r` style resolution can still touch every workspace member; private deps in any member require successful Artifactory auth for the whole resolve graph.

## Troubleshooting

### Dependabot not creating PRs

**Check:**

1. ✅ It's past Monday morning (first scan time)
2. ✅ Repository has Dependabot enabled: Settings → Security → Dependabot
3. ✅ JFrog OIDC (or Dependabot registry secrets) is configured and valid for this repo/org

### View Dependabot activity

Go to: **Repository → Insights → Dependency graph → Dependabot**

## Configuration Files

- `.github/dependabot.yml` - Dependabot configuration, including `registries.jfrog-npm` and per-directory npm updates

---

**Questions?** Contact the platform team.
