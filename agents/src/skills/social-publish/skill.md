---
name: social-publish
description: Publish social media posts to connected platforms
enablementId: social
---

# Social Publish Skill

**Purpose:** Help users publish their social media posts to Facebook and Instagram.

> **Note:** This skill provides social media publishing instructions. Some skills may also provide specialized tools that are automatically loaded when you activate the skill. Tools are prefixed with the skill name (e.g., `skillname__toolname`) to prevent naming conflicts. You can unload a skill's tools with `skill({ action: 'unload', skill: 'name' })` when no longer needed.

---

## When to Use This Skill

**User says:**

- "Publish Fresh & Bright to Facebook"
- "Publish Limited Time to Instagram"
- "Post this to Facebook"
- "Share this on Instagram"

**Context signals:**

- Message includes `social_publish_ready` context attachment
- User clicked "Publish" button in the post preview modal

---

# Your Role

You publish social media posts to connected platforms. The frontend has already verified the connection exists and captured the post data.

## Available Tools

- **`socialPostPublish()`** - Publish a post to the connected platform (YOU MUST USE THIS)

## Workflow: Publishing Posts

When user clicks "Publish" button in the post preview modal, they send a message like:

**User**: "Publish Fresh & Bright to Facebook" or "Publish Limited Time to Instagram"

**CRITICAL - BE COMPLETELY SILENT:**

1. **IMMEDIATELY call `socialPostPublish()` tool** - this is your ONLY action
2. **Output NO TEXT** - do not describe, explain, or acknowledge anything
3. **Let the widget speak for itself** - it shows publishing progress, success, and errors

The publish widget handles everything:

- Shows "Publishing to Facebook/Instagram..."
- Shows success message with link to view post
- Shows error messages if something fails

**Example - Correct Response:**

```
User: "Publish Fresh & Bright to Facebook"
You: [Call socialPostPublish() tool - FIRST AND ONLY ACTION]
[STOP - no text output, let widget show status]
```

**Example - WRONG Response:**

```
User: "Publish Fresh & Bright to Facebook"
You: "I'll publish your post now..." ❌ DO NOT SAY THIS
You: [Call socialPostPublish() tool]
You: "Your post is being published..." ❌ DO NOT SAY THIS
```

## Important Rules

- ❌ NEVER say "I'll publish your post" or "Publishing now"
- ❌ NEVER describe what's happening - the widget shows it
- ❌ NEVER provide status updates - the widget does this
- ✅ ONLY call the tool and stay completely silent
- ✅ Let the widget handle ALL user feedback

## After Success or Error

Only respond if user asks a follow-up question. The widget has already communicated the result.

## When NOT to Call socialPostPublish

Do NOT call this tool when:

- User is asking to CREATE posts (use `socialPostCreate` instead)
- User wants to connect a platform (use `socialConnect` instead)
- There is no `social_publish_ready` context attachment
