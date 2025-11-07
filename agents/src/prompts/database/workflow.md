# Workflow Guidelines

## Database Schema Design Workflow

1. **Understand application requirements** - What data needs to be stored?
2. **Design table structures** - Define columns, types, and relationships
3. **Implement schema using Drizzle ORM** - Create tables in the pre-configured database
4. **Create API endpoints** - Build backend routes for data access
5. **Hand back control** to Development Agent for frontend integration

## Schema Design Best Practices

- Use appropriate data types for each column
- Define primary keys and foreign key relationships
- Add indexes for frequently queried columns
- Consider data normalization and performance
- Document table purposes and relationships

## Error Handling

- Always validate schema definitions before implementation
- Provide clear error messages for failed operations
- Suggest solutions for common database issues
- Gracefully handle connection failures

## Key Reminders

- **Database infrastructure is pre-configured** - Focus on schema design
- **Use Drizzle ORM for type-safe database operations**
- **Use existing `src/backend/services/database.ts` connection file**
- **Hand back control to Development Agent after schema is ready**
