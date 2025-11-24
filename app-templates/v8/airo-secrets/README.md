# @airo/secrets

Backend-only secrets management utilities for Airo applications.

## Overview

This package provides utilities for accessing non-system-managed secrets from `/alloc/config.json` in Airo application containers.

> ⚠️ **SERVER-ONLY**: This package uses Node.js built-in modules (`fs`) and is designed exclusively for server-side/container execution. It cannot be used in browser/frontend code.

## Installation

This package is part of the Airo application template and can be imported in backend code using Node.js package imports:

```typescript
// In any backend/server-side code
import { getSecret, listSecretNames } from "#airo/secrets";
```

> **Note**: The `#airo/secrets` import works at runtime thanks to Node.js "imports" field in `package.json`. This is different from the TypeScript path mapping `@airo/secrets` (with `@`) which only works for type checking and IDE support.

**Alternative**: You can also use relative paths if needed:

```typescript
// From src/server/api/
import { getSecret, listSecretNames } from "../../../airo-secrets/src/index.ts";
```

## API Reference

### `getSecret(secretName: string)`

Retrieves a non-system-managed secret value by name.

**Parameters:**

- `secretName` (string): Name of the secret to retrieve

**Returns:**

- `string | object | null`: Secret value if found and non-system-managed, null otherwise

**Behavior:**

- Returns `null` if secret doesn't exist
- Returns `null` if secret is system-managed
- Returns the actual value (string or parsed JSON object) for non-system-managed secrets

**Example:**

```typescript
import { getSecret } from "#airo/secrets";

const apiKey = getSecret("OPENAI_API_KEY");
if (apiKey) {
  console.log("API Key found:", apiKey);
} else {
  console.log("Secret not found or is system-managed");
}
```

### `listSecretNames()`

Lists all non-system-managed secret names.

**Returns:**

- `string[]`: Array of non-system-managed secret names (sorted alphabetically)

**Behavior:**

- Only includes secrets with `SYSTEM_MANAGED: false`
- Returns empty array if config file cannot be read
- Results are sorted alphabetically

**Example:**

```typescript
import { listSecretNames } from "#airo/secrets";

const secretNames = listSecretNames();
console.log("Available secrets:", secretNames);
// Output: ['OPENAI_API_KEY', 'STRIPE_SECRET_KEY', 'DATABASE_URL']
```

## Security Notes

- ⚠️ These utilities **ONLY** access non-system-managed secrets
- 🔒 System-managed secrets are completely inaccessible via these functions
- 📁 Secrets are read from `/alloc/config.json` in the container
- ⚙️ Intended for server-side use only (Node.js environment)
- 🛡️ Cannot be imported in browser code (will cause build errors)
- 📦 Use `#airo/secrets` import (with `#`) which works at runtime via Node.js package imports

## Use Cases

### Dynamic API Configuration

```typescript
// In src/server/api/config/GET.ts
import { getSecret } from "#airo/secrets";

const openaiKey = getSecret("OPENAI_API_KEY");
const stripeKey = getSecret("STRIPE_SECRET_KEY");

if (openaiKey && stripeKey) {
  // Initialize services with secrets
  initializeOpenAI(openaiKey);
  initializeStripe(stripeKey);
}
```

### Secret Validation

```typescript
// In src/server/api/health/GET.ts
import { listSecretNames, getSecret } from "#airo/secrets";

const requiredSecrets = ["DATABASE_URL", "API_KEY", "JWT_SECRET"];
const availableSecrets = listSecretNames();

for (const required of requiredSecrets) {
  if (!availableSecrets.includes(required)) {
    console.error(`Missing required secret: ${required}`);
  }
}
```

### Runtime Configuration

```typescript
// In src/server/config.ts
import { getSecret } from "#airo/secrets";

export function getConfig() {
  return {
    apiKey: getSecret("API_KEY"),
    apiUrl: getSecret("API_URL") || "https://api.example.com",
    debugMode: getSecret("DEBUG_MODE") === "true",
  };
}
```

## Technical Details

### File Location

Secrets are read from `/alloc/config.json` in the container, which has the following structure:

```json
{
  "OPENAI_API_KEY": {
    "VALUE": "sk-...",
    "SYSTEM_MANAGED": false
  },
  "STRIPE_SECRET_KEY": {
    "VALUE": "sk_test_...",
    "SYSTEM_MANAGED": false
  },
  "INTERNAL_TOKEN": {
    "VALUE": "...",
    "SYSTEM_MANAGED": true
  }
}
```

### Access Control

- Only secrets with `SYSTEM_MANAGED: false` are accessible
- System-managed secrets (with `SYSTEM_MANAGED: true`) are filtered out
- Returns `null` for missing or system-managed secrets

### Error Handling

All functions handle errors gracefully:

- Returns `null` or empty array on errors
- Logs errors to console.error for debugging
- Never throws exceptions

## License

Part of the Airo AI Builder template system.
