# Skills System - CRITICAL WORKFLOW

**🚨 MANDATORY: ALWAYS CHECK FOR SKILLS BEFORE IMPLEMENTING ANYTHING! 🚨**

**Your workflow for EVERY user request:**

```
1. User requests feature
   ↓
2. IMMEDIATELY call: skill({ action: "list" })
   ↓
3. Is there a skill for this?
   ├─ YES → Load and follow it
   └─ NO  → Implement normally
```

**Why check skills first:**

- ✅ Battle-tested templates and patterns
- ✅ Faster implementation (direct file copying)
- ✅ Consistent quality across all projects
- ✅ Saves tokens and reduces errors
- ✅ You avoid reinventing the wheel

**Skill actions:**

- `skill({ action: "list" })` - Show all available skills
- `skill({ action: "load", skill: "name" })` - Get skill instructions
- `skill({ action: "install", skill: "name" })` - Copy template files directly

---

## Common User Requests → Skills Mapping

| User Says                   | Skill to Use   | Action                  |
| --------------------------- | -------------- | ----------------------- |
| "Add a blog"                | `blog`         | Setup blog system       |
| "Create blog posts"         | `blog-writing` | Write blog content      |
| "Write a blog post about X" | `blog-writing` | Create post content     |
| "Add authentication"        | _(check list)_ | If skill exists, use it |
| "Create a payment form"     | _(check list)_ | If skill exists, use it |

**Always check `skill({ action: "list" })` to discover available skills.**

---

## Example: Blog Feature Request

**❌ WRONG APPROACH:**

```
User: "Add a blog"
You: [Creates blog pages from scratch without checking skills]
```

**✅ CORRECT APPROACH:**

```
User: "Add a blog"
You:
  1. skill({ action: "list" })
     → Returns: [
     {"name": "blog", "description": "This skill is ONLY for setting up the blog system. For creating blog post content, use the `blog-writing` skill."},
     {"name": "blog-writing", "description": "Create blog post content for sites with blog system installed"}
     ]

  2. skill({ action: "load", skill: "blog" })
     → Get setup instructions

  3. skill({ action: "install", skill: "blog" })
     → Copy template files

  4. Follow remaining steps from skill instructions
```

---

## Example: Blog Content Request

**❌ WRONG APPROACH:**

```
User: "Write a blog post about fitness"
You: [Creates markdown file with wrong field names]
```

**✅ CORRECT APPROACH:**

```
User: "Write a blog post about fitness"
You:
  1. skill({ action: "list" })
     → Returns: [
     {"name": "blog", "description": "This skill is ONLY for setting up the blog system. For creating blog post content, use the `blog-writing` skill."},
     {"name": "blog-writing", "description": "Create blog post content for sites with blog system installed"}
     ]

  2. skill({ action: "load", skill: "blog-writing" })
     → Get content creation instructions with CORRECT field names

  3. Follow instructions:
     - Call mediaSearch for Getty Images
     - Use publishedAt (NOT date)
     - Use featuredImage (NOT coverImage)
     - Create properly formatted markdown file
```

---

## When No Skill Exists

If `skill({ action: "list" })` doesn't show a relevant skill:

✅ **Proceed with normal implementation**

- Use your knowledge and best practices
- Build from scratch using appropriate tools
- Follow project standards and patterns

**The key: ALWAYS CHECK FIRST, then decide.**
