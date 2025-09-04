# v8 App Template - Implementation Guide

## Overview

The v8 App Template is a streamlined, frontend-focused web application starter that combines React 19, TypeScript, and Vite. This template is specifically designed for AI-assisted development with a simple, clean architecture that removes backend complexity while maintaining modern development patterns.

## Core Architecture

### Technology Stack

#### Frontend Core
- **React 19** - Latest React with concurrent features
- **TypeScript 5** - Strict type safety throughout  
- **Vite 6** - Lightning-fast build tool with HMR
- **React Router DOM v7** - Client-side routing
- **TanStack Query v5** - Data fetching and caching
- **Zustand** - Simple state management

#### UI & Styling  
- **Tailwind CSS 3** - Utility-first CSS framework
- **shadcn/ui** - Complete component library
- **Lucide React** - Icon library  
- **next-themes** - Dark mode support

#### Forms & Validation
- **React Hook Form** - Form handling
- **Zod** - Schema validation
- **@hookform/resolvers** - Form validation integration

#### Development Tools
- **Vitest** - Testing framework
- **ESLint 9** - Code linting  
- **Prettier** - Code formatting

## Project Structure

```
v8-app-template/
├── src/
│   ├── components/               # React components
│   │   ├── shadcn/              # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── form.tsx
│   │   │   ├── input.tsx
│   │   │   └── ... (all shadcn components)
│   │   ├── ErrorBoundary.tsx    # Error boundary component
│   │   └── GeometricSpinner.tsx # Loading spinner
│   ├── layouts/                 # Layout components  
│   │   ├── Dashboard.tsx        # Dashboard layout
│   │   ├── Website.tsx          # Website layout
│   │   └── parts/               # Layout parts
│   │       ├── Header.tsx
│   │       └── Footer.tsx
│   ├── pages/                   # Page components
│   │   ├── index.tsx            # Home page
│   │   └── _404.tsx             # Not found page
│   ├── api/                     # API client functions
│   │   └── health.ts            # Health check API
│   ├── lib/                     # Utility functions
│   │   ├── api-client.ts        # API client setup
│   │   └── utils.ts             # Helper functions (cn, etc.)
│   ├── styles/                  # Global styles
│   │   └── globals.css          # Tailwind + custom CSS
│   ├── test/                    # Test setup
│   │   └── setup.ts
│   ├── App.tsx                  # Main app component
│   ├── main.tsx                 # React entry point
│   ├── router.ts                # Router configuration
│   ├── routes.tsx               # Route definitions
│   └── vite-env.d.ts           # Vite types
├── public/                      # Static assets
│   └── favicon.ico
├── dist/                        # Build output (gitignored)
├── node_modules/                # Dependencies (gitignored)
├── .env                         # Environment variables (gitignored)
├── env.example                  # Environment template
├── components.json              # shadcn/ui configuration
├── eslint.config.js             # ESLint configuration
├── index.html                   # HTML entry point
├── package.json                 # Dependencies and scripts
├── tailwind.config.js           # Tailwind configuration
├── tsconfig.json                # TypeScript configuration
├── vite.config.ts               # Vite configuration
└── vitest.config.ts             # Vitest configuration
```

## Implementation Details

### 1. Package.json Configuration

```json
{
  "name": "v8-app-template",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "type-check": "tsc --noEmit",
    "format": "prettier --write \"src/**/*.{ts,tsx,json,md}\"",
    "clean": "rm -rf dist node_modules/.vite",
    "reset": "npm run clean && pnpm install"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.2",
    "@tanstack/react-query": "^5.62.11",
    "@tanstack/react-query-devtools": "^5.62.11",
    "react-hook-form": "^7.62.0",
    "@hookform/resolvers": "^3.10.0",
    "zod": "^3.25.76",
    "zustand": "^5.0.2",
    "lucide-react": "^0.454.0",
    "next-themes": "^0.4.6",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "@radix-ui/react-*": "latest" // All shadcn/ui dependencies
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^6.0.3",
    "vitest": "^3.2.4",
    "@vitest/ui": "^3.2.4",
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
    "prettier": "^3.4.2"
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
    "paths": {
      "@/*": ["./src/*"],
      "@/components/*": ["./src/components/*"],
      "@/lib/*": ["./src/lib/*"],
      "@/api/*": ["./src/api/*"]
    },
    "baseUrl": "."
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### 3. Vite Configuration

**vite.config.ts:**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/api': path.resolve(__dirname, './src/api'),
    },
  },
  
  server: {
    port: 5173,
    host: true,
  },
  
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          'query-vendor': ['@tanstack/react-query'],
        },
      },
    },
  },
});
```

## Key Development Patterns

### 1. Component Structure
```typescript
// Standard component pattern
import { Button } from '@/components/shadcn/button';
import { Card } from '@/components/shadcn/card';

interface ComponentProps {
  // Define prop types
}

export function Component({ ...props }: ComponentProps) {
  // Component logic
  return (
    // JSX
  );
}
```

### 2. API Integration
```typescript
// src/api/example.ts
export async function fetchData(id: string) {
  const response = await fetch(`/api/data/${id}`);
  return response.json();
}

// Using with React Query
import { useQuery } from '@tanstack/react-query';

function useData(id: string) {
  return useQuery({
    queryKey: ['data', id],
    queryFn: () => fetchData(id),
  });
}
```

### 3. Form Handling
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

function MyForm() {
  const form = useForm({
    resolver: zodResolver(schema),
  });
  
  // Form implementation
}
```

## AI-Friendly Patterns

### File Naming Conventions
- **Components**: `PascalCase.tsx` (e.g., `UserCard.tsx`)
- **Pages**: `kebab-case.tsx` (e.g., `user-profile.tsx`) 
- **Utilities**: `camelCase.ts` (e.g., `formatUtils.ts`)
- **Types**: `camelCase.ts` (e.g., `userTypes.ts`)

### Directory Organization
```
src/
├── components/     # Reusable components
├── pages/         # Route components  
├── layouts/       # Layout components
├── lib/           # Utilities
├── api/           # API functions
└── styles/        # Global styles
```

## Development Workflow

### 1. Start Development
```bash
pnpm dev          # Start dev server
pnpm test         # Run tests
pnpm lint         # Check code quality
```

### 2. Build Production
```bash
pnpm build        # Build for production
pnpm preview      # Preview production build
```

### 3. Code Quality
```bash
pnpm lint:fix     # Fix linting issues
pnpm type-check   # Check TypeScript
pnpm format       # Format code
```

## Summary

The v8 App Template provides a clean, focused foundation for building modern React applications with:

- **Simplified Architecture**: Frontend-only, removing backend complexity
- **Modern Stack**: React 19, TypeScript, Vite, TanStack Query
- **Complete UI System**: shadcn/ui components with Tailwind CSS  
- **Developer Experience**: Fast builds, hot reload, comprehensive tooling
- **AI-Friendly**: Consistent patterns and clear file organization
- **Production Ready**: Optimized builds, testing, and deployment

Perfect for rapid prototyping and building production applications with AI assistance.
