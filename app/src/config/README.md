# API Configuration

This module provides centralized configuration for all API endpoints in the Airo AI Builder application.

## Features

- **Environment Variable Support**: Configure API URLs using environment variables
- **Type Safety**: TypeScript interfaces for all configuration options
- **Helper Functions**: Convenient functions to build URLs for different API types
- **Validation**: Built-in validation for configuration values
- **Development Logging**: Automatic logging of configuration in development mode

## Environment Variables

The following environment variables can be used to configure the API endpoints:

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | Base URL for the API backend | `http://localhost:4000` | `https://api.airo-builder.com` |
| `NEXT_PUBLIC_API_WS_URL` | WebSocket URL for real-time communication | `ws://localhost:4000` | `wss://api.airo-builder.com` |

## Usage

### Basic Usage

```typescript
import { apiConfig, buildApiUrl, buildWsUrl } from '@/config/api'

// Get the current configuration
console.log('API Base URL:', apiConfig.baseUrl)
console.log('WebSocket URL:', apiConfig.wsUrl)

// Build API URLs
const appsUrl = buildApiUrl('apps')  // http://localhost:4000/apps
const appUrl = buildApiUrl(`apps/${appId}`)  // http://localhost:4000/apps/123

// Build WebSocket URLs
const wsUrl = buildWsUrl(`ws/${agentId}`)  // ws://localhost:4000/ws/agent-123
```

### In Services

```typescript
import { buildApiUrl } from '@/config/api'
import { appFetch } from '@/lib/gasket-config'

export class MyService {
  async getApps() {
    const response = await appFetch(buildApiUrl('apps'))
    return response.json()
  }
}
```

### Validation

```typescript
import { validateApiConfig } from '@/config/api'

const validation = validateApiConfig()
if (!validation.isValid) {
  console.error('API Configuration errors:', validation.errors)
}
```

## Helper Functions

### `buildApiUrl(endpoint: string): string`

Builds a complete API URL by combining the base URL with the provided endpoint.

- Automatically removes trailing slashes from base URL
- Automatically removes leading slashes from endpoint
- Returns a properly formatted URL

### `buildWsUrl(endpoint: string): string`

Builds a complete WebSocket URL by combining the WebSocket base URL with the provided endpoint.

### `buildAgentUrl(endpoint: string): string`

Builds a complete agent API URL (currently uses the same base URL as regular API).

### `validateApiConfig(): { isValid: boolean; errors: string[] }`

Validates the current API configuration and returns any errors found.

## Configuration in Different Environments

### Development

Create a `.env.local` file in the app directory:

```bash
NEXT_PUBLIC_API_BASE_URL=https://local.gasket.dev-godaddy.com:4000
NEXT_PUBLIC_API_WS_URL=wss://local.gasket.dev-godaddy.com:4000
```

### Staging

```bash
NEXT_PUBLIC_API_BASE_URL=https://api-staging.airo-builder.com
NEXT_PUBLIC_API_WS_URL=wss://api-staging.airo-builder.com
```

### Production

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.airo-builder.com
NEXT_PUBLIC_API_WS_URL=wss://api.airo-builder.com
```

## Migration from Hardcoded URLs

This configuration system replaces all hardcoded `localhost:4000` URLs throughout the application. The migration includes:

1. **AppService**: All API endpoints now use `buildApiUrl()`
2. **MessageService**: WebSocket connections use `buildWsUrl()`
3. **Components**: All fetch calls use the configuration system
4. **Error Messages**: Updated to remove hardcoded references

## Benefits

- **Environment Flexibility**: Easy deployment to different environments
- **Security**: No hardcoded URLs in the codebase
- **Maintainability**: Single place to change all API endpoints
- **Type Safety**: TypeScript support for all configuration
- **Validation**: Automatic validation of configuration values
- **Development Experience**: Clear logging and error reporting
