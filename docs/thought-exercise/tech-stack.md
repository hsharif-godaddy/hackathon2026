> **Note: This is an exploratory design exercise and does not reflect the current architecture. See root CLAUDE.md for the actual system design.**

# Airo Standard Tech Stack

## Overview

Airo AI Builder uses a curated, best-in-class TypeScript/React/Node.js technology stack that provides maximum developer productivity, type safety, and performance. This standardized approach ensures consistency across all applications built on the platform.

## 🎯 Core Philosophy

- **TypeScript First**: Type safety across the entire stack
- **Modern React**: Latest React patterns and best practices
- **Full-Stack Next.js**: Unified frontend and backend development
- **Performance Optimized**: Fast builds, fast tests, fast deployments
- **Developer Experience**: Exceptional DX with modern tooling

---

## 🏗️ Frontend Stack

### Next.js 14+ (App Router)

**The React Framework for Production**

#### Why Next.js?

- **Full-Stack Framework**: Handle both frontend and backend in one codebase
- **App Router**: Modern routing with React Server Components
- **Performance**: Automatic optimization, image optimization, code splitting
- **SEO**: Built-in SSR and SSG capabilities
- **TypeScript**: First-class TypeScript support
- **Deployment**: Optimized for Vercel and other platforms

#### Key Features Used

- **React Server Components**: Reduce client-side JavaScript bundle
- **Server Actions**: Type-safe server mutations
- **Streaming**: Progressive page loading
- **Static Generation**: Pre-render pages at build time
- **API Routes**: Backend API endpoints in the same codebase

### React 18+

**Modern React with Concurrent Features**

#### React Features

- **Functional Components**: Modern React patterns
- **Hooks**: useState, useEffect, custom hooks
- **Concurrent Features**: Suspense, useTransition, useDeferredValue
- **Server Components**: Render components on the server
- **TypeScript Integration**: Excellent TypeScript support

### Styling Solution

**Tailwind CSS + shadcn/ui**

#### Tailwind CSS

- **Utility-First**: Rapid UI development
- **Design System**: Consistent spacing, colors, typography
- **Performance**: Purged CSS for minimal bundle size
- **Dark Mode**: Built-in dark mode support
- **Responsive**: Mobile-first responsive design

#### shadcn/ui

- **Component Library**: Beautiful, accessible React components
- **Customizable**: Copy and modify components as needed
- **TypeScript**: Fully typed components
- **Radix Primitives**: Built on solid accessibility foundations
- **Themeable**: Easy customization and theming

---

## 🔧 Backend Stack

### Next.js API Routes

**Type-Safe Backend APIs**

#### Features

- **Server Actions**: Type-safe form handling and mutations
- **API Routes**: RESTful API endpoints
- **Middleware**: Request/response processing
- **Edge Runtime**: Fast, globally distributed functions
- **TypeScript**: Shared types between frontend and backend

### Database Layer

**Prisma + PostgreSQL**

#### Prisma ORM

- **Type-Safe**: Generated TypeScript types from schema
- **Database Migrations**: Version-controlled schema changes
- **Query Builder**: Intuitive, type-safe database queries
- **Introspection**: Generate schema from existing databases
- **Multi-Database**: Support for multiple database providers

#### PostgreSQL

- **Reliability**: ACID compliance and data integrity
- **Performance**: Excellent performance for complex queries
- **JSON Support**: Native JSON data types
- **Full-Text Search**: Built-in search capabilities
- **Extensions**: Rich ecosystem of extensions

### Authentication

**NextAuth.js (Auth.js)**

#### Features

- **Provider Integration**: OAuth with Google, GitHub, etc.
- **Database Sessions**: Secure session management
- **JWT Support**: Stateless authentication
- **TypeScript**: Fully typed authentication
- **Middleware**: Route protection and user context

---

## 🧪 Testing Stack

### Vitest

**Fast Unit Testing Framework**

#### Why Vitest?

- **Speed**: Extremely fast test execution
- **ESM First**: Native ES modules support
- **TypeScript**: Zero-config TypeScript support
- **Watch Mode**: Intelligent test re-running
- **Jest Compatible**: Easy migration from Jest

#### Testing Approach

- **Unit Tests**: Individual function and component testing
- **Integration Tests**: API route and database testing
- **Snapshot Testing**: UI component regression testing
- **Coverage**: Built-in code coverage reporting

### Testing Library

**React Testing Library + Jest DOM**

#### Features

- **User-Centric**: Test components as users interact with them
- **Accessibility**: Encourage accessible component design
- **Simple API**: Easy to write and maintain tests
- **TypeScript**: Full TypeScript support

### Playwright (E2E)

**End-to-End Testing**

#### Features

- **Cross-Browser**: Test on Chromium, Firefox, Safari
- **Auto-Wait**: Intelligent waiting for elements
- **Debugging**: Built-in debugging tools
- **Parallel Testing**: Fast execution with parallel tests

---

## 🛠️ Development Tools

### Package Management

**pnpm**

#### Why pnpm?

- **Fast**: Faster than npm and yarn
- **Efficient**: Shared dependency storage
- **Strict**: Better dependency resolution
- **Monorepo**: Excellent monorepo support

### Code Quality

**ESLint + Prettier + TypeScript**

#### ESLint Configuration

- **@next/eslint-config-next**: Next.js optimized rules
- **@typescript-eslint**: TypeScript-specific linting
- **eslint-plugin-react-hooks**: React hooks linting
- **Custom Rules**: AIRO-specific coding standards

#### Prettier Configuration

- **Consistent Formatting**: Automatic code formatting
- **Integration**: Works with ESLint and editors
- **TypeScript**: Full TypeScript support
- **Import Sorting**: Organized import statements

### Git Hooks

**Husky + lint-staged**

#### Pre-commit Hooks

- **Linting**: Run ESLint on staged files
- **Formatting**: Run Prettier on staged files
- **Type Checking**: Run TypeScript compiler
- **Testing**: Run relevant tests

---

## 📦 Build & Deployment

### Build Tools

**Next.js Built-in + Turbopack**

#### Features

- **Fast Builds**: Optimized build pipeline
- **Code Splitting**: Automatic code splitting
- **Tree Shaking**: Remove unused code
- **Bundle Analyzer**: Analyze bundle size
- **Source Maps**: Production debugging support

### Environment Management

**Dotenv + Zod Validation**

#### Environment Variables

- **Type-Safe**: Validate environment variables with Zod
- **Development**: Local .env files
- **Production**: Secure environment variable management
- **Schema**: Define required environment variables

---

## 🗃️ Standard Dependencies

### Core Dependencies

```json
{
  "next": "^14.0.0",
  "react": "^18.0.0",
  "react-dom": "^18.0.0",
  "typescript": "^5.0.0",
  "prisma": "^5.0.0",
  "@prisma/client": "^5.0.0",
  "next-auth": "^4.0.0",
  "zod": "^3.0.0",
  "tailwindcss": "^3.0.0"
}
```

### Development Dependencies

```json
{
  "vitest": "^1.0.0",
  "@testing-library/react": "^13.0.0",
  "@testing-library/jest-dom": "^6.0.0",
  "@playwright/test": "^1.0.0",
  "eslint": "^8.0.0",
  "prettier": "^3.0.0",
  "husky": "^8.0.0",
  "lint-staged": "^15.0.0"
}
```

---

## 🎨 UI Component Library

### shadcn/ui Components

**Pre-built, Customizable Components**

#### Core Components

- **Button**: Various button styles and sizes
- **Input**: Form input components
- **Select**: Dropdown selection components
- **Modal**: Dialog and modal components
- **Table**: Data table with sorting and filtering
- **Form**: Form handling with validation
- **Navigation**: Header, sidebar, breadcrumb components

#### Advanced Components

- **Data Table**: Advanced table with pagination, sorting, filtering
- **Charts**: Chart components built on Recharts
- **Calendar**: Date picker and calendar components
- **Command**: Command palette and search components
- **Combobox**: Autocomplete and multi-select components

---

## 📁 Project Structure

### Standard Next.js App Router Structure

```
app/
├── globals.css
├── layout.tsx
├── page.tsx
├── (dashboard)/
│   ├── dashboard/
│   │   └── page.tsx
│   └── layout.tsx
├── api/
│   ├── auth/
│   │   └── [...nextauth]/
│   │       └── route.ts
│   └── users/
│       └── route.ts
components/
├── ui/           # shadcn/ui components
├── forms/        # Form components
├── layouts/      # Layout components
└── features/     # Feature-specific components
lib/
├── auth.ts       # Authentication configuration
├── db.ts         # Database configuration
├── utils.ts      # Utility functions
└── validations.ts # Zod schemas
prisma/
├── schema.prisma
└── migrations/
tests/
├── __tests__/    # Unit tests
├── e2e/          # End-to-end tests
└── setup.ts      # Test setup
```

---

## 🔄 Development Workflow

### Local Development

1. **Clone Template**: Start with standardized template
2. **Install Dependencies**: `pnpm install`
3. **Setup Database**: `pnpm db:migrate`
4. **Run Development**: `pnpm dev`
5. **Run Tests**: `pnpm test`

### Code Quality Checks

1. **Type Checking**: `pnpm type-check`
2. **Linting**: `pnpm lint`
3. **Formatting**: `pnpm format`
4. **Testing**: `pnpm test`

### Production Deployment

1. **Build**: `pnpm build`
2. **Test Build**: `pnpm start`
3. **Deploy**: One-click deployment to Airo hosting

This standardized tech stack ensures that all applications built on Airo AI Builder are modern, maintainable, performant, and follow industry best practices.
