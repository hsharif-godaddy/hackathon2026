# Dependabot Configuration

## Overview

This repository uses **Dependabot** to automatically check for dependency updates across the pnpm workspace. Dependabot scans all packages (root, agents, app, cdk, proxy) and creates PRs for outdated **public npm dependencies**.

## Configuration

✅ **No setup required** - Dependabot uses the public npm registry by default.

⚠️ **Internal packages excluded** - Due to security restrictions, Dependabot cannot access the internal GoDaddy Artifactory. Updates to internal packages (e.g., `@godaddy/*`, `@ux/*`) will not be detected by Dependabot.

## What Dependabot Will Do

Dependabot will:

- ✅ **Scan weekly** - Every Monday morning (staggered times in UTC)
- ✅ **Monitor all workspace packages** - root, agents, app, cdk, proxy, packages/ai-lib, packages/design-extractor, setup, debug-console
- ✅ **Check public npm packages only** - React, Next.js, AWS SDK, AI SDK, etc.
- ✅ **Create grouped PRs** - Related updates bundled together
- ✅ **Monitor GitHub Actions** - Also checks for workflow dependency updates

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

**Internal GoDaddy packages will NOT be scanned:**

- `@godaddy/*` packages
- `@ux/*` packages (UXCore)
- `@gd-safeguard/*` packages
- Any other packages hosted on internal Artifactory

**Workaround:** Check internal package updates manually or via internal tooling.

## Troubleshooting

### Dependabot not creating PRs

**Check:**

1. ✅ It's past Monday morning (first scan time)
2. ✅ Repository has Dependabot enabled: Settings → Security → Dependabot

### View Dependabot activity

Go to: **Repository → Insights → Dependency graph → Dependabot**

## Configuration Files

- `.github/dependabot.yml` - Dependabot configuration for public npm registry

---

**Questions?** Contact the platform team.
