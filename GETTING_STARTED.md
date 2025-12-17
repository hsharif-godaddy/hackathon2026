# 🚀 Getting Started - Airo Builder

Complete setup guide to run the AI builder locally in under 5 minutes.

## Prerequisites

- Access to AWS Account: `GD-AWS-USA-GD-AiroBuilde-Dev-Private`
- direnv
- Node.js 22.16.0+
- pnpm
- Docker (for local database)
- AI Provider API Key (OpenAI, AWS Bedrock, or GoCode)
- For running the test and prod environment locally: Dev-Airo-Builders Ad group access

## Request Access

You first need to request access to the `GD-AWS-USA-GD-AiroBuilde-Dev-Private` AWS Account, as the app has to retrive secrets in order to run. Please request access in #airo-app-builder-dev. After verifying access via Okta, you can then proceed with the setup.

## 🛠️ Automated Setup (Recommended)

### Option 1: Full Setup

Run the complete setup utility:

```bash
./setup.sh
```

This will:

1. ✅ Verify Node.js 22.16.0+ and pnpm installation
2. ✅ Check Docker environment and start MySQL container
3. ✅ Configure AI provider (AWS Bedrock, GoCode, or OpenAI)
4. ✅ Set up authentication (Mock login or SSO)
5. ✅ Configure Getty Images proxy with AWS Secrets Manager
6. ✅ Generate all required `.env` files

#### Recommended Configuration Options

When prompted during setup, use these recommended settings for local development:

**AI Model Provider:**

- **Provider**: GoCode (Recommended)
- **Base URL**: `https://caas-gocode-prod.caas-prod.prod.onkatana.net`

**Authentication Configuration:**

- **Auth Type**: JWT (for SSO authentication)
- **Auth Realm**: `idp`
- **Auth Risk Level**: `low`

### Option 2: Selective Configuration

For individual component setup or reconfiguration:

```bash
# From project root (recommended)
pnpm --filter airo-setup start

# Or from setup directory
cd setup && pnpm start
```

Choose from the menu:

- 🔍 Check Docker Dependencies
- 📱 Configure App Environment (.env)
- 🤖 Configure Agents Environment (.env)
- 🖼️ Configure Getty Images Proxy
- 🗄️ Check MySQL Container Status
- 🐳 Start MySQL Container
- 🔍 Check Current Configuration Status

### Reconfiguring Environment Files

If you need to change your AI provider, authentication settings, or regenerate environment files:

1. **Run the setup wizard:**

   ```bash
   pnpm --filter airo-setup start
   ```

   or from the root:

   ```bash
    ./setup.sh
   ```

2. **Select "📱 Configure App Environment (.env)"**

3. **Follow the prompts to update:**
   - AI Model Provider (GoCode, AWS Bedrock)
   - Authentication Type (None, Mock, JWT/SSO) you must select JWT
   - AWS Profile (this is normally "default")

4. **This will regenerate:**
   - `app/.env` - Base configuration
   - `app/.env.local.dev` - Dev environment (dev-godaddy.com SSO)
   - `app/.env.local.test` - Test environment (test-godaddy.com SSO)
   - `app/.env.local.prod` - Prod environment (godaddy.com SSO)

**Note:** If the files already exist, you'll be prompted to confirm overwriting them.

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

# Database (MySQL via Docker)
DATABASE_URL=mysql://airo:airopassword@localhost:3306/airo_app?sslaccept=accept_invalid_certs

# Authentication (JWT with SSO - recommended)
AUTH_TYPE=jwt
SSO_LOGIN_URL=https://sso.dev-godaddy.com/login
SSO_LOGOUT_URL=https://sso.dev-godaddy.com/logout
LOGIN_REDIRECT_URL=https://local.gasket.dev-godaddy.com:8443/
LOGOUT_REDIRECT_URL=https://local.gasket.dev-godaddy.com:8443/

# Legacy Authentication (use AUTH_TYPE instead)
NEXT_PUBLIC_USE_MOCK_LOGIN=false
```

### 3. Start Services

**Start MySQL Container (if not using setup utility):**

```bash
docker compose up app-mysql -d
```

**Option 1 - Start both services concurrently:**

```bash
pnpm run dev
```

**Option 2 - Start services individually:**

```bash
# Terminal 1 - Agents Backend (port 4000)
pnpm run dev:agents

# Terminal 2 - Main App (HTTPS port 8443)
pnpm run dev:app
```

**Database Migrations (first time only):**

```bash
# Run from project root using workspace filter
pnpm --filter website exec prisma migrate dev
```

## Environment Configuration

### Running Test or Prod Environments Locally

**Available run commands:**

```bash
pnpm run dev              # Dev environment (local.dev) - default legacy control plane
pnpm run local:test       # Test environment (local.test) - legacy control plane
pnpm run local:prod       # Prod environment (local.prod) - legacy control plane
pnpm run local:test:v2    # Test environment (local.test) - V2 control plane
pnpm run local:prod:v2    # Prod environment (local.prod) - V2 control plane (requires prod JWT keys)
```

#### Environment Configuration

**✨ Environment files are auto-generated by `./setup.sh`!**

The setup script automatically creates environment-specific configuration files:

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
AGENTS_SERVICE_URL=http://localhost:4000
AWS_REGION=us-west-2
```

**`app/.env.local.test` (test-godaddy.com):**

```bash
SSO_LOGIN_URL=https://sso.test-godaddy.com/login
SSO_LOGOUT_URL=https://sso.test-godaddy.com/logout
LOGIN_REDIRECT_URL=https://airo-builder.test-godaddy.com:8443/
AGENTS_SERVICE_URL=http://localhost:4000
AWS_REGION=us-west-2

# Management API Base URL used for V2 control plane when USE_V2_CONTROL_PLANE is true
MGMT_AIRO_BASE_URL=https://mgmt.nstk.net

# For V2 Control Plane (optional):
# USE_V2_CONTROL_PLANE=true
```

**`app/.env.local.prod` (godaddy.com):**

```bash
SSO_LOGIN_URL=https://sso.godaddy.com/login
SSO_LOGOUT_URL=https://sso.godaddy.com/logout
LOGIN_REDIRECT_URL=https://airo-builder.godaddy.com:8443/
AGENTS_SERVICE_URL=http://localhost:4000
AWS_REGION=us-west-2

# Management API Base URL
MGMT_AIRO_BASE_URL=https://mgmt.woosaas.godaddy.com

# For V2 Control Plane (optional):
# USE_V2_CONTROL_PLANE=true

# JWT Configuration for Production V2 (required for local:prod:v2)
# See "V2 Production Environment JWT Configuration" section below
# Uncomment these lines to enable local:prod:v2:
# AWS_PROFILE=gd-aws-usa-gd-airobuilde-prod
# JWT_SECRETS_NAME=prod-airo-jwt-keys
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

**Legacy Control Plane (Non-V2 Scripts):**

- When using `pnpm run dev`, `pnpm run local:test`, or `pnpm run local:prod`, generated apps work across **all environments**.
- Apps are configured with CORS that accepts requests from all environment domains.
- You only need to update `.env.local` to change which SSO system you authenticate with.
- **No need to regenerate apps when switching environments** - the same app works in dev, test, and prod!

**Generated App Certificate Warnings (Legacy Control Plane):**

Generated apps run on `https://localhost:5XXX` with certificates signed by a local development CA.

**Recommended Solution: Trust the Development CA** (is done during the full setup or can be done using the command below for one-time setup):

```bash
# Run this script to trust the CA certificate
./scripts/trust-dev-ca.sh
```

This adds the CA to your system trust store, eliminating certificate warnings for **ALL** generated apps.

**Note:** The CA certificate is automatically generated when you create your first app and is stored in `.dev-ca/` (gitignored).

**V2 Control Plane:**

- V2 scripts (`local:test:v2`, `local:prod:v2`) set `USE_V2_CONTROL_PLANE=true` to use the new control plane infrastructure.
- **V2 scripts do NOT use local agents** - they deploy to remote V2 infrastructure with agents at `https://{appId}.agent.c4.test-airoapp.ai`.
- **Production V2 (`local:prod:v2`) requires production JWT keys** - see "V2 Production Environment JWT Configuration" section below for setup instructions.
- Use non-V2 scripts (`pnpm run dev`, `local:test`, `local:prod`) for local agent testing with `http://localhost:4000`.

#### V2 Production Environment JWT Configuration

**Important: Running `pnpm run local:prod:v2` requires production AWS access**

When running the production V2 environment locally (`local:prod:v2`), you need to configure AWS access to fetch JWT keys from AWS Secrets Manager. The app uses these keys to authenticate with remote production agent containers. Without proper AWS access, agent API calls will fail with 401 errors.

**Steps to configure production V2:**

1. **Log into the production AWS account:**

   ```bash
   # Use gd-aws-okta to log into production AWS account
   gd-aws-okta login gd-aws-usa-gd-airobuilde-prod
   ```

2. **Update your `app/.env.local.prod` file:**

   ```bash
   # Uncomment these lines in .env.local.prod:
   AWS_PROFILE=gd-aws-usa-gd-airobuilde-prod
   JWT_SECRETS_NAME=prod-airo-jwt-keys
   ```

3. **Run the production V2 environment:**
   ```bash
   pnpm run local:prod:v2
   ```

**How it works:**

- The app automatically fetches JWT keys from AWS Secrets Manager using `JWT_SECRETS_NAME`
- These are the **same keys** that production V2 agents use for validation
- Tokens signed with these keys will be accepted by production V2 agent containers (`*.agent.c24.airoapp.ai`)
- No manual key copying required - keys are fetched securely from Secrets Manager

**Why this is needed:**

- Production V2 agent containers validate JWT tokens using production-specific keys
- Your local app must sign tokens with matching keys from `prod-airo-jwt-keys`
- Without AWS access to fetch these keys, all agent API calls will return 401 Unauthorized errors

**Note:** Test environment (`local:test:v2`) uses development JWT keys by default (`dev-airo-jwt-keys`) and doesn't require special configuration.

**General:**

- The `.env.local` file overrides `.env` and is gitignored, making it perfect for environment-specific local configuration.

## Access

**AI Builder (Main App):**

- **Dev**: https://local.gasket.dev-godaddy.com:8443 (with `GASKET_ENV=local.dev`)
- **Test**: https://airo-builder.test-godaddy.com:443 (with `GASKET_ENV=local.test`)
- **Prod**: https://airo-builder.godaddy.com:443 (with `GASKET_ENV=local.prod`)

**Agents API (Legacy Control Plane only):**

- **Local Agents**: http://localhost:4000
- **Health Check**: http://localhost:4000/health
- **Note**: V2 control plane uses remote agents, not `localhost:4000`

## Test

```bash
# List available agents
curl http://localhost:4000/agents

# Chat with an agent
curl -X POST http://localhost:4000/agent/example-agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

## What's Running

- **Agents Backend** (port 4000): AI agents with chat APIs
- **Main App** (port 8443): Next.js builder interface
- **Database**: SQLite (auto-created)
- **File Storage**: Generated apps in `/tmp/apps`

## Next Steps

1. Visit http://local.gasket.dev-godaddy.com:8443 to start building
2. Explore the agent chat interface
3. Try generating a simple app
4. Check the API documentation at http://localhost:4000

## 🔧 Setup Utilities

### Reconfigure Components

Use the selective configuration tool to modify specific settings:

```bash
# From project root (recommended)
pnpm --filter airo-setup start
# Choose "Selective Configuration"

# Or from setup directory
cd setup && pnpm start
```

### Check System Status

Get an overview of your current configuration:

```bash
# From project root (recommended)
pnpm --filter airo-setup start
# Choose "Selective Configuration" → "Check Current Configuration Status"

# Or from setup directory
cd setup && pnpm start
```

### Getty Images Setup

If Getty Images isn't working, reconfigure it:

```bash
# From project root (recommended)
pnpm --filter airo-setup start
# Choose "Selective Configuration" → "Configure Getty Images Proxy"

# Or from setup directory
cd setup && pnpm start
```

This will:

- Set up AWS SSO credentials if needed
- Fetch the Getty token from AWS Secrets Manager
- Update your `agents/.env` with the correct configuration

## Troubleshooting

### Configuration Issues

**Recommended**: Use the setup utility to diagnose and fix configuration problems:

```bash
# From project root (recommended)
pnpm --filter airo-setup start
# Choose "Selective Configuration" → "Check Current Configuration Status"

# Or from setup directory
cd setup && pnpm start
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
# From project root (recommended)
pnpm --filter airo-setup start
# Choose "Selective Configuration" → "Configure Getty Images Proxy"

# Or from setup directory
cd setup && pnpm start
```

### Generated App Certificate Error (NET::ERR_CERT_AUTHORITY_INVALID)

**Issue**: Generated app preview shows certificate error or blank iframe  
**Cause**: Browser doesn't trust the local development CA that signs certificates for `https://localhost:5XXX`

**Recommended Solution: Trust the Development CA** (one-time fix for all apps or is ran as part of the setup script):

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

**Note**:

- The CA is automatically generated when you create your first app
- This only affects legacy control plane. V2 control plane apps use trusted certificates and don't have this issue.

### Database connection errors

**Issue**: MySQL connection failures  
**Cause**: MySQL container not running or wrong credentials  
**Solution**: Use the setup utility or manually start container:

```bash
# Via setup utility (from project root)
pnpm --filter airo-setup start
# Choose "Start MySQL Container"

# Or from setup directory
cd setup && pnpm start

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

- 🛠️ Use the setup utility: `./setup.sh` or `pnpm --filter airo-setup start`
- 📖 Check the full [README.md](./README.md)
- 📚 Browse [documentation](./docs/)
