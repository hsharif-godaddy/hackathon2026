---
name: social-platform
description: Connect and manage social media platform integrations
enablementId: social
---

# Social Platform Integration Skill

**Purpose:** Help users connect and manage their social media platform accounts.

> **Note:** This skill provides social platform integration instructions. Some skills may also provide specialized tools that are automatically loaded when you activate the skill. Tools are prefixed with the skill name (e.g., `skillname__toolname`) to prevent naming conflicts. You can unload a skill's tools with `skill({ action: 'unload', skill: 'name' })` when no longer needed.

---

## When to Use This Skill

**User says:**

- "Connect my Facebook"
- "Connect my Instagram"
- "Link my social accounts"

---

# Your Role

You have social media management tools available. Use them to help users connect their social media accounts.

## Available Tools

- **`socialConnect({ platform })`** - Connect a social platform via OAuth (YOU MUST USE THIS)

## Connecting Platforms

**CRITICAL: When a user asks to connect ANY platform, IMMEDIATELY call the `socialConnect` tool. Do NOT explain, do NOT check first - JUST CALL THE TOOL.**

**Trigger phrases (ALL require immediate socialConnect call):**

- "Connect my [platform]"
- "Connect [platform]"
- "Add [platform]"
- "Link my [platform]"
- "Set up [platform]"

**Platform name mapping (use these exact values):**

- Facebook → platform="facebook"
- Instagram → platform="instagram"

**Examples:**

User: "Connect my Facebook"
You: [Call socialConnect({ platform: "facebook" }) - FIRST ACTION]
[UI shows OAuth button automatically]
[Say NOTHING - widget handles everything]

User: "Add Instagram"
You: [Call socialConnect({ platform: "instagram" }) - FIRST ACTION]
[UI shows OAuth button automatically]
[Say NOTHING - widget handles everything]

## Available Social Platforms

- **Facebook** - Facebook Pages (requires page selection during auth)
- **Instagram** - Instagram Business accounts (connected via Facebook page)

## Tool Response Patterns

### If authRequired: true

The UI automatically shows an OAuth button. You do not need to say anything - just let the tool result speak for itself.

### If already connected

Tool returns `{ success: true, connected: true }`. Respond: "Already connected!"

### After user authenticates

User will tell you "done" or "connected". Respond: "Successfully connected!"

## OAuth Flow

1. Call `socialConnect({ platform: "facebook" })`
2. If `authRequired: true` → UI shows button, you stay silent
3. User clicks button, authenticates in popup
4. User says "done" → You confirm success

## Platform Authentication Notes

### Facebook & Instagram

- User must select which Facebook page during authentication
- Instagram requires a Facebook page connection

## Tool Usage Summary

**`socialConnect({ platform })`**

- Initiates OAuth flow for platform connection
- Use to connect social platforms
- Shows OAuth button widget automatically

## Important Rules

1. **Stay silent with widgets** - Let OAuth buttons speak for themselves
2. **Wait for user confirmation** - After user authenticates, they will confirm completion
