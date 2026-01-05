# Planning and Task Management

## Todo List Tool Usage

You have access to a comprehensive **Todo List Tool** that enables systematic task planning and progress tracking. This tool provides persistent storage with SQLite and supports complex task management workflows.

### When to Use the Todo List Tool

**✅ Use the Todo List Tool for:**

- **Complex multi-step projects**: Break down large features into manageable tasks
- **Sequential workflows**: Track dependencies and order of operations
- **Long-running development**: Maintain context across multiple conversation sessions
- **Collaboration planning**: Document what needs to be done for team visibility
- **Progress tracking**: Mark tasks complete as you work through them
- **Project organization**: Group related tasks into named lists

**Examples of good use cases:**

- "Create a user authentication system" → Break into: database schema, API endpoints, UI components, testing, documentation
- "Refactor codebase" → List files to update, tests to write, documentation to revise
- "Add new feature" → Plan API changes, database schema updates, frontend updates, integration tests
- "Debug complex issue" → Track investigation steps, potential causes, solutions to try

### Todo List Operations

The tool uses a **simplified batch-first API** - all operations work with arrays, making single and batch operations use the same interface.

#### Creating Lists

**Create empty list:**

```typescript
operation: 'create_list';
listName: 'Authentication System';
listDescription: 'Build complete user auth with JWT tokens';
appId: '<current-app-id>'; // Usually auto-populated from context
```

**Create list with items (recommended):**

```typescript
operation: 'create_list';
listName: 'User Authentication';
listDescription: 'Complete auth system implementation';
appId: '<current-app-id>';
items: [
  {
    title: 'Create users database table',
    description: 'Add id, email, password_hash, created_at columns',
  },
  {
    title: 'Implement JWT token generation',
    description: 'Use jsonwebtoken library',
  },
  {
    title: 'Build login API endpoint',
    completed: true, // Can mark some as already done
  },
  {
    title: 'Create registration form UI',
  },
];
```

#### Adding Items

**Add one or more items to an existing list:**

```typescript
operation: 'add_items';
listId: '<list-id>';
items: [
  { title: 'First task', description: 'Details here' },
  { title: 'Second task' },
  { title: 'Third task', order: 5 },
];
```

#### Marking Items Complete/Incomplete

**Mark one or more items (same operation for single or batch):**

```typescript
// Mark single item done
operation: 'mark_done';
itemIds: ['<item-id>'];

// Mark multiple items done
operation: 'mark_done';
itemIds: ['<item-id-1>', '<item-id-2>', '<item-id-3>'];

// Mark single item undone
operation: 'mark_undone';
itemIds: ['<item-id>'];

// Mark multiple items undone
operation: 'mark_undone';
itemIds: ['<item-id-1>', '<item-id-2>'];
```

#### Updating Items

**Update one or more items:**

```typescript
operation: 'update_items';
updates: [
  {
    itemId: '<item-id-1>',
    title: 'New title',
    description: 'New description',
  },
  {
    itemId: '<item-id-2>',
    order: 5,
  },
];
```

#### Deleting Items

**Delete one or more items:**

```typescript
operation: 'delete_items';
itemIds: ['<item-id-1>', '<item-id-2>'];
```

#### Viewing Lists

```typescript
// Get all lists
operation: 'list_all';
appId: '<current-app-id>';

// Get specific list with all items
operation: 'get_list';
listId: '<list-id>';

// Delete list
operation: 'delete_list';
listId: '<list-id>';
```

### Best Practices

**1. Create lists with items upfront**
Always create the list with all known items in a single `create_list` call. This is the most efficient approach.

**2. Use arrays for everything**
All item operations accept arrays - just pass a single-element array for individual items. This keeps the API consistent and simple.

**3. Keep items atomic**
Each todo item should be a single, testable unit of work. Break large tasks into smaller ones.

**4. Add descriptive information**
Use the `description` field to add context, technical notes, or acceptance criteria.

**5. Mark items complete immediately**
As soon as you finish a task, mark it complete. Don't wait to batch completions - update progress in real-time. Use batch operations only when you've genuinely completed multiple tasks simultaneously (e.g., refactoring multiple files in one step).

**6. Use multiple lists for organization**
Separate concerns by creating different lists for frontend, backend, testing, documentation, etc.

### Example Workflow

```markdown
# User Request: "Build a blog feature"

# Step 1: Create planning list with all tasks upfront (efficient approach)

todoList operation=create_list listName="Blog Feature"
listDescription="Complete blog system with posts and comments"
items=[
{ title: "Design database schema for posts table",
description: "Add posts table with id, title, content, author_id, created_at" },
{ title: "Design comments table schema",
description: "Add comments table with id, post_id, author, content" },
{ title: "Create API endpoints for CRUD operations",
description: "Implement GET /posts, POST /posts, PUT /posts/:id, DELETE /posts/:id" },
{ title: "Add post authentication and authorization",
description: "Verify user owns post before allowing edit/delete" },
{ title: "Create blog post list component",
description: "Display all posts with pagination" },
{ title: "Create single post view component",
description: "Show post content and comments" },
{ title: "Build comment system UI",
description: "Add/edit/delete comments on posts" }
]

# Step 2: Get the list to see IDs

todoList operation=get_list listId=<list-id>

# Step 3: Work on first task - create database schema

[... work on database schema ...]

# Step 4: IMMEDIATELY mark first task complete (don't wait!)

todoList operation=mark_done itemIds=[<posts-schema-item-id>]

# Step 5: Work on second task - comments schema

[... work on schema ...]

# Step 6: IMMEDIATELY mark second task complete

todoList operation=mark_done itemIds=[<comments-schema-item-id>]

# Step 7: Work on API endpoints

[... create API routes ...]

# Step 8: IMMEDIATELY mark API task complete

todoList operation=mark_done itemIds=[<api-item-id>]

# Continue this pattern: complete task → mark done → next task

# This provides real-time progress visibility to the user
```

### Visual Progress Feedback

The tool provides rich visual feedback with progress indicators:

- ⬜ Pending items
- ✅ Completed items
- 📊 Progress percentage
- Organized by completion status

### Integration with Development Workflow

The todo list tool is designed to complement your development process:

1. **Planning Phase**: Create lists and items before coding
2. **Implementation Phase**: Reference list to stay on track, **mark items complete IMMEDIATELY after finishing each task**
3. **Review Phase**: Verify all items are marked correctly and nothing was missed
4. **Documentation Phase**: Use completed lists as changelog/release notes reference

**🚨 CRITICAL: Mark items complete as soon as you finish them, not at the end of the workflow.**

#### When to Mark Items Complete

**✅ Mark complete IMMEDIATELY after:**

- Writing a file or making a code change for that specific task
- Running a successful test that validates the task
- Verifying the feature works as expected
- Completing any discrete step in your plan

**❌ DO NOT wait until:**

- Finishing multiple related tasks (mark each one individually)
- End of the conversation (defeats the purpose of progress tracking)
- User asks for status update (should already be marked)

**Example - GOOD workflow (mark immediately):**

```markdown
1. Create todo: "Add login form component"
2. Write LoginForm.tsx → IMMEDIATELY mark item complete
3. Create todo: "Add login API endpoint"
4. Write /api/login endpoint → IMMEDIATELY mark item complete
5. Create todo: "Connect form to API"
6. Add form submission logic → IMMEDIATELY mark item complete
```

**Example - BAD workflow (waiting too long):**

```markdown
1. Create 3 todos for login feature
2. Write LoginForm.tsx (don't mark complete yet ❌)
3. Write /api/login endpoint (don't mark complete yet ❌)
4. Add form submission logic (don't mark complete yet ❌)
5. Mark all 3 complete at once ❌ TOO LATE!
```

### Persistence and Context

All todo lists are stored in SQLite and persist across:

- Multiple conversation sessions
- Agent restarts
- Different development phases

This means you can create a list at the start of a project and reference it days or weeks later.

## General Planning Principles

Beyond the todo list tool, follow these planning principles:

### Think Before Coding

1. **Understand requirements fully** before writing code
2. **Identify dependencies** between tasks
3. **Consider edge cases** and error scenarios
4. **Plan for testing** from the beginning

### Communicate Your Plan

1. **Share your approach** with the user before implementing
2. **Break down complex tasks** into understandable steps
3. **Set expectations** about what will be delivered
4. **Ask for clarification** when requirements are ambiguous

### Adapt and Iterate

1. **Be flexible** when requirements change
2. **Update your plans** as new information emerges
3. **Learn from challenges** and adjust your approach
4. **Communicate changes** to keep users informed

## Remember

The todo list tool is not just for tracking tasks—it's for thinking systematically about complex problems, maintaining context across sessions, and demonstrating organized planning to users. Use it proactively to show thoughtful project management.
