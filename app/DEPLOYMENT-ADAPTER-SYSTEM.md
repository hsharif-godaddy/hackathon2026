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
   - **DockerDeploymentAdapter**: Docker containers via agents service (local development)

4. **Adapter Singleton** (`src/lib/deployment/adapter-factory.ts`)
   - Exports singleton `deploymentAdapter` instance
   - Always uses DockerDeploymentAdapter
   - Production deployments use mhp-core Nomad templates (external)

## Deployment Architecture

### Local Development

Uses Docker containers via the agents service:

- Docker containers orchestrated by `DockerDeploymentAdapter`
- Local URLs (localhost:3000, etc.)
- Simplified infrastructure for development

### Test/Dev/Production Environments

Production deployments are managed externally:

- Nomad job templates defined in [mhp-core](https://github.com/gdcorp-partners/mhp-core)
- Infrastructure provisioning handled outside the application
- The application uses the same `DockerDeploymentAdapter` interface

## Site Creation Flow

### Deployment Flow

```
User clicks "Start Building"
│
└── Uses DockerDeploymentAdapter
    ├── Creates site record in database
    ├── Calls agents service for container orchestration
    ├── Docker containers managed locally
    └── Sets localhost URLs

Note: Production environments use mhp-core Nomad templates
```

## Key Benefits

1. **Simplicity**: Single deployment adapter for all environments
2. **Clean Separation**: Production infrastructure managed externally via mhp-core
3. **Testable**: Adapter can be mocked for testing
4. **Consistent Interface**: Same deployment API regardless of environment

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
import { deploymentAdapter } from "@/lib/deployment";

const result = await deploymentAdapter.deploy({
  siteId: "abc123",
  accountId: "user123",
  prompt: "Build me a website",
});
```

### Environment Info

```typescript
import { getDeploymentEnvironmentInfo } from "@/lib/deployment";

const info = getDeploymentEnvironmentInfo();
console.log("Current mode:", info.mode); // always 'docker'
```

## File Structure

```
src/lib/deployment/
├── types.ts           # Interfaces and types
├── base-adapter.ts    # Common functionality
├── docker-adapter.ts  # Docker containers via agents service
├── adapter-factory.ts # Singleton instance export
└── index.ts          # Exports
```

## Migration Notes

### Removed Components

- Old internal Nomad job template generator (`job-template.ts`)
- SQS-based job submission service (`sqs-nomad.ts`)
- Production deployment adapter (`production-adapter.ts`)
- Factory pattern replaced with singleton export

### Production Deployment

Production environments now use Nomad job templates from [mhp-core](https://github.com/gdcorp-partners/mhp-core) repository. The deployment adapter interface remains consistent, but infrastructure provisioning is handled externally.

## Testing

The system is designed to work in your current development environment:

1. **Mock Authentication**: Works with the existing mock login system
2. **Database**: Uses the SQLite database with proper schema initialization
3. **Agents Service**: Calls `localhost:4000` which should be running your agents service
4. **Local URLs**: Generates `localhost` URLs appropriate for development

Try creating a site now - it should call the agents service directly instead of hanging on production infrastructure!
