# Deployment Adapter System

## Overview

The deployment adapter system provides a flexible, environment-aware approach to site creation and deployment. It automatically detects the environment and uses the appropriate infrastructure strategy.

## Architecture

### Core Components

1. **DeploymentAdapter Interface** (`src/lib/deployment/types.ts`)
   - Defines the contract for all deployment strategies
   - Methods: `deploy()`, `getStatus()`, `destroy()`, `getMetadata()`

2. **BaseDeploymentAdapter** (`src/lib/deployment/base-adapter.ts`)
   - Common functionality for all adapters
   - URL generation based on environment
   - Structured logging with environment context

3. **Deployment Adapters**
   - **ProductionDeploymentAdapter**: Nomad + SQS + Ceph (enterprise infrastructure)
   - **DockerDeploymentAdapter**: Docker containers via agents service (development)

4. **AdapterFactory** (`src/lib/deployment/adapter-factory.ts`)
   - Environment detection and adapter selection
   - Singleton pattern for consistent adapter usage
   - Configuration management

## Environment Detection

The system automatically detects the deployment mode:

### Production Mode

Detected when **any** of these conditions are true:

- `NODE_ENV=production`
- `MYSQL_DB_USERNAME` is set (MySQL indicates production)
- `AWS_REGION_NOMAD` is set (AWS/Nomad indicates production)
- `PRODUCTION_DOMAIN` is set

**Infrastructure**: Nomad + SQS + Ceph storage + Production URLs

### Docker Development Mode

Detected when:

- `NODE_ENV=development`

**Infrastructure**: Docker containers via agents service + Local URLs

### Explicit Override

- Set `DEPLOYMENT_MODE=docker|production` to force a specific mode

## Site Creation Flow

### Before (Broken)

```
User clicks "Start Building"
│
└── Always uses production infrastructure
    ├── Creates site with Ceph storage
    ├── Generates Nomad job spec
    ├── Submits to AWS SQS queue
    ├── Sets production domain URLs
    └── Hangs in development (no local infrastructure)
```

### After (Flexible)

```
User clicks "Start Building"
│
├── Production Mode
│   ├── Creates site with Ceph storage
│   ├── Uses ProductionDeploymentAdapter
│   ├── Generates Nomad job + submits to SQS
│   └── Sets production URLs
│
└── Development Mode
    ├── Creates simplified site record
    ├── Uses DockerDeploymentAdapter
    ├── Calls agents service for Docker container management
    └── Sets localhost URLs
```

## Key Benefits

1. **Environment Awareness**: Automatically adapts to dev/staging/production
2. **Clean Separation**: Production complexity is isolated from development
3. **Extensible**: Easy to add new deployment strategies (Docker, Kubernetes, etc.)
4. **Testable**: Each adapter can be tested independently
5. **Consistent Interface**: All deployment strategies use the same API

## Configuration

### Environment Variables

```bash
# Automatic detection (recommended)
NODE_ENV=development          # or production

# Manual override
DEPLOYMENT_MODE=docker       # force specific mode

# Agents service (development)
AGENTS_SERVICE_URL=http://localhost:4000

# Production infrastructure
MYSQL_DB_USERNAME=...        # triggers production mode
AWS_REGION_NOMAD=...         # triggers production mode
PRODUCTION_DOMAIN=...        # custom production domain
```

### Development Setup

For local development, ensure:

1. Agents service is running on port 4000: `cd agents && pnpm run dev`
2. Main app is running on port 3000: `cd app && pnpm run dev`
3. Environment variables are set correctly

## Usage

### In API Routes

```typescript
import { getDeploymentAdapter } from "@/lib/deployment";

const adapter = getDeploymentAdapter();
const result = await adapter.deploy({
  siteId: "abc123",
  accountId: "user123",
  prompt: "Build me a website",
});
```

### Environment Info

```typescript
import { getDeploymentEnvironmentInfo } from "@/lib/deployment";

const info = getDeploymentEnvironmentInfo();
console.log("Current mode:", info.mode); // 'docker' or 'production'
```

## File Structure

```
src/lib/deployment/
├── types.ts              # Interfaces and types
├── base-adapter.ts       # Common functionality
├── production-adapter.ts # Nomad + SQS + Ceph
├── docker-adapter.ts     # Docker containers via agents service
├── adapter-factory.ts    # Environment detection
└── index.ts             # Exports
```

## Migration Notes

### Updated Files

- `src/app/api/sites/route.ts` - Uses adapter pattern instead of hardcoded production logic
- `src/lib/database/site-service.ts` - Added `createSiteSimple()` for development mode

### Removed Dependencies

- Site creation no longer always requires Ceph storage assignment
- Site creation no longer always generates Nomad job specs
- Site creation no longer always submits to AWS SQS

### Backward Compatibility

- Production deployments work exactly as before
- All existing production sites continue to function
- Database schema unchanged

## Testing

The system is designed to work in your current development environment:

1. **Mock Authentication**: Works with the existing mock login system
2. **Database**: Uses the SQLite database with proper schema initialization
3. **Agents Service**: Calls `localhost:4000` which should be running your agents service
4. **Local URLs**: Generates `localhost` URLs appropriate for development

Try creating a site now - it should call the agents service directly instead of hanging on production infrastructure!
