---
title: Stale Docker image causes auth_idp cookie pollution in local dev
date: 2026-04-21
category: developer-experience
module: dev-supervisor
problem_type: developer_experience
component: authentication
severity: high
applies_when:
  - local dev auth fails with "404 from SSO key API"
  - gd-auth rejects valid SSO tokens
  - multiple auth_idp cookies appear in browser DevTools
  - auth modal keeps appearing after successful SSO login
  - Docker preview containers haven't been rebuilt recently
tags:
  - auth
  - cookies
  - docker
  - dev-supervisor
  - local-dev
  - gd-auth
---

# Stale Docker image causes auth_idp cookie pollution in local dev

## Context

The preview container's dev-supervisor sets an auth cookie when the builder page health-checks the preview iframe. In commit `7e4b03804` (2026-04-15), this cookie was renamed from `auth_idp` to `preview_auth` to avoid colliding with GoDaddy SSO's `auth_idp` cookie. When Docker images aren't rebuilt after pulling that change, the stale binary keeps writing `auth_idp` cookies containing agent JWTs.

## Symptoms

- `gd-auth.authenticate.error Got 404 response from SSO key API` on every auth request
- "Sign In Required" modal reappears immediately after successful SSO login
- `/api/auth/validate` returns 401 despite valid SSO session
- Browser has 3+ `auth_idp` cookies (visible via DevTools > Application > Cookies)

## Root Cause

1. User navigates to develop page
2. `useServerPollingStore._checkUrlHealth()` sends the agent JWT to the preview container at `https://local.gasket.dev-godaddy.com:PORT/` via Authorization header
3. Stale dev-supervisor validates the JWT and sets `Set-Cookie: auth_idp=<agent-jwt>` (should be `preview_auth`)
4. In local dev, preview runs on `local.gasket.dev-godaddy.com:500X`, same domain as the builder at `:8443`. Cookies are domain-scoped, not port-scoped.
5. Browser now has multiple `auth_idp` cookies. gd-auth picks the agent JWT first, fails to find its kid on SSO.

## Fix

Rebuild Docker images to pick up the renamed cookie:

```bash
cd /path/to/airo-app-builder

docker buildx build -t aab-template-v8:latest --load \
  --build-arg "HOST_UID=$(id -u)" --build-arg "HOST_GID=$(id -g)" \
  --build-context "dev-supervisor=dev-supervisor" \
  --build-context "container-scripts=container-scripts" \
  -f app-templates/v8/Dockerfile.dev app-templates/v8

docker buildx build -t aab-publish:latest --load \
  --build-arg "HOST_UID=$(id -u)" --build-arg "HOST_GID=$(id -g)" \
  --build-context "dev-supervisor=dev-supervisor" \
  --build-context "container-scripts=container-scripts" \
  -f app-publish/Dockerfile.dev app-publish
```

Then restart the TUI (`pnpm dev`). Old containers will be recreated from the new images.

If stale cookies persist in the browser, clear cookies for `local.gasket.dev-godaddy.com` in DevTools.

## Why This Matters

The stale image silently breaks all authenticated BFF requests in local dev. The symptom (SSO key API 404) is misleading because it points at SSO configuration, not Docker freshness. Debugging this takes hours without knowing the cookie collision exists.

## When to Apply

- After pulling changes that modify dev-supervisor auth behavior
- When local dev auth breaks after a git pull
- When multiple `auth_idp` cookies appear in the browser
- As a general troubleshooting step: rebuild Docker images after pulling

## Related

- Commit `7e4b03804`: renamed cookie from `auth_idp` to `preview_auth`
- `dev-supervisor/internal/auth/middleware.go`: cookie setting logic
- `app/src/stores/useServerPollingStore.ts`: preview health check that triggers cookie creation
- `local-control-plane/internal/docker/manager.go`: image build logic
