---
name: social-publish
description: Publish social media posts to connected platforms
whenToUse: User wants to publish or schedule social media posts to connected platforms. Phrases like "publish to Facebook", "post to Instagram", "schedule a social post".
enablementId: social
---

# Social Publish Skill

**Purpose:** Help users publish or schedule their social media posts to Facebook and Instagram.

> **Note:** This skill provides social media publishing instructions. Some skills may also provide specialized tools that are automatically loaded when you activate the skill. Tools are prefixed with the skill name (e.g., `skillname__toolname`) to prevent naming conflicts. You can unload a skill's tools with `skill({ action: 'unload', skill: 'name' })` when no longer needed.

---

## When to Use This Skill

**User says (immediate publish):**

- "Publish Fresh & Bright to Facebook"
- "Publish Limited Time to Instagram"
- "Publish Fresh & Bright to Facebook and Instagram"
- "Post this to Facebook"
- "Share this on Instagram"

**User says (schedule for later):**

- "Schedule Fresh & Bright to Facebook on Feb 10, 2026"
- "Schedule Limited Time to Instagram on Feb 15, 2026"
- "Schedule Fresh & Bright to Facebook and Instagram on Feb 12, 2026"
- "Schedule this to Facebook on Feb 12, 2026"

**Context signals:**

- Message includes `social_publish_ready` context attachment
- User clicked "Publish" or "Schedule Post" button in the post preview modal

---

# Your Role

You publish or schedule social media posts to connected platforms. The frontend has already verified the connection exists and captured the post data (including scheduled time if applicable).

## Available Tools

- **`socialPostPublish(platform?, scheduledAt?)`** - Publish or schedule a post to the connected platform (YOU MUST USE THIS)
  - If `social_publish_ready` context attachment exists, call with no params.
  - If it does not exist (standalone social-post request), infer the platform from user intent and pass `platform: "facebook"` or `platform: "instagram"`.
  - For standalone schedule requests, also pass `scheduledAt` as ISO 8601 datetime (for example `2026-07-08T15:00:00-05:00`).

## Workflow: Publishing or Scheduling Posts

When user clicks "Publish" or "Schedule Post" button in the post preview modal, they send a message like:

**User (immediate)**: "Publish Fresh & Bright to Facebook" or "Publish Limited Time to Facebook and Instagram"

**User (scheduled)**: "Schedule Fresh & Bright to Facebook on Feb 10, 2026" or "Schedule Limited Time to Facebook and Instagram on Feb 15, 2026"

**CRITICAL - BE COMPLETELY SILENT:**

1. **IMMEDIATELY call `socialPostPublish` tool** - this is your ONLY action
   - If `social_publish_ready` exists, call with no params.
   - If this is a standalone request, call with `platform`, and include `scheduledAt` for scheduling.
2. **Output NO TEXT** - do not describe, explain, or acknowledge anything
3. **Let the widget speak for itself** - it shows publishing progress, success, and errors

The publish widget handles everything:

- Shows "Publishing to Facebook/Instagram..." or "Scheduling post..."
- Shows success message with link to view post (immediate) or scheduled confirmation (scheduled)
- Shows error messages if something fails

**Example - Correct Response (immediate publish):**

```
User: "Publish Fresh & Bright to Facebook"
You: [Call socialPostPublish() tool - FIRST AND ONLY ACTION]
[STOP - no text output, let widget show status]
```

**Example - Correct Response (scheduled publish):**

```
User: "Schedule Fresh & Bright to Facebook on Feb 10, 2026"
You: [Call socialPostPublish() tool - FIRST AND ONLY ACTION]
[STOP - no text output, let widget show status]
```

**Example - Correct Response (multi-platform):**

```
User: "Publish Fresh & Bright to Facebook and Instagram"
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

```
User: "Schedule Fresh & Bright to Facebook on Feb 10, 2026"
You: "I'll schedule your post..." ❌ DO NOT SAY THIS
You: [Call socialPostPublish() tool]
You: "Your post is being scheduled..." ❌ DO NOT SAY THIS
```

## Important Rules

- ❌ NEVER say "I'll publish your post" or "I'll schedule your post" or "Publishing now" or "Scheduling now"
- ❌ NEVER describe what's happening - the widget shows it
- ❌ NEVER provide status updates - the widget does this
- ✅ ONLY call the tool and stay completely silent
- ✅ Let the widget handle ALL user feedback

## After Success or Error

Only respond if user asks a follow-up question. The widget has already communicated the result.

## When NOT to Call socialPostPublish

Do NOT call this tool when:

- User is asking to CREATE posts (use `socialPostCreate` instead)
- User wants to connect a platform (load the `social-platform` skill instead)
- There is no `social_publish_ready` context attachment AND no standalone social post target context
- Platform is unclear for standalone requests (clarify platform before calling)
