## API Development with vite-plugin-api-routes

**⚠️ IMPORTANT: The template uses vite-plugin-api-routes in ISOLATED mode with Express-style handlers.**

### Template Architecture

The template uses:

- **vite-plugin-api-routes** in ISOLATED mode for automatic route detection
- **Express Request/Response** handlers (not Next.js App Router)
- **File structure**: Routes live in `src/api/` directory
- **HTTP methods**: Use uppercase file names (`GET.ts`, `POST.ts`, etc.)

### Configuration

The Vite config is set up with:

```typescript
apiRoutes({
  mode: 'isolated',
  routeBase: '/api',
  dirs: [{ dir: './src/api', route: '' }],
});
```

### File-Based Routing Structure

API routes are automatically mapped from files in `src/api/`:

```
src/api/
├── health/
│   └── GET.ts                → GET /api/health
├── users/
│   ├── GET.ts                → GET /api/users
│   ├── POST.ts               → POST /api/users
│   └── [userId]/
│       ├── GET.ts            → GET /api/users/:userId
│       └── DELETE.ts         → DELETE /api/users/:userId
```

### Creating New API Endpoints

To create a new API endpoint:

1. **Create a directory** under `src/api/` with your endpoint name
2. **Add HTTP method files** (uppercase: `GET.ts`, `POST.ts`, etc.)
3. **Export a default handler function** using Express-style signature

#### Example: Health Check Endpoint

File: `src/api/health/GET.ts`

```typescript
import type { Request, Response } from 'express';

export default async function handler(_req: Request, res: Response) {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Hello World!',
  });
}
```

This creates a `GET /api/health` endpoint.

#### Example: Data Retrieval with Query Parameters

File: `src/api/users/GET.ts`

```typescript
import type { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  const { limit = '10' } = req.query;

  const users = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
  ].slice(0, parseInt(limit as string));

  res.json({ users });
}
```

#### Example: Creating Resources

File: `src/api/users/POST.ts`

```typescript
import type { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: 'Missing required fields',
    });
  }

  const user = {
    id: Date.now().toString(),
    name,
    email,
  };

  res.status(201).json({ user });
}
```

#### Dynamic Routes

Use `[paramName]` directories for dynamic segments:

File: `src/api/users/[userId]/GET.ts`

```typescript
import type { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  const { userId } = req.params;

  const user = {
    id: userId,
    name: 'Sample User',
    email: 'user@example.com',
  };

  res.json({ user });
}
```
