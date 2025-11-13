# 🚀 Getting Started - Airo App Builder

Complete setup guide to run the AI builder locally in under 5 minutes.

## Prerequisites

- Access to AWS Account: `GD-AWS-USA-GD-AiroBuilde-Dev-Private`
- direnv
- Node.js 22.16.0+
- pnpm
- Docker (for local database)
- AI Provider API Key (OpenAI, AWS Bedrock, or GoCode)

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

# Database (MySQL via Docker)
DATABASE_URL=mysql://airo:airopassword@localhost:3306/airo_app?sslaccept=accept_invalid_certs

# AI Provider (match agents config)
AI_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here

# Authentication
NEXT_PUBLIC_USE_MOCK_LOGIN=true
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

# Terminal 2 - Main App (port 3000)
pnpm run dev:app
```

**Database Migrations (first time only):**

```bash
# Run from project root using workspace filter
pnpm --filter website dlx prisma migrate dev
```

## Access

- **AI Builder**: http://localhost:3000
- **Agents API**: http://localhost:4000
- **Health Check**: http://localhost:4000/health

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
- **Main App** (port 3000): Next.js builder interface
- **Database**: SQLite (auto-created)
- **File Storage**: Generated apps in `/tmp/apps`

## Next Steps

1. Visit http://localhost:3000 to start building
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
