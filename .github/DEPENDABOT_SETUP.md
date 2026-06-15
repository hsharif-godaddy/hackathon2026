# Dependabot Configuration

## Overview

This repository uses **Dependabot** to automatically check for dependency updates across npm, Go, Rust, and GitHub Actions ecosystems. The root **npm** stream is configured to use the **GoDaddy JFrog virtual npm registry** (`node-virt`) as the **base** registry (`replaces-base: true` in `.github/dependabot.yml`), so resolution goes through Artifactory — not directly to `registry.npmjs.org`. The separate `app-templates/v8` npm stream intentionally does **not** use JFrog (see Limitations).

Public packages are still available when the virtual repository proxies the public npm registry (typical setup). Internal or private packages are resolvable **only if** they are exposed through that virtual repo **and** Dependabot can authenticate.

## Configuration

**Registry:** `jfrog-npm` in `dependabot.yml` points at `https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt` with `jfrog-oidc-provider-name: github`.

**Authentication:** Dependabot must have **authenticated access** to that registry (for example **JFrog OIDC for GitHub** configured at the organization or repository level). Without valid auth, updates fail with `401` / `private_source_authentication_failure`.

**Security updates:** GitHub-triggered security update jobs also need registry credentials where the updater uses the same registry; align org/repo Dependabot secrets and OIDC with platform guidance.

## What Dependabot Will Do

Dependabot will:

- ✅ **Scan daily** — every stream runs on `interval: daily` with a 7-day `cooldown.default-days` to suppress churn from rapid-fire releases
- ✅ **Ignore semver-major bumps** — every stream sets `update-types: version-update:semver-major` on `dependency-name: '*'`. Major upgrades are handled manually. **Caveat:** this rule applies only to scheduled *version-update* PRs. Dependabot **security-update** PRs (CVE-driven) bypass `update-types:` rules and will cross majors when a CVE fix only lives in a newer major. To block a specific package from majoring during a security update, add a per-package ceiling pin in the same `ignore:` block, e.g. `versions: ['>= 4.0.0']` — security updates *do* honor `versions:` ranges. The existing AI SDK pins (`ai >= 6.0.0`, `@ai-sdk/* >= 3.0.0`) use the inverse pattern as floors
- ✅ **Pin AI SDK floors** (root npm only) — `ai >= 6.0.0` and `@ai-sdk/{openai,anthropic,google,provider} >= 3.0.0` to block downgrade PRs after the v5 → v6 majors landed (old major lines still receive patches and would otherwise look like upgrades)
- ✅ **Cover every workspace package via the root entry** — a single root `/` npm entry walks the pnpm workspace, so all members (`agents`, `app`, `packages/*`, `debug-console`, `tests`, etc.) are scanned together
- ✅ **Track `app-templates/v8` separately** — that template is excluded from the pnpm workspace and has its own npm stream (no JFrog registry)
- ✅ **Track Go modules** at `/dev-supervisor`, `/go-agent`, `/local-control-plane`, `/budget-service`, and `/packages/go-auth`
- ✅ **Track Rust crates** at `/dev-supervisor/rust` (cargo)
- ✅ **Track GitHub Actions** at `/` (workflow `uses:` pins)
- ✅ **Resolve npm dependencies via Artifactory** for the root stream — public (proxied) and internal packages, subject to virtual repo composition and auth
- ✅ **Create grouped PRs** — related updates bundled together (see below)

### Update Groups

To reduce PR noise, updates are grouped by package patterns. Groups defined on the **root npm** stream:

- **aws-sdk** — `@aws-sdk/*`, `@aws-crypto/*`, `@smithy/*`
- **react** — `react`, `react-dom`, `@types/react`, `@types/react-dom`
- **nextjs** — `next`, `@next/*`
- **testing** — `jest`, `@jest/*`, `vitest`, `@vitest/*`, `@playwright/*`, `@testing-library/*`
- **code-quality** — `eslint`, `@typescript-eslint/*`, `prettier`, `typescript`
- **ai-sdk** — `ai`, `@ai-sdk/*`

The **`app-templates/v8`** stream repeats a subset: `code-quality`, `react`, `testing`. The Go, Rust, and GitHub Actions streams are not grouped.

## Limitations

- **Virtual repo scope** — Only packages available through the configured JFrog virtual repository can be resolved by the root npm stream.
- **Auth** — Misconfigured or missing OIDC/secrets produces `401` or similar; fix registry access, not `dependabot.yml` alone.
- **pnpm workspace** — Root `pnpm update -r` style resolution can still touch every workspace member; private deps in any member require successful Artifactory auth for the whole resolve graph.
- **`app-templates/v8` is JFrog-free by design** — that template only uses public npm packages. Adding the `jfrog-npm` registry there causes Artifactory-resolved URLs to leak into its lockfile, which breaks CI on runners without JFrog auth.

## Troubleshooting

### Dependabot not creating PRs

**Check:**

1. ✅ Repository has Dependabot enabled: Settings → Security → Dependabot
2. ✅ JFrog OIDC (or Dependabot registry secrets) is configured and valid for this repo/org
3. ✅ The dependency isn't masked by an `ignore` rule (all majors are ignored for *version* updates; AI SDK floors block sub-major downgrades; remember security PRs bypass `update-types:` rules)
4. ✅ The 7-day `cooldown` window has elapsed since the upstream release

### View Dependabot activity

Go to: **Repository → Insights → Dependency graph → Dependabot**

## Configuration Files

- `.github/dependabot.yml` — Dependabot configuration: `registries.jfrog-npm`, the root and `app-templates/v8` npm streams, five gomod streams, one cargo stream, and the GitHub Actions stream

---

**Questions?** Contact the platform team.
