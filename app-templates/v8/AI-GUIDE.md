# AI Integration Guide for v8 App Template

This guide explains how the v8 App Template is optimized for AI-assisted development and how to work effectively with AI coding assistants.

## 🧠 AI-Friendly Features

### 1. Simplified Architecture

The v8 template removes backend complexity to focus on frontend development:
- Single Vite dev server (no backend server)
- Direct API integration patterns  
- Streamlined file structure
- Clear component organization

### 2. Consistent Patterns

Every aspect follows predictable patterns:
- Component structure and props
- File naming conventions
- Directory organization
- TypeScript usage

## 🗂️ Directory Structure

```
src/
├── components/         # Reusable UI components
│   └── shadcn/        # shadcn/ui components
├── pages/             # Route components
├── layouts/           # Layout components
├── api/              # API client functions
├── lib/              # Utility functions
└── styles/           # Global styles
```

## 📋 File Naming Conventions

- **Components**: `PascalCase.tsx` (e.g., `UserCard.tsx`)
- **Pages**: `kebab-case.tsx` (e.g., `user-profile.tsx`)
- **Utilities**: `camelCase.ts` (e.g., `formatUtils.ts`)
- **Types**: `camelCase.ts` (e.g., `userTypes.ts`)

## 🤖 Working with AI Assistants

### Common AI Tasks and Patterns

#### 1. Creating a New Page
When asking AI to create a new page:

```typescript
// Example request:
"Create a new products page that lists products"

// AI will follow this pattern:
// 1. Create src/pages/products.tsx
// 2. Add route to src/routes.tsx
// 3. Create API functions in src/api/
// 4. Use existing layout from src/layouts/
```

#### 2. Adding UI Components
When creating new components:

```typescript
// Example request:
"Create a ProductCard component with image, name, and price"

// AI will:
// 1. Create src/components/ProductCard.tsx
// 2. Use proper TypeScript interfaces
// 3. Follow shadcn/ui patterns
// 4. Include proper accessibility attributes
```

#### 3. API Integration
When adding API calls:

```typescript
// Example request:
"Add API calls for user data with React Query"

// AI will:
// 1. Create functions in src/api/users.ts
// 2. Set up React Query hooks
// 3. Handle loading and error states
// 4. Follow established patterns
```

## 📝 AI Prompt Templates

### Creating a New Feature
```
Create a [feature name] that includes:
1. A page component at src/pages/[name].tsx
2. Components in src/components/[Name]*.tsx 
3. API functions in src/api/[name].ts
4. Use existing layouts from src/layouts/

The feature should:
- Follow existing patterns in the codebase
- Use shadcn/ui components
- Include proper TypeScript types
- Handle loading and error states
```

### Adding a Component
```
Create a [ComponentName] component that:
1. Is placed in src/components/[ComponentName].tsx
2. Uses TypeScript interfaces for props
3. Follows shadcn/ui design patterns
4. Uses Tailwind CSS for styling
5. Is responsive and accessible

Props should include: [list expected props]
The component should: [describe functionality]
```

## 🔍 Finding Related Code

When working on a feature, AI can easily find related files:

```typescript
// If working on user features, check these locations:
src/pages/users.tsx           # User listing page
src/components/UserCard.tsx   # User components
src/api/users.ts              # User API calls
src/layouts/Dashboard.tsx     # Layout components
```

## 🎯 Best Practices for AI Collaboration

### 1. Be Specific About Context
- Instead of: "Add a button"
- Use: "Add a primary button to the UserCard component that opens edit modal"

### 2. Reference Existing Patterns  
- Instead of: "Create a form"
- Use: "Create a user form following the same pattern as existing components"

### 3. Include Requirements
Always specify:
- Loading states
- Error handling
- Accessibility needs
- Responsive design
- TypeScript types

## 🛠️ Development Patterns

### Component Pattern
```typescript
import { Button } from '@/components/shadcn/button';

interface ComponentProps {
  title: string;
  onClick?: () => void;
}

export function Component({ title, onClick }: ComponentProps) {
  return (
    <Button onClick={onClick}>
      {title}
    </Button>
  );
}
```

### API Pattern  
```typescript
// src/api/users.ts
export async function getUsers() {
  const response = await fetch('/api/users');
  return response.json();
}

// Using with React Query
import { useQuery } from '@tanstack/react-query';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  });
}
```

This guide helps AI assistants understand the v8 template structure and provides consistent patterns for development.
