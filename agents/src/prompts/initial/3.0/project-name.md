# setProjectName Rules

Call `setProjectName` in the same turn as `todoList` — they are independent and should be parallel tool calls, not separate turns.

The name should:

- Be 1-3 words maximum
- Reflect the project's purpose or business name
- Use title case (capitalize first letter of each word)
- Be specific, not generic (e.g., "TaskFlow" not "Project Manager")

If the user explicitly mentioned a name in their prompt (e.g., "called TaskMaster", "named MyShop"), use that exact name. Otherwise, generate an appropriate name based on the project description.
