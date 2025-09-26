## API Development - USE THE AUTO API GENERATOR TOOL!

**🚨 CRITICAL: For ALL API creation tasks, use the `auto_api_generator` tool instead of manually writing endpoints!**

**⚠️ PREREQUISITE: Database and migrations MUST be run first before using `analyze_schema` or `generate_endpoints` operations. Tables must exist in the database to be analyzed or have APIs generated for them.**

### When to Use the Auto API Generator Tool

Use this tool for ANY API-related request:

- **Contact forms** and form submission endpoints
- **User registration** and authentication APIs
- **Data retrieval APIs** (products, orders, content, etc.)
- **CRUD operations** on any database table
- **Selective APIs** (read-only, create-only, etc.)
- **Admin panels** requiring data management

### Tool Usage Patterns

#### 1. Analyze Database Schema First (After DB & Migrations)

```
operation: "analyze_schema"
database: { host, port, user, password, database }
```

**NOTE**: Database tables must exist before running this analysis!

#### 2. Generate TypeScript Types

```
operation: "generate_types"
database: { host, port, user, password, database }
tables: ["users", "products"]
outputDir: "src/types"
```

#### 3. Create Selective API Endpoints (After DB & Migrations)

```
operation: "generate_endpoints"
database: { host, port, user, password, database }
tables: ["contacts"]
operations: ["create", "read_all"]  // Only what's needed!
framework: "hono"
generateTypes: true
```

**NOTE**: Specified tables must exist in the database before generating endpoints!

### Common Operation Combinations

- **Contact Forms**: `["create", "read_all"]` - submit + admin view
- **Read-Only APIs**: `["read", "read_all"]` - display data only
- **Data Collection**: `["create"]` - forms, surveys, signups
- **Full Management**: `["create", "read", "read_all", "update", "delete"]` - admin panels
- **User Profiles**: `["read", "update"]` - view + edit own data

### Benefits of Using the Tool

✅ **Type-safe validation** with auto-generated Zod schemas  
✅ **Proper error handling** and database connection management  
✅ **TypeScript interfaces** for all data structures  
✅ **Consistent API patterns** across entire application  
✅ **Auto-generated documentation** with endpoint descriptions  
✅ **Framework-specific code** (Hono.js optimized)  
✅ **Only generates needed operations** - no unnecessary endpoints

### Database Configuration Discovery

The tool can auto-discover database configuration from:

- `.env` files (DB_HOST, DB_USER, DB_PASS, DB_NAME)
- `src/services/database.ts` files
- Other common configuration locations
