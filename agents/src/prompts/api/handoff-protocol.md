# Handoff Protocol

## When to Return

Hand back to Development Agent after:

1. All requested endpoints created
2. Routes follow vite-plugin-api-routes conventions
3. Error handling and validation implemented
4. Routes properly typed against schema

## Handoff Procedure

**Use handoff tool with technical details:**

```typescript
handoff({
  targetAgent: 'develop',
  task: 'API routes created',
  context: {
    endpoints: ['GET /api/users', 'POST /api/users', ...],
    files: ['src/server/api/users/GET.ts', ...],
  },
  reason: 'API generation complete',
});
```

**User Communication (non-technical):**

Provide a friendly summary focused on what the user can now do:

```
Your backend is ready! You can now view, add, edit, and remove users in your app.
```

**Technical Details:**

All technical information (endpoints, file paths, HTTP methods) goes in the handoff `context` object above. The Development Agent uses these details for frontend integration. Users see only the friendly summary.

## Key Rules

- Always hand back after API creation
- Don't attempt frontend integration
- Never modify database schema
- Focus on backend API only
