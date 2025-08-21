# V3 App Template - Complete Implementation Guide

## Overview

The V3 App Template is a modern, production-ready web application starter that combines React 19, TypeScript, Vite, and Hono to create a type-safe, performant, and AI-friendly development environment. This template is specifically designed for novice developers working with AI assistants to build web applications.

## Core Architecture

### Technology Stack

#### Frontend
- **React 19** - Latest React with concurrent features and improved performance
- **TypeScript 5** - Strict type safety throughout the application
- **Vite 6** - Lightning-fast build tool with HMR and optimized production builds
- **Tailwind CSS 3** - Utility-first CSS framework (not v4 yet due to stability)
- **shadcn/ui** - Beautiful, accessible, copy-paste component library
- **React Router DOM v7** - Client-side routing with SSR support
- **TanStack Query v5** - Powerful data fetching and caching
- **React Hook Form + Zod** - Type-safe form handling and validation
- **Lucide React** - Consistent icon library

#### Backend
- **Hono v4** - Ultra-fast, TypeScript-first web framework
- **@hono/node-server** - Node.js adapter for Hono
- **@hono/zod-validator** - Request validation middleware
- **Zod** - Schema validation library

#### Build & Development
- **vite-plugin-ssr** - Server-side rendering support
- **Custom Source Mapper Plugin** - Component introspection for AI agents
- **Vitest** - Fast unit testing framework
- **ESLint 9** - Code linting with flat config
- **Prettier** - Code formatting
- **Concurrently** - Run multiple dev servers

## Project Structure

```
v3-app-template/
├── src/
│   ├── client/                    # Frontend React application
│   │   ├── components/           # React components
│   │   │   ├── ui/              # shadcn/ui base components
│   │   │   │   ├── button.tsx
│   │   │   │   ├── card.tsx
│   │   │   │   ├── form.tsx
│   │   │   │   ├── input.tsx
│   │   │   │   ├── label.tsx
│   │   │   │   └── dialog.tsx
│   │   │   ├── layout/          # Layout components
│   │   │   │   └── Layout.tsx
│   │   │   └── ErrorBoundary.tsx
│   │   ├── pages/               # Page components (SSR-aware)
│   │   │   ├── index.page.tsx   # Home page
│   │   │   ├── about.page.tsx   # About page
│   │   │   ├── users.page.tsx   # Users CRUD demo
│   │   │   └── 404.page.tsx     # Not found page
│   │   ├── hooks/               # Custom React hooks
│   │   │   └── useUser.ts       # User-related hooks
│   │   ├── api/                 # API client layer
│   │   │   ├── client.ts        # Axios instance configuration
│   │   │   └── users.ts         # User API functions
│   │   ├── lib/                 # Utilities
│   │   │   └── utils.ts         # Helper functions (cn, etc.)
│   │   ├── styles/              # Global styles
│   │   │   └── globals.css      # Tailwind imports & CSS variables
│   │   ├── App.tsx              # Main app component
│   │   └── entry-client.tsx     # Client entry point
│   ├── server/                  # Backend Hono application
│   │   ├── api/                 # API routes
│   │   │   └── routes.ts        # All API endpoints
│   │   ├── middleware/          # Custom middleware
│   │   │   └── cors.ts
│   │   ├── renderer/            # SSR rendering
│   │   │   └── PageShell.tsx
│   │   └── index.ts             # Server entry point
│   ├── shared/                  # Shared between client/server
│   │   ├── types/               # TypeScript type definitions
│   │   │   └── user.ts
│   │   ├── utils/               # Shared utilities
│   │   │   └── validation.ts
│   │   └── constants/           # Shared constants
│   │       └── index.ts
│   ├── test/                    # Test configuration
│   │   └── setup.ts
│   └── vite-env.d.ts           # Vite type definitions
├── plugins/                     # Custom Vite plugins
│   └── source-mapper.ts         # AI component introspection
├── public/                      # Static assets
│   └── favicon.ico
├── .github/                     # GitHub configuration
│   └── workflows/
│       └── ci.yml              # CI/CD pipeline
├── dist/                        # Build output (gitignored)
│   ├── client/                  # Client bundles
│   └── server/                  # Server bundles
├── node_modules/                # Dependencies (gitignored)
├── .env                         # Environment variables (gitignored)
├── .env.example                 # Environment template
├── .eslintrc.js                 # ESLint configuration
├── .gitignore                   # Git ignore rules
├── .prettierrc                  # Prettier configuration
├── components.json              # shadcn/ui configuration
├── docker-compose.yml           # Docker compose configuration
├── Dockerfile                   # Docker build configuration
├── index.html                   # HTML entry point
├── package.json                 # Dependencies and scripts
├── package-lock.json           # Locked dependencies
├── postcss.config.js           # PostCSS configuration
├── README.md                   # Project documentation
├── AI-GUIDE.md                 # AI integration guide
├── tailwind.config.js          # Tailwind configuration
├── tsconfig.json               # TypeScript configuration
├── tsconfig.node.json          # Node TypeScript config
├── vite.config.ts              # Vite configuration
└── vitest.config.ts            # Vitest configuration
```

## Implementation Details

### 1. Package.json Configuration

```json
{
  "name": "v3-app-template",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm:dev:*\"",
    "dev:client": "vite",
    "dev:server": "tsx watch src/server/index.ts",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build --outDir dist/client",
    "build:server": "vite build --ssr src/server/index.ts --outDir dist/server",
    "preview": "NODE_ENV=production tsx src/server/index.ts",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "type-check": "tsc --noEmit",
    "format": "prettier --write \"src/**/*.{ts,tsx,json,md}\"",
    "clean": "rm -rf dist node_modules/.vite",
    "reset": "npm run clean && npm install"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.2",
    "hono": "^4.6.13",
    "@hono/node-server": "^1.13.8",
    "@hono/zod-validator": "^0.4.2",
    "vite-plugin-ssr": "^0.4.142",
    "@tanstack/react-query": "^5.62.11",
    "@tanstack/react-query-devtools": "^5.62.11",
    "axios": "^1.7.9",
    "zod": "^3.24.1",
    "react-hook-form": "^7.54.2",
    "@hookform/resolvers": "^3.10.0",
    "zustand": "^5.0.2",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-dropdown-menu": "^2.1.4",
    "@radix-ui/react-label": "^2.1.1",
    "@radix-ui/react-slot": "^1.1.1",
    "@radix-ui/react-toast": "^1.2.3",
    "@radix-ui/react-tooltip": "^1.1.6",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "lucide-react": "^0.454.0",
    "date-fns": "^4.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^6.0.3",
    "vitest": "^2.1.8",
    "@vitest/ui": "^2.1.8",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@testing-library/jest-dom": "^6.6.3",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "eslint": "^9.16.0",
    "@eslint/js": "^9.16.0",
    "@typescript-eslint/eslint-plugin": "^8.18.2",
    "@typescript-eslint/parser": "^8.18.2",
    "eslint-plugin-react": "^7.37.2",
    "eslint-plugin-react-hooks": "^5.0.0",
    "eslint-plugin-react-refresh": "^0.4.14",
    "prettier": "^3.4.2",
    "concurrently": "^9.1.2",
    "tsx": "^4.19.2",
    "@babel/parser": "^7.26.3",
    "@babel/traverse": "^7.26.4",
    "@babel/generator": "^7.26.3",
    "@babel/types": "^7.26.3",
    "@types/babel__traverse": "^7.20.6"
  }
}
```

### 2. TypeScript Configuration

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "paths": {
      "@/*": ["./src/*"],
      "@/components/*": ["./src/client/components/*"],
      "@/api/*": ["./src/client/api/*"],
      "@/server/*": ["./src/server/*"],
      "@/shared/*": ["./src/shared/*"]
    },
    "baseUrl": "."
  },
  "include": ["src", "vite.config.ts", "plugins"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### 3. Vite Configuration

**vite.config.ts:**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import ssr from 'vite-plugin-ssr/plugin';
import { sourceMapperPlugin } from './plugins/source-mapper';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ssr(),
    mode === 'development' && sourceMapperPlugin(),
  ].filter(Boolean),
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/client/components'),
      '@/api': path.resolve(__dirname, './src/client/api'),
      '@/server': path.resolve(__dirname, './src/server'),
      '@/shared': path.resolve(__dirname, './src/shared'),
    },
  },
  
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          'query-vendor': ['@tanstack/react-query', 'axios'],
        },
      },
    },
  },
  
  ssr: {
    noExternal: ['@tanstack/react-query'],
  },
}));
```

### 4. Custom Source Mapper Plugin

**plugins/source-mapper.ts:**
```typescript
import type { Plugin } from 'vite';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

export function sourceMapperPlugin(): Plugin {
  return {
    name: 'source-mapper',
    enforce: 'pre',
    
    transform(code: string, id: string) {
      // Only process React component files, not node_modules
      if (!id.match(/\.(tsx?|jsx?)$/) || id.includes('node_modules')) {
        return null;
      }
      
      try {
        // Parse the code into AST
        const ast = parse(code, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript'],
          sourceFilename: id,
        });
        
        // Track if we made any changes
        let hasChanges = false;
        
        // Traverse and modify JSX elements
        traverse.default(ast, {
          JSXOpeningElement(path) {
            // Skip fragments or elements that already have source attributes
            if (!path.node.name || path.node.name.type !== 'JSXIdentifier') {
              return;
            }
            
            // Check if attributes already exist
            const hasSourceAttr = path.node.attributes.some(
              attr => t.isJSXAttribute(attr) && 
                     t.isJSXIdentifier(attr.name) &&
                     attr.name.name.startsWith('data-source')
            );
            
            if (hasSourceAttr) return;
            
            // Add source mapping attributes
            const lineNumber = path.node.loc?.start.line || 0;
            const componentName = findComponentName(path);
            
            const attributes = [
              t.jsxAttribute(
                t.jsxIdentifier('data-source-file'),
                t.stringLiteral(id.replace(process.cwd(), ''))
              ),
              t.jsxAttribute(
                t.jsxIdentifier('data-source-line'),
                t.stringLiteral(String(lineNumber))
              ),
            ];
            
            if (componentName) {
              attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('data-source-component'),
                  t.stringLiteral(componentName)
                )
              );
            }
            
            path.node.attributes.push(...attributes);
            hasChanges = true;
          },
        });
        
        if (!hasChanges) {
          return null;
        }
        
        // Generate the modified code
        const result = generate.default(ast, {
          sourceMaps: true,
          sourceFileName: id,
        }, code);
        
        return {
          code: result.code,
          map: result.map,
        };
      } catch (error) {
        console.warn(`Failed to process ${id}:`, error);
        return null;
      }
    },
  };
}

function findComponentName(path: any): string | null {
  let current = path;
  
  while (current) {
    // Check if we're inside a function component
    if (current.isFunctionDeclaration() || 
        current.isFunctionExpression() || 
        current.isArrowFunctionExpression()) {
      const parent = current.parent;
      
      // Named function
      if (current.node.id?.name) {
        return current.node.id.name;
      }
      
      // Variable declaration
      if (t.isVariableDeclarator(parent)) {
        if (t.isIdentifier(parent.id)) {
          return parent.id.name;
        }
      }
      
      // Export default
      if (t.isExportDefaultDeclaration(parent)) {
        return 'default';
      }
    }
    
    current = current.parentPath;
  }
  
  return null;
}
```

### 5. Server Implementation (Hono)

**src/server/index.ts:**
```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { renderPage } from 'vite-plugin-ssr/server';
import api from './api/routes';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('/api/*', cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}));

// API routes
app.route('/api', api);

// Health check
app.get('/health', (c) => c.json({ 
  status: 'ok', 
  timestamp: new Date().toISOString(),
  environment: process.env.NODE_ENV || 'development'
}));

// SSR handler for all other routes
app.get('*', async (c) => {
  const pageContextInit = {
    urlOriginal: c.req.url,
  };
  
  const pageContext = await renderPage(pageContextInit);
  
  if (!pageContext.httpResponse) {
    return c.notFound();
  }
  
  const { body, statusCode, contentType } = pageContext.httpResponse;
  
  return c.body(body, statusCode, {
    'Content-Type': contentType,
  });
});

// Global error handler
app.onError((err, c) => {
  console.error(`Error: ${err.message}`, err.stack);
  
  // In development, return detailed error
  if (process.env.NODE_ENV === 'development') {
    return c.json({ 
      error: err.message,
      stack: err.stack,
    }, 500);
  }
  
  // In production, return generic error
  return c.json({ error: 'Internal Server Error' }, 500);
});

const port = parseInt(process.env.PORT || '3000', 10);

console.log(`🚀 Server running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
```

**src/server/api/routes.ts:**
```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { User } from '@/shared/types/user';

const api = new Hono();

// In-memory database (replace with real database)
let users: User[] = [
  { 
    id: '1', 
    name: 'John Doe', 
    email: 'john@example.com', 
    createdAt: new Date(),
    updatedAt: new Date()
  },
  { 
    id: '2', 
    name: 'Jane Smith', 
    email: 'jane@example.com', 
    createdAt: new Date(),
    updatedAt: new Date()
  },
];

// Validation schemas
const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

const UpdateUserSchema = CreateUserSchema.partial();

// GET /api/users
api.get('/users', (c) => {
  return c.json(users);
});

// GET /api/users/:id
api.get('/users/:id', (c) => {
  const id = c.req.param('id');
  const user = users.find(u => u.id === id);
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  return c.json(user);
});

// POST /api/users
api.post('/users',
  zValidator('json', CreateUserSchema),
  async (c) => {
    const data = c.req.valid('json');
    
    // Check for duplicate email
    const existingUser = users.find(u => u.email === data.email);
    if (existingUser) {
      return c.json({ error: 'Email already exists' }, 400);
    }
    
    const newUser: User = {
      id: String(Date.now()),
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    users.push(newUser);
    
    return c.json(newUser, 201);
  }
);

// PUT /api/users/:id
api.put('/users/:id',
  zValidator('json', UpdateUserSchema),
  async (c) => {
    const id = c.req.param('id');
    const data = c.req.valid('json');
    
    const index = users.findIndex(u => u.id === id);
    
    if (index === -1) {
      return c.json({ error: 'User not found' }, 404);
    }
    
    // Check email uniqueness if email is being updated
    if (data.email && data.email !== users[index].email) {
      const emailExists = users.some(u => u.email === data.email && u.id !== id);
      if (emailExists) {
        return c.json({ error: 'Email already exists' }, 400);
      }
    }
    
    users[index] = { 
      ...users[index], 
      ...data,
      updatedAt: new Date()
    };
    
    return c.json(users[index]);
  }
);

// DELETE /api/users/:id
api.delete('/users/:id', (c) => {
  const id = c.req.param('id');
  const index = users.findIndex(u => u.id === id);
  
  if (index === -1) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  const deletedUser = users[index];
  users.splice(index, 1);
  
  return c.json({ 
    message: 'User deleted successfully',
    user: deletedUser
  });
});

export default api;
```

### 6. Client Entry Point

**src/client/entry-client.tsx:**
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App from './App';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

// Support both client-side navigation and SSR hydration
const rootElement = document.getElementById('app');
if (!rootElement) throw new Error('Root element not found');

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
```

### 7. Main App Component

**src/client/App.tsx:**
```typescript
import { Routes, Route } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import HomePage from './pages/index.page';
import AboutPage from './pages/about.page';
import UsersPage from './pages/users.page';
import NotFoundPage from './pages/404.page';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/toaster';

export default function App() {
  return (
    <ErrorBoundary>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
      <Toaster />
    </ErrorBoundary>
  );
}
```

### 8. Environment Variables

**.env.example:**
```env
# Application
VITE_APP_NAME=V3 App Template
VITE_PUBLIC_URL=http://localhost:5173
VITE_API_URL=http://localhost:3000/api

# Server
NODE_ENV=development
PORT=3000

# Features
VITE_ENABLE_SOURCE_MAPPING=true
VITE_ENABLE_SSR=true

# Database (when needed)
# DATABASE_URL=postgresql://user:pass@localhost:5432/dbname

# External APIs (when needed)
# OPENAI_API_KEY=your-key-here
# ANTHROPIC_API_KEY=your-key-here

# Authentication (when needed)
# JWT_SECRET=your-secret-here
# SESSION_SECRET=your-secret-here
```

### 9. Tailwind Configuration

**tailwind.config.js:**
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

### 10. Global Styles

**src/client/styles/globals.css:**
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 262.1 83.3% 57.8%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 262.1 83.3% 57.8%;
    --radius: 0.5rem;
  }
  
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 263.4 70% 50.4%;
    --primary-foreground: 210 40% 98%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 263.4 70% 50.4%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}

/* Custom utility classes */
@layer utilities {
  .animate-in {
    animation-duration: 0.2s;
    animation-fill-mode: both;
  }
  
  .fade-in {
    animation-name: fadeIn;
  }
  
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
}
```

## Key Implementation Patterns

### API Client Pattern

**src/client/api/client.ts:**
```typescript
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const client = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Request interceptor for auth
client.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

### Custom Hook Pattern

**src/client/hooks/useUser.ts:**
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi } from '@/api/users';
import type { User } from '@/shared/types/user';
import { toast } from '@/components/ui/use-toast';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: userApi.getAll,
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: ['users', id],
    queryFn: () => userApi.getById(id),
    enabled: !!id,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: userApi.create,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({
        title: 'Success',
        description: 'User created successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<User> }) =>
      userApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users', id] });
      toast({
        title: 'Success',
        description: 'User updated successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: userApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({
        title: 'Success',
        description: 'User deleted successfully',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
```

### Form Handling Pattern

**Example form component:**
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
});

type FormData = z.infer<typeof formSchema>;

export function UserForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      email: '',
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="John Doe" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="john@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  );
}
```


## AI Integration Guide

### Component Introspection

The custom Vite plugin adds metadata to every React component in development mode:

```html
<div data-source-file="/src/client/components/Button.tsx" 
     data-source-line="15" 
     data-source-component="Button">
  Click Me
</div>
```

### AI-Friendly Patterns

1. **Consistent file naming:** All components use PascalCase, hooks use camelCase with 'use' prefix
2. **Clear directory structure:** Separation of concerns between client, server, and shared code
3. **Type-first approach:** Every function has TypeScript types
4. **Standardized API patterns:** CRUD operations follow consistent structure
5. **Component composition:** Small, reusable components that compose into larger features

### Common AI Tasks

#### Creating a new page:
1. Create file in `src/client/pages/[name].page.tsx`
2. Add route to `src/client/App.tsx`
3. Export `documentProps` for SSR metadata

#### Creating a new API endpoint:
1. Add route to `src/server/api/routes.ts`
2. Create Zod schema for validation
3. Implement handler with proper error handling

#### Creating a new component:
1. Create file in `src/client/components/`
2. Define TypeScript interface for props
3. Export named function component

## Testing Strategy

### Unit Tests with Vitest

**vitest.config.ts:**
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '*.config.js',
        '*.config.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/client/components'),
      '@/api': path.resolve(__dirname, './src/client/api'),
      '@/server': path.resolve(__dirname, './src/server'),
      '@/shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
```

## Performance Optimizations

1. **Code splitting:** Automatic route-based code splitting
2. **Bundle optimization:** Vendor chunks for better caching
3. **Image optimization:** Use next-gen formats and lazy loading
4. **CSS optimization:** PurgeCSS in production builds
5. **Compression:** Gzip/Brotli compression on server
6. **Caching:** Proper cache headers and React Query caching

## Security Considerations

1. **Input validation:** Zod schemas on all API endpoints
2. **CORS configuration:** Restricted origins in production
3. **Environment variables:** Sensitive data never in code
4. **Authentication ready:** Interceptors configured for auth tokens
5. **Error handling:** No sensitive data in error messages
6. **CSP headers:** Content Security Policy in production
7. **Rate limiting:** Ready to add with Hono middleware

## Summary

This V3 App Template provides a complete, production-ready foundation for building modern web applications with:

- Full type safety across frontend and backend
- Excellent developer experience with hot reload and fast builds
- AI-friendly patterns and component introspection
- SSR support for SEO
- Comprehensive testing setup
- Docker-ready deployment
- Clear, maintainable architecture

The template is designed to scale from simple prototypes to complex production applications while maintaining code quality and developer productivity.