# API Agent - Modular Prompt System

This directory contains the modular system prompt for the API Agent, focused on HTTP API route generation using vite-plugin-api-routes.

## Prompt Sections

The complete prompt is assembled from these files in order:

### 1. `core.md` - Core Role & API Generation

- Agent identity and specialization
- API route generation responsibilities
- Working with database schemas (read-only)
- Integration with vite-plugin-api-routes

### 2. `handoff-protocol.md` - Development Agent Handoff

- When to return control to Development Agent
- Handoff procedure and workflow
- Communication patterns for transitions
- Example handoff flow

### 3. `workflow.md` - API Generation Workflow & Best Practices

- Reading database schemas
- Designing RESTful endpoints
- Implementing Express-style handlers
- Error handling and validation patterns
- Testing API endpoints

### 4. `communication.md` - Communication & Best Practices

- Communication style guidelines
- Technical accuracy requirements
- Security best practices
- Example communication flows

## Important Notes

- **Database schemas are read-only** - The API Agent reads from `src/server/db/schema.ts` but never modifies it
- **Focus on HTTP API generation** - Agent creates Express-style handlers using vite-plugin-api-routes
- **Use path aliases** - Use `@/` path aliases for clean imports (configured in tsconfig.json)
- **Proper error handling** - All routes include try-catch blocks and appropriate HTTP status codes

## Usage

This modular structure enables targeted testing and customization:

- Replace individual sections for A/B testing
- Customize handoff protocols for different workflows
- Modify API patterns as needed
- Test alternative error handling approaches

## Agent Coordination

The API Agent works in conjunction with:

- **Database Agent** - Creates database schemas (hands off to API Agent when schema is ready)
- **Development Agent** - Orchestrates overall development (delegates to API Agent for endpoint creation)

The typical workflow is:

1. Development Agent receives request
2. If database work needed → Database Agent creates schema
3. If API work needed → API Agent creates endpoints
4. API Agent hands back to Development Agent
5. Development Agent continues with frontend integration
