# Getting Started - Airo Builder

Complete setup guide to run the AI builder locally.

## Prerequisites

- Access to AWS Account: `GD-AWS-USA-GD-AiroBuilde-Dev-Private`
- Node.js 22+ (via fnm, mise, asdf, or nvm)
- Go (for local control plane and dev-runner)
- Docker (for MySQL container)
- AI Provider API Key (GoCode recommended)
- For running the test and prod environment locally: `Dev-Airo-Builders` AD group access

## Request Access

You first need to request access to the `GD-AWS-USA-GD-AiroBuilde-Dev-Private` AWS Account, as the app has to retrieve secrets in order to run. Please request access in #airo-ai-builder-dev. After verifying access via Okta, you can then proceed with the setup.

## 🛠️ Setup & Run (Recommended)

The fastest way to get started is a single command:

```bash
pnpm run dev
```

This launches the **Dev Runner** TUI, which runs preflight checks on startup and offers to auto-fix any issues inline:

1. **Tools** — Verifies Node.js, pnpm, Go, make, Docker, AWS CLI v2, mkcert, Artifactory auth
2. **Environment** — Checks /etc/hosts, AWS SSO session, .env files, JWT keys, TLS certificates, S2S certs, Commerce OAuth, Getty proxy, KnowB, Design RAG
3. **Services** — Ensures required ports are free and MySQL is running

If anything fails or warns, you'll see a dashboard with a fix selector — choose what to fix and the TUI handles it (generates .env files, runs `aws sso login`, creates certs, starts containers, etc.). On subsequent runs, all checks pass in ~2 seconds and auto-advance to launching services.

See [dev-runner/README.md](dev-runner/README.md) for keybindings and details.

### Fallback: setup.sh

If you prefer a standalone setup step before running, or need to reconfigure individual components:

```bash
./setup.sh
```

This runs the legacy Node.js setup utility which guides you through configuration. You can also use it for selective reconfiguration:

```bash
pnpm --filter airo-setup start
```

### Reconfiguring Environment Files

If you need to change your AI provider, authentication settings, or regenerate environment files:

**Via Dev Runner (recommended):** Delete the `.env` file you want to regenerate and run `pnpm run dev` — the preflight checks will detect it's missing and offer to recreate it.

**Via setup.sh:** Run `./setup.sh` or `pnpm --filter airo-setup start` and select "Configure App Environment (.env)".

Environment files generated:

- `app/.env` - Base configuration
- `app/.env.local.dev` - Dev environment (dev-godaddy.com SSO)
- `app/.env.local.test` - Test environment (test-godaddy.com SSO)
- `app/.env.local.prod` - Prod environment (godaddy.com SSO)

## 📋 Manual Setup (Alternative)

If you prefer manual configuration:

### 1. Install Dependencies

```bash
# Using pnpm workspace (recommended)
pnpm install

# This installs dependencies for all packages at once
```

### 2. Configure Environment

Create `agents/.env`:

```bash
# AI Provider (choose one)
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4

# Getty Images (optional)
GETTY_API_URL=https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net/img/search
GETTY_TOKEN=your_token_here
IMAGE_SEARCH_DRIVER=getty

# App Configuration
APP_TEMPLATE_DIR=app-templates/v8
SHOW_USAGE_COST=true

# MySQL Configuration (for app databases)
MYSQL_ROOT_HOST=localhost
MYSQL_ROOT_PORT=3306
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASS=
```

Create `app/.env`:

```bash
NODE_ENV=development
PORT=3000
HTTPS_PORT=8443

# Authentication (JWT with SSO - recommended)
AUTH_TYPE=jwt
SSO_LOGIN_URL=https://sso.dev-godaddy.com/login
SSO_LOGOUT_URL=https://sso.dev-godaddy.com/logout
LOGIN_REDIRECT_URL=https://local.gasket.dev-godaddy.com:8443/
LOGOUT_REDIRECT_URL=https://local.gasket.dev-godaddy.com:8443/

# Legacy Authentication (use AUTH_TYPE instead)
NEXT_PUBLIC_USE_MOCK_LOGIN=false
```

### 3. Hosts File (Required)

Add this line to `/etc/hosts`:

```
127.0.0.1  local.gasket.dev-godaddy.com
```

On macOS/Linux: `sudo nano /etc/hosts`
On Windows: `notepad C:\Windows\System32\drivers\etc\hosts` (as Admin)

### 4. Start Services

```bash
pnpm run dev
```

This is the same command from the recommended setup above — preflight checks will handle MySQL, AWS SSO, and everything else automatically.

**Alternative: Start services individually in separate terminals:**

```bash
# Terminal 1 - Agents Backend (port 4000)
cd agents && pnpm run dev

# Terminal 2 - App / BFF (HTTPS port 8443)
cd app && pnpm run dev

# Terminal 3 - Local Control Plane (port 4100)
pnpm run dev:control-plane
```

## What's Running

| Service                 | Port | Description                                      |
| ----------------------- | ---- | ------------------------------------------------ |
| **Agents**              | 4000 | Express API, AI agents, SQLite, WebSocket        |
| **App**                 | 8443 | Next.js builder UI + BFF (Gasket HTTPS proxy)    |
| **Local Control Plane** | 4100 | Local mgmt-airo API (Go, SQLite, Docker Compose) |
| **MySQL**               | 3306 | Per-app databases (Docker container)             |

## Dev Logs

All services automatically log to files during local development:

| Service             | Log file                      |
| ------------------- | ----------------------------- |
| Agents              | `agents/dev.log`              |
| App                 | `app/dev.log`                 |
| Local Control Plane | `local-control-plane/dev.log` |

Logs are truncated on each restart. ANSI codes are stripped for readability. Use these logs to troubleshoot issues or share with the team.

## Environment Configuration

### Running Test or Prod Environments Locally

**Available run commands:**

```bash
pnpm run dev              # Dev environment (local.dev) — TUI with all services
pnpm run dev:legacy       # Dev environment (local.dev) — agents + app only (no TUI)
pnpm run local:test       # Test environment (local.test) — uses real control plane
pnpm run local:prod       # Prod environment (local.prod) — uses real control plane
```

#### Environment Configuration

**✨ Environment files are auto-generated by Dev Runner preflight or `./setup.sh`!**

Environment-specific configuration files are created automatically:

- `app/.env.local.dev` - Dev environment (dev-godaddy.com SSO)
- `app/.env.local.test` - Test environment (test-godaddy.com SSO)
- `app/.env.local.prod` - Prod environment (godaddy.com SSO)

These files are automatically loaded based on the `GASKET_ENV` via the `scripts/load-env.js` wrapper:

- `pnpm run dev` → loads `.env.local.dev`
- `pnpm run local:test` → loads `.env.local.test`
- `pnpm run local:prod` → loads `.env.local.prod`

**Manual configuration (if needed):**

If you need to customize or didn't run `./setup.sh`, you can manually create these files:

**`app/.env.local.dev` (dev-godaddy.com):**

```bash
SSO_LOGIN_URL=https://sso.dev-godaddy.com/login
SSO_LOGOUT_URL=https://sso.dev-godaddy.com/logout
LOGIN_REDIRECT_URL=https://local.gasket.dev-godaddy.com:8443/
AWS_REGION=us-west-2
```

**`app/.env.local.test` (test-godaddy.com):**

```bash
SSO_LOGIN_URL=https://sso.test-godaddy.com/login
SSO_LOGOUT_URL=https://sso.test-godaddy.com/logout
LOGIN_REDIRECT_URL=https://airo-builder.test-godaddy.com:8443/
AWS_REGION=us-west-2

# Management API Base URL (real control plane)
MGMT_AIRO_BASE_URL=https://mgmt.nstk.net
```

**`app/.env.local.prod` (godaddy.com):**

```bash
SSO_LOGIN_URL=https://sso.godaddy.com/login
SSO_LOGOUT_URL=https://sso.godaddy.com/logout
LOGIN_REDIRECT_URL=https://airo-builder.godaddy.com:8443/
AWS_REGION=us-west-2

# Management API Base URL (real control plane)
MGMT_AIRO_BASE_URL=https://mgmt.woosaas.godaddy.com
```

#### Access Requirements

**Dev Environment (`pnpm run dev`):**

- Uses `local.gasket.dev-godaddy.com` domain
- Designed for ease of access - **no special AD group required**
- Allows all users to get up and running quickly without additional permissions

**Test & Prod Environments (`pnpm run local:test`, `pnpm run local:prod`):**

- Use `airo-builder.test-godaddy.com` and `airo-builder.godaddy.com` domains
- **Requires membership in the `Dev-Airo-Builders` AD group**

#### Important Notes

**Grants and subscriptions require `local:test`:**

The local control plane (`pnpm run dev`) returns hardcoded stub data for grants (from [`stubs.go`](local-control-plane/internal/api/stubs.go)) and subscriptions (from [`subscriptions.go`](local-control-plane/internal/api/subscriptions.go)). The grant stub returns a single mock grant (`local-grant-001`) with 999999 credits, which is enough to unblock LLM calls but does not reflect real subscription state, expiration, or multi-grant behavior.

The grant system is always-on (the `app-builder-grants` feature flag OFF branches were removed in PR #2342). This means the frontend always fetches grants via [`app/src/hooks/useCreditGrants.ts`](app/src/hooks/useCreditGrants.ts), sends them to the agent via [`app/src/hooks/websocket/useGrantContext.ts`](app/src/hooks/websocket/useGrantContext.ts), and uses them for budget enforcement in [`app/src/hooks/useUsage.ts`](app/src/hooks/useUsage.ts). With stub data, the usage gauge, budget exceeded banner, and paywall flows may not behave correctly.

**Use `pnpm run local:test` for any work involving grants, subscriptions, or billing.** This connects to the real control plane (mgmt-airo) which returns actual grant and subscription data for your test account.

**Control Plane Architecture:**

- **Dev** (`pnpm run dev`): Uses the local control plane at `http://localhost:4100` with local agents at `http://localhost:4000`. Grant data from [`stubs.go`](local-control-plane/internal/api/stubs.go), subscription data from [`subscriptions.go`](local-control-plane/internal/api/subscriptions.go). The BFF routes to local-control-plane via [`V2ControlPlaneAdapter`](app/src/lib/control-plane/v2-control-plane-adapter.ts) using `MGMT_AIRO_BASE_URL=http://localhost:4100`.
- **Test/Prod** (`pnpm run local:test`, `pnpm run local:prod`): Uses the real control plane (mgmt-airo) with remote agents. Grants and subscriptions are real.

**Cross-Environment Apps:**

- Generated apps work across **all environments** - apps are configured with CORS that accepts requests from all environment domains.
- You only need to update `.env.local` to change which SSO system you authenticate with.
- **No need to regenerate apps when switching environments** - the same app works in dev, test, and prod!

**Generated App Certificate Warnings (Dev):**

Generated apps run on `https://localhost:5XXX` with certificates signed by a local development CA.

**Recommended Solution: Trust the Development CA** (is done during the full setup or can be done using the command below for one-time setup):

```bash
# Run this script to trust the CA certificate
./scripts/trust-dev-ca.sh
```

This adds the CA to your system trust store, eliminating certificate warnings for **ALL** generated apps.

**Note:** The CA certificate is automatically generated when you create your first app and is stored in `.dev-ca/` (gitignored). Test/prod environments use trusted certificates and don't have this issue.

**General:**

- The `.env.local` file overrides `.env` and is gitignored, making it perfect for environment-specific local configuration.

## Access

**AI Builder (Main App):**

- **Dev**: https://local.gasket.dev-godaddy.com:8443 (with `GASKET_ENV=local.dev`)
- **Test**: https://airo-builder.test-godaddy.com:443 (with `GASKET_ENV=local.test`)
- **Prod**: https://airo-builder.godaddy.com:443 (with `GASKET_ENV=local.prod`)

**Agents API:**

- **Local Agents** (dev): http://localhost:4000
- **Health Check**: http://localhost:4000/health
- **Note**: Test/prod use remote agents via the real control plane

**Local Control Plane:**

- **API**: http://localhost:4100

## Next Steps

1. Visit https://local.gasket.dev-godaddy.com:8443 to start building
2. Explore the agent chat interface
3. Try generating a simple app

## 🔧 Setup Utilities

### Dev Runner Preflight (Recommended)

`pnpm run dev` handles most setup tasks automatically. If a check fails, select it in the fix selector and the TUI will resolve it. This covers: .env generation, AWS SSO login, JWT keys, TLS certs, S2S certs, Getty proxy tokens, MySQL, hosts file, and more.

### Legacy Setup Utility

For selective reconfiguration or if you prefer a standalone setup:

```bash
./setup.sh                        # Full guided setup
pnpm --filter airo-setup start    # Selective configuration menu
```

### Getty Images Setup

If Getty Images isn't working, either:

- Run `pnpm run dev` and select the Getty fix when it appears in preflight
- Or: `pnpm --filter airo-setup start` → "Configure Getty Images Proxy"

## Troubleshooting

### First steps

Before reporting issues, always try a clean install and rebuild:

```bash
pnpm install --force && pnpm build --force
```

This resolves most dependency and build cache issues.

### direnv blocked

**Issue**: `direnv: error .envrc is blocked`
**Solution**: `direnv allow`

### AWS SSO expired

**Issue**: Switchboard authentication errors or "Unable to obtain token from SSO"
**Solution**: Run `pnpm run dev` — preflight checks will detect the expired session and offer to run `aws sso login` for you. Or manually: `aws sso login --profile airobuild-dev-private-sso`

### Configuration Issues

**Recommended**: Run `pnpm run dev` — preflight checks will detect and offer to fix most configuration problems automatically. For manual diagnosis:

```bash
pnpm --filter airo-setup start
# Choose "Selective Configuration" → "Check Current Configuration Status"
```

### "Starting Development Server" gets stuck or fails

**Issue**: The development server fails to start for new apps
**Cause**: App template dependencies are not installed
**Solution**: Install all dependencies using workspace:

```bash
pnpm install
```

### Template directory errors

**Issue**: "Template directory not found" warnings
**Cause**: The `APP_TEMPLATE_DIR` environment variable points to wrong location
**Solution**: Use the setup utility or ensure your `agents/.env` has:

```bash
APP_TEMPLATE_DIR=app-templates/v8
```

### Getty Images not working

**Issue**: Getty Images search returns errors or no results
**Cause**: Missing or expired AWS credentials, incorrect token
**Solution**: Use the setup utility:

```bash
pnpm --filter airo-setup start
# Choose "Selective Configuration" → "Configure Getty Images Proxy"
```

### Generated App Certificate Error (NET::ERR_CERT_AUTHORITY_INVALID)

**Issue**: Generated app preview shows certificate error or blank iframe
**Cause**: Browser doesn't trust the local development CA that signs certificates for `https://localhost:5XXX`

**Recommended Solution: Trust the Development CA** (one-time fix for all apps or is run as part of the setup script):

```bash
# From project root, run:
./scripts/trust-dev-ca.sh
```

This script will:

- Locate your development CA certificate (`.dev-ca/ca-cert.pem`)
- Add it to your system trust store (macOS keychain or Linux ca-certificates)
- Provide browser-specific instructions if needed

**After trusting the CA:**

- ✅ No more certificate warnings for ANY generated app
- ✅ Apps load directly in iframes without manual acceptance
- ✅ One-time setup that works for all ports

**Why this happens**: Generated apps use certificates signed by a local development CA. Browsers block untrusted certificates in iframes until you either trust the CA or manually accept each certificate.

**Chrome not loading the CA from macOS keychain:**

If the preview still won't load after running `trust-dev-ca.sh`, Chrome may not be reading the macOS certificate store. Manually import the CA into Chrome:

1. Go to `chrome://certificate-manager/localcerts/usercerts`
2. Click **Import** on Trust Certificates
3. Select `airo-app-builder/.dev-ca/ca-cert.pem` (press `Cmd+Shift+.` in the file picker to show hidden directories)

**Note**:

- The CA is automatically generated when you create your first app
- This only affects local dev. Test/prod environments use trusted certificates and don't have this issue.

### Database connection errors

**Issue**: MySQL connection failures
**Cause**: MySQL container not running or wrong credentials
**Solution**: Use the setup utility or manually start container:

```bash
# Via setup utility (from project root)
pnpm --filter airo-setup start
# Choose "Start MySQL Container"

# Manual alternative
docker compose up app-mysql -d
```

### Port conflicts

**Issue**: Development servers fail to start due to port conflicts
**Solution**: The system automatically assigns ports starting from 5001. Kill any conflicting processes:

```bash
lsof -ti:5001 | xargs kill -9
```

---

Need help?

- 🚀 Run `pnpm run dev` — preflight checks detect and fix most issues
- 🛠️ Legacy setup: `./setup.sh` or `pnpm --filter airo-setup start`
- 📖 Check the full [README.md](./README.md)
- 📚 Browse [documentation](./docs/)
