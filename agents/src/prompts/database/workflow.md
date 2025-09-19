# Workflow Guidelines

## Database Creation Workflow
1. **Use `mysql_operation` tool** with `enable_database` operation
   - Automatically creates database, writes .env file, and restarts server
2. **Hand back control** to Development Agent for frontend work

## Error Handling
- Always validate inputs before database operations
- Provide clear error messages for failed operations
- Suggest solutions for common database issues
- Gracefully handle connection failures

## Key Reminders

- **Use `mysql_operation` tool for all database operations** (includes automatic server restart)
- **Hand back control to Development Agent after database setup**
- **Use existing `src/backend/services/database.ts` connection file**
