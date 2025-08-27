# AI Integration Guide for V3 App Template

This guide explains how the V3 App Template is optimized for AI-assisted development and how to work effectively with AI coding assistants.

## 🧠 AI-Friendly Features

### 1. Component Introspection

The custom Vite plugin adds metadata to React components during development:

```html
<!-- Example output -->
<div data-source-file="/src/client/components/UserCard.tsx" 
     data-source-line="25" 
     data-source-component="UserCard">
  <h3>John Doe</h3>
  <p>john@example.com</p>
</div>
```

This allows AI tools to:
- Understand component hierarchy
- Navigate to source files
- Provide context-aware suggestions
- Debug rendering issues

### 2. Consistent Architecture Patterns

#### File Naming Conventions
- **Components**: `PascalCase.tsx` (e.g., `UserCard.tsx`)
- **Pages**: `kebab-case.page.tsx` (e.g., `user-profile.page.tsx`)
- **Hooks**: `camelCase.ts` with `use` prefix (e.g., `useUserData.ts`)
- **Types**: `camelCase.ts` (e.g., `userTypes.ts`)
- **Utils**: `camelCase.ts` (e.g., `formatUtils.ts`)

#### Directory Structure
```
src/
├── frontend/
│   ├── components/      # Reusable UI components
│   ├── pages/          # Route components
│   ├── hooks/          # Custom React hooks
│   ├── api/            # API client functions
│   └── lib/            # Utility functions
├── backend/
│   ├── api/            # API route handlers
│   └── middleware/     # Hono middleware
└── shared/
    ├── types/          # Shared TypeScript types
    ├── utils/          # Shared utility functions
    └── constants/      # Shared constants
```

## 🤖 Working with AI Assistants

### Common AI Tasks and Patterns

#### 1. Creating a New Page
When asking AI to create a new page:

```typescript
// Example request:
"Create a new products page that lists products with search and filtering"

// AI will follow this pattern:
// 1. Create src/frontend/pages/products.page.tsx
// 2. Add route to src/frontend/App.tsx
// 3. Create necessary hooks in src/frontend/hooks/
// 4. Add API functions in src/frontend/api/
// 5. Update types in src/shared/types/
```

#### 2. Creating API Endpoints
When adding new API functionality:

```typescript
// Example request:
"Add CRUD endpoints for products"

// AI will:
// 1. Add routes to src/backend/api/routes.ts
// 2. Create Zod schemas for validation
// 3. Add TypeScript types to src/shared/types/
// 4. Create client API functions in src/frontend/api/
```

#### 3. Adding UI Components
When creating new components:

```typescript
// Example request:
"Create a ProductCard component with image, name, price, and buy button"

// AI will:
// 1. Create src/frontend/components/ProductCard.tsx
// 2. Use proper TypeScript interfaces
// 3. Follow shadcn/ui patterns
// 4. Include proper accessibility attributes
```

### 4. Form Handling Pattern
The template uses a consistent pattern for forms:

```typescript
// Standard form component pattern
interface FormProps {
  onSubmit: (data: FormData) => void;
  onCancel?: () => void;
  initialData?: Partial<FormData>;
  isLoading?: boolean;
}

function MyForm({ onSubmit, onCancel, initialData, isLoading }: FormProps) {
  // Use React Hook Form + Zod validation
  // Include proper error handling
  // Follow accessibility guidelines
}
```

## 📋 AI Prompt Templates

### Creating a New Feature
```
Create a [feature name] feature that includes:
1. A page component at src/frontend/pages/[name].page.tsx
2. API endpoints in src/backend/api/routes.ts for CRUD operations
3. TypeScript types in src/shared/types/[name].ts
4. Custom hooks in src/frontend/hooks/use[Name].ts
5. API client functions in src/frontend/api/[name].ts

The feature should:
- Follow the existing patterns in the codebase
- Include proper error handling
- Use Zod for validation
- Include loading states
- Be fully typed with TypeScript
```

### Adding a Component
```
Create a [ComponentName] component that:
1. Is placed in src/frontend/components/[ComponentName].tsx
2. Uses TypeScript interfaces for props
3. Follows shadcn/ui design patterns
4. Includes proper accessibility attributes
5. Uses Tailwind CSS for styling
6. Is responsive and mobile-friendly

Props should include:
- [list expected props]

The component should:
- [describe functionality]
```

### Debugging Components
```
I'm having an issue with [ComponentName]. The component source is at:
- File: [file path from data-source-file]
- Line: [line number from data-source-line]
- Component: [component name from data-source-component]

The issue is: [describe the problem]

Please help me debug and fix this issue.
```

## 🔍 Component Discovery

### Using Browser DevTools
1. Open browser DevTools
2. Inspect any element
3. Look for `data-source-*` attributes
4. Use the file path to navigate to source code

### Finding Related Code
When working on a feature, the AI can easily find related files:

```typescript
// If working on user features, check these locations:
src/frontend/pages/users.page.tsx       // User listing page
src/frontend/hooks/useUser.ts           // User-related hooks
src/frontend/api/users.ts               // User API client
src/backend/api/routes.ts               // User API endpoints
src/shared/types/user.ts                // User TypeScript types
```

## 🎯 Best Practices for AI Collaboration

### 1. Be Specific About Context
Instead of: "Add a button"
Use: "Add a primary button to the UserCard component that triggers the onEdit callback"

### 2. Reference Existing Patterns
Instead of: "Create a form"
Use: "Create a user form following the same pattern as the existing UserForm component"

### 3. Include Error Handling
Always specify error handling requirements:
- Loading states
- Error messages
- Validation feedback
- Network error handling

### 4. Follow TypeScript Patterns
Request fully typed solutions:
- Interface definitions
- Generic types where appropriate
- Proper return types
- Null/undefined handling

## 🗄️ Database Management

### MySQL Operations Tool
AI agents can create and manage MySQL databases using the `mysql_operation` tool:

```javascript
// Create a new database schema with user
await executeToolFunction('mysql_operation', {
  operation: 'create_schema_user',
  schemaName: 'my_app_db'
});
```

**Key Features:**
- ✅ One-step schema and user creation
- ✅ Auto-generated secure credentials
- ✅ Automatic `.env` file updates
- ✅ Immediate availability for use

**Database Service Usage:**
- Import functions from `src/backend/services/database.ts`
- Use `testDatabaseConnection()`, `executeQuery()`, `executeTransaction()`
- Docker-compatible host detection included

### API Generation Tool
AI agents can automatically generate APIs from database schemas using the `auto_api_generator` tool:

```javascript
// Generate API endpoints for a table
await executeToolFunction('auto_api_generator', {
  operation: 'generate_endpoints',
  database: { user: 'user', password: 'pass', database: 'db' },
  tables: ['users'],
  operations: ['create', 'read_all', 'read', 'update', 'delete']
});
```

**Key Features:**
- ✅ Auto-generates TypeScript types and Zod schemas
- ✅ Creates Hono.js API routes in `src/backend/api/routes.ts`
- ✅ Supports selective operations (e.g., read-only APIs)
- ✅ Includes proper validation and error handling

**Prerequisites:** Database and migrations must be run first before generating APIs.

## 🔧 Troubleshooting AI Development

### Common Issues and Solutions

#### 1. Import Path Issues
If AI suggests wrong import paths, remind it:
```
Use these path aliases:
- ~/ for src/
- ~/components for src/frontend/components/
- ~/api for src/frontend/api/
- ~/shared for src/shared/
```

#### 2. Component Not Updating
Check the source mapping:
1. Inspect element in DevTools
2. Verify `data-source-*` attributes
3. Ensure you're editing the correct file

#### 3. Type Errors
The AI should always:
- Import types from shared directory
- Use proper TypeScript syntax
- Handle optional properties
- Include proper error types

## 📚 Learning Resources

### Understanding the Codebase
1. Start with `src/frontend/App.tsx` - main app structure
2. Check `src/frontend/pages/` - page components and routing
3. Review `src/backend/api/routes.ts` - API structure
4. Examine `src/shared/types/` - data models

### Key Patterns to Learn
1. **TanStack Query** - Data fetching and caching
2. **React Hook Form + Zod** - Form handling and validation
3. **Hono** - API route creation
4. **shadcn/ui** - Component composition

This guide helps AI assistants understand the codebase structure and provides consistent patterns for development. Always reference this guide when working with AI tools on this project.
