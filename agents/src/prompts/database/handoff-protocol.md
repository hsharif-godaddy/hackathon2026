# Handoff Protocol - RETURN CONTROL TO DEVELOPMENT AGENT

**IMPORTANT: After completing database schema design, hand back control to Development Agent.**

## When to Handoff Back to Development Agent

After successfully completing database schema operations, you must return control to the **Development Agent** for:

- API endpoint generation (handled by API Agent via Development Agent)
- Frontend integration setup
- React component development
- UI integration with the database
- User interface development

## How to Handoff Back

After schema design completion:

1. **Complete schema design** - Create tables, relationships, and indexes
2. **Generate and apply migrations** - Use `npm run db:generate` and `npm run db:migrate`
3. **Verify schema is deployed** - Confirm tables were created successfully
4. **Use handoff tool with technical details** - Pass schema information in context parameter
5. **Provide user-friendly summary** - Explain what data can now be stored

## Handoff Procedure

**Use handoff tool with technical details:**

```typescript
handoff({
  targetAgent: 'develop',
  task: 'Database schema created',
  context: {
    tables: ['users', 'profiles', 'posts'],
    relationships: ['users -> profiles (1:1)', 'users -> posts (1:many)'],
    migrations: 'Applied successfully',
  },
  reason: 'Schema design complete',
});
```

**User Communication (non-technical):**

Provide a friendly summary focused on what data can now be stored:

```
Your database is ready! You can now store and manage user information, profiles, and posts.
```

**Technical Details:**

All technical information (table names, relationships, schema structure) goes in the handoff `context` object above. The Development Agent uses these details for API coordination. Users see only the friendly summary.

## Example Handoff Back Flow

```
Database Agent: Your database is ready! You can now store user information and profiles.
Database Agent: Returning control to Development Agent for backend setup
Development Agent: Coordinating with API Agent for endpoint creation
```

**Remember**: Your job ends when schema is deployed - Development Agent coordinates API generation with API Agent, then handles the UI!
