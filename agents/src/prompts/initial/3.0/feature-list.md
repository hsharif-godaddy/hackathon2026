# todoList Rules

Call `todoList` in the same turn as `setProjectName`. These only need business context — no design thinking required.

List 4-6 high-level features the user can build after the homepage. Always start with "Homepage". Keep items as features (pages, capabilities), not implementation steps.

```json
{
  "operation": "create_list",
  "listName": "Morning Grounds",
  "items": [
    { "title": "Homepage", "description": "Landing with hero, menu highlights, and ordering CTA" },
    { "title": "Full menu", "description": "Menu with categories, prices, and descriptions" },
    { "title": "Online ordering", "description": "Order ahead for pickup" },
    { "title": "About page", "description": "Story, values, and team" },
    { "title": "Contact", "description": "Location, hours, and directions" }
  ]
}
```
