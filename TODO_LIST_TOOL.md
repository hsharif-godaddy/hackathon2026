---
status: implemented
---

# Todo List Tool - Implementation Summary

## Overview

A comprehensive planning tool for the Airo AI Builder's develop agent with a **simplified batch-first API**. Enables systematic task management with persistent SQLite storage using a unified array-based interface that works for single and multiple items.

## Quick Start

```typescript
// 1. Create a project plan with all tasks
create_list(
  name: 'My Feature',
  items: [
    { title: 'Task 1', description: 'Details' },
    { title: 'Task 2' },
    { title: 'Task 3' }
  ]
)

// 2. Mark tasks done (single or multiple - same API)
mark_done(itemIds: ['id-1', 'id-2'])

// 3. Add more tasks later
add_items(listId: 'list-id', items: [{ title: 'New task' }])

// 4. View progress
get_list(listId: 'list-id')
```

## Features

### Core Operations

1. **List Management**
   - Create new todo lists with name and description
   - **Create lists with items in one call** (batch creation)
   - Get specific lists with all items
   - List all todo lists (optionally filtered by appId)
   - Delete todo lists

2. **Item Management** (All batch-capable)
   - Add one or more items with `add_items`
   - Update one or more items with `update_items`
   - Mark one or more items done/undone with `mark_done`/`mark_undone`
   - Delete one or more items with `delete_items`
   - All operations use arrays - works for single or multiple items

3. **Progress Tracking**
   - Visual progress indicators (⬜ pending, ✅ complete)
   - Progress percentage calculation
   - Organized display by completion status
   - Item ordering and prioritization

### Simplified Batch-First API

The tool uses a **unified batch-first design** - all operations accept arrays:
- **Create list with items**: Define entire project structure in one call
- **Add items**: Add one or more items using the same operation
- **Mark done/undone**: Works for single or multiple items with same API
- **Update items**: Update one or more items in a single call
- **Delete items**: Delete one or more items at once

**Key benefit**: No need to remember separate operations for single vs. batch - just use arrays everywhere!

### Persistence

- All data stored in SQLite database (`apps.db`)
- Persists across conversation sessions
- Survives agent restarts
- Supports multiple concurrent lists per app

## Implementation Files

### Repository Layer
- **`agents/src/database/repositories/TodoListRepository.ts`**
  - Repository class for all database operations
  - Database schema initialization
  - CRUD operations for lists and items
  - Follows repository pattern used throughout the codebase

### Core Tool Implementation
- **`agents/src/tools/todo-list-tool.ts`**
  - Main tool class with all CRUD operations
  - Delegates to TodoListRepository for data access
  - Result formatting and error handling

### AI-Lib Integration
- **`agents/src/tools/ai-lib-tools/todo-list.ts`**
  - Wrapper for AI SDK integration
  - Rich formatted output with markdown
  - Visual progress indicators

### Database Integration
- **`agents/src/database/repositories/index.ts`**
  - Exports TodoListRepository singleton
  - Registered with other repositories

### Agent Configuration
- **`agents/src/agents/develop-agent.ts`**
  - Added `todoList` tool to develop agent
  - Included in planning tools group

### Prompts and Documentation
- **`agents/src/prompts/develop/planning.md`**
  - Comprehensive guide for when and how to use todo lists
  - Best practices and example workflows
  - Integration with development process

- **`agents/src/prompts/develop/README.md`**
  - Updated to document the planning.md section

### Tool Registry
- **`agents/src/tools/ai-lib-tools/index.ts`**
  - Exported `todoListAITool`
  - Added to `allAILibTools` registry
  - Added to `planning` tool group

### Tests
- **`agents/src/tools/__tests__/todo-list-tool.test.ts`**
  - Comprehensive test suite with 8 tests
  - All tests passing
  - Covers all major operations

## Architecture

The todo list feature follows a clean layered architecture:

1. **Repository Layer** (`TodoListRepository`)
   - Handles all database operations
   - Manages schema initialization
   - Provides type-safe data access methods

2. **Tool Layer** (`TodoListTool`)
   - Implements business logic
   - Validates input parameters
   - Delegates to repository for data operations
   - Formats results for the agent

3. **AI Integration Layer** (`todoListAITool`)
   - Converts tool results to rich markdown
   - Provides visual progress indicators
   - Integrates with AI SDK

## Database Schema

The schema is automatically initialized by the `TodoListRepository` constructor:

### `todo_lists` Table
```sql
CREATE TABLE todo_lists (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```

### `todo_items` Table
```sql
CREATE TABLE todo_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  completed INTEGER DEFAULT 0,
  item_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (list_id) REFERENCES todo_lists(id) ON DELETE CASCADE
)
```

### Indexes
- `idx_todo_lists_app_id` on `todo_lists(app_id)`
- `idx_todo_items_list_id` on `todo_items(list_id)`
- `idx_todo_items_completed` on `todo_items(completed)`

## Direct Repository Usage

The repository can be used directly outside of the tool for programmatic access:

```typescript
import { todoListRepository } from '../database/repositories'

// Create a list
const list = todoListRepository.createList('My List', 'app-id')

// Add items
const item = todoListRepository.addItem(list.id, 'Task 1', 'Description')

// Mark complete
todoListRepository.markItemCompleted(item.id, true)

// Get list with items
const fullList = todoListRepository.getListById(list.id)
```

## Usage Examples

### Creating a List (Simple)
```typescript
{
  operation: 'create_list',
  listName: 'Authentication System',
  listDescription: 'Build complete user auth with JWT',
  appId: '<app-id>'
}
```

### Creating a List with Items (Batch - Recommended)
```typescript
{
  operation: 'create_list',
  listName: 'User Authentication',
  listDescription: 'Complete auth implementation',
  appId: '<app-id>',
  items: [
    {
      title: 'Create users database table',
      description: 'Add id, email, password_hash columns'
    },
    {
      title: 'Implement JWT token generation',
      description: 'Use jsonwebtoken library'
    },
    {
      title: 'Build login API endpoint'
    },
    {
      title: 'Create registration form UI'
    }
  ]
}
```

### Adding Items (Single or Multiple)
```typescript
{
  operation: 'add_items',
  listId: '<list-id>',
  items: [
    {
      title: 'Create users table',
      description: 'Add id, email, password_hash columns'
    },
    {
      title: 'Build auth middleware'
    }
  ]
}
```

### Marking Items Complete (Single or Multiple)
```typescript
// Single item
{
  operation: 'mark_done',
  itemIds: ['<item-id>']
}

// Multiple items
{
  operation: 'mark_done',
  itemIds: ['<item-id-1>', '<item-id-2>', '<item-id-3>']
}
```

### Marking Items Incomplete (Single or Multiple)
```typescript
{
  operation: 'mark_undone',
  itemIds: ['<item-id-1>', '<item-id-2>']
}
```

### Updating Items (Single or Multiple)
```typescript
{
  operation: 'update_items',
  updates: [
    {
      itemId: '<item-id-1>',
      title: 'New title',
      description: 'New description'
    },
    {
      itemId: '<item-id-2>',
      order: 3
    }
  ]
}
```

### Deleting Items (Single or Multiple)
```typescript
{
  operation: 'delete_items',
  itemIds: ['<item-id-1>', '<item-id-2>']
}
```

### Viewing Progress
```typescript
{
  operation: 'get_list',
  listId: '<list-id>'
}
```

## Output Format

The tool provides rich visual feedback:

```markdown
✅ **Todo List GET LIST**

📋 **List: Authentication System**
*Build complete user auth with JWT*

**Items:**

**Pending (2):**
1. ⬜ Create users table
   *Add id, email, password_hash columns*
   `ID: 1234-abcd`
2. ⬜ Implement JWT middleware
   `ID: 5678-efgh`

**Completed (1):**
1. ✅ ~~Design database schema~~
   `ID: 9012-ijkl`

**Progress:** 1/3 complete (33%)

`List ID: list-1234`
```

## Integration with Develop Agent

The todo list tool is now:

1. ✅ **Registered** in the develop agent's tool collection
2. ✅ **Documented** in the agent's system prompt (`planning.md`)
3. ✅ **Encouraged** for use in complex development workflows
4. ✅ **Tested** with comprehensive test suite
5. ✅ **Integrated** with SQLite for persistence

## When Agents Should Use This Tool

The prompt guidance encourages agents to use todo lists for:

- Complex multi-step projects
- Sequential workflows with dependencies
- Long-running development tasks
- Project organization and planning
- Progress tracking across sessions
- Breaking down large features into manageable tasks

## Testing

All 11 tests pass successfully:

```
✓ should create a new todo list
✓ should add items to a todo list
✓ should mark items as done
✓ should list all todo lists
✓ should get a specific list with items
✓ should update todo items
✓ should delete todo items
✓ should delete todo lists
✓ should create a list with items in one operation
✓ should mark multiple items as done
✓ should mark multiple items as undone
```

Run tests with:
```bash
cd agents && npm test -- todo-list-tool.test.ts
```

## Build Status

✅ TypeScript compilation passes without errors
✅ All linter checks pass
✅ All tests pass

## API Design Philosophy

### Batch-First Simplicity

The tool uses a **unified array-based API** that eliminates the complexity of separate single vs. batch operations.

**Key Principle:** All item operations accept arrays - whether you're working with one item or many, you use the same operation.

### Simplified Operations

**Only 9 operations total:**

**List Operations (4):**
- `create_list` - Create list (optionally with items)
- `get_list` - Get a specific list
- `list_all` - Get all lists
- `delete_list` - Delete a list

**Item Operations (5):**
- `add_items` - Add one or more items (array)
- `update_items` - Update one or more items (array)
- `delete_items` - Delete one or more items (array)
- `mark_done` - Mark one or more items complete (array)
- `mark_undone` - Mark one or more items incomplete (array)

### Consistency Benefits

✅ **Simpler to learn**: One operation for both cases
✅ **Easier to use**: Just put single items in an array
✅ **Future-proof**: Easy to batch operations later without API changes
✅ **Less cognitive load**: No need to remember `mark_done` vs `mark_many_done`

### Example Comparison

**Single item:**
```typescript
// Mark one item
{ operation: 'mark_done', itemIds: ['item-123'] }
```

**Multiple items:**
```typescript
// Mark three items - SAME operation, just more IDs
{ operation: 'mark_done', itemIds: ['item-123', 'item-456', 'item-789'] }
```

## API Summary

### Complete Operation List

| Operation | Parameters | Description |
|-----------|------------|-------------|
| `create_list` | `listName`, `listDescription?`, `items?`, `appId?` | Create list, optionally with initial items |
| `get_list` | `listId` | Get list with all items |
| `list_all` | `appId?` | Get all lists (optionally filtered) |
| `delete_list` | `listId` | Delete list and all items |
| `add_items` | `listId`, `items[]` | Add one or more items |
| `update_items` | `updates[]` | Update one or more items |
| `delete_items` | `itemIds[]` | Delete one or more items |
| `mark_done` | `itemIds[]` | Mark one or more items complete |
| `mark_undone` | `itemIds[]` | Mark one or more items incomplete |

### Parameter Types

```typescript
// Item creation
items: [{ 
  title: string
  description?: string
  completed?: boolean
  order?: number
}]

// Item updates
updates: [{
  itemId: string
  title?: string
  description?: string
  order?: number
}]

// Item IDs for batch operations
itemIds: string[]
```

## Future Enhancements

Potential improvements:
- Due dates for items
- Priority levels (high/medium/low)
- Tags/categories for grouping
- Item dependencies
- Subtasks/hierarchical items
- Time estimates
- Assignees (for team collaboration)
- List templates
- Search and filtering

## Notes

- **Unified array-based API** - all item operations use arrays for consistency
- All operations return consistent result structures
- Error handling is robust with descriptive messages
- SQLite foreign key constraints ensure data integrity (CASCADE delete)
- Items are ordered by `item_order` field for custom prioritization
- Schema is automatically initialized on first use
