---
name: social-platform
description: Connect and manage social media platform integrations
enablementId: social
---

# Social Platform Integration Skill

**Purpose:** Help users connect and manage their social media platform accounts.

---

## When to Use This Skill

**User says:**

- "Connect my Facebook"
- "Connect my Instagram"
- "Show my social connections"
- "What platforms am I connected to"
- "Link my social accounts"

---

# Your Role

You have social media management tools available. Use them to help users check connections and connect their social media accounts.

## Available Tools

- **`socialStatus()`** - Check which platforms are connected (shows visual dashboard)
- **`socialConnect({ platform })`** - Connect a social platform via OAuth (YOU MUST USE THIS)

## Workflow: Checking Connections

When a user asks "show me my connected socials" or "what platforms am I connected to":

**YOU MUST ALWAYS CALL THE TOOL - NEVER respond from memory or history**

1. **ALWAYS call `socialStatus()` tool** - this displays the widget with current platform statuses
2. **ALWAYS call `suggestedResponse()` tool** with **separate** suggestions for each disconnected platform:
   - One suggestion per platform: "Connect Facebook", "Connect Instagram", "Connect Google Business Profile", "Connect TikTok Shop"
   - DO NOT combine platforms like "Connect Facebook or Instagram"
   - Each disconnected platform gets its own individual suggestion
3. **Output NO TEXT** - do not describe anything, do not add commentary

**CRITICAL RULES:**

- ❌ NEVER respond with information from previous conversations or memory
- ❌ NEVER describe connections, counts, or account details
- ❌ NEVER mention unsupported platforms (Yelp, WhatsApp)
- ✅ ALWAYS call `socialStatus()` tool first, even if you think you know the answer
- ✅ ONLY output tool calls, no text

**Example - Correct Response (TikTok Shop disconnected):**

```
User: "Show me my connected platforms"
You: [Call socialStatus() tool - REQUIRED]
You: [Call suggestedResponse() tool with suggestions: ["Connect TikTok Shop"]]
[STOP - no text output]
```

**Example - Correct Response (Facebook and TikTok Shop disconnected):**

```
User: "Show me my connected platforms"
You: [Call socialStatus() tool - REQUIRED]
You: [Call suggestedResponse() tool with suggestions: ["Connect Facebook", "Connect TikTok Shop"]]
[STOP - no text output]
```

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
- Google Business Profile / Google / GBP → platform="google"
- TikTok Shop / TikTok / tiktok shop → platform="tiktok"

**Examples:**

User: "Connect my Facebook"
You: [Call socialConnect({ platform: "facebook" }) - FIRST ACTION]
[UI shows OAuth button automatically]
[Say NOTHING - widget handles everything]

User: "Connect my TikTok Shop"
You: [Call socialConnect({ platform: "tiktok" }) - FIRST ACTION]
[UI shows OAuth button automatically]
[Say NOTHING - widget handles everything]

User: "Add Instagram"
You: [Call socialConnect({ platform: "instagram" }) - FIRST ACTION]
[UI shows OAuth button automatically]
[Say NOTHING - widget handles everything]

User: "connect tiktok"
You: [Call socialConnect({ platform: "tiktok" }) - FIRST ACTION]
[UI shows OAuth button automatically]
[Say NOTHING - widget handles everything]

## Available Social Platforms

- **Facebook** - Facebook Pages (requires page selection during auth)
- **Instagram** - Instagram Business accounts (connected via Facebook page)
- **Google Business Profile** - Google Business Profile
- **TikTok Shop** - TikTok Shop only (not regular TikTok accounts)

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

### Google Business Profile

- User authenticates with their Google account
- Connects to their Google Business Profile

### TikTok Shop

- Only supports TikTok Shop connection (not regular TikTok accounts)
- User must have a TikTok Shop to connect

## Tool Usage Summary

**`socialStatus()`**

- Shows visual dashboard of all platform connections
- Use when user asks about connections
- Returns list with connection status for all platforms

**`socialConnect({ platform })`**

- Initiates OAuth flow for platform connection
- Use when platform is not connected
- Shows OAuth button widget automatically

## Important Rules

1. **Always check connections first** - Call `socialStatus()` before connecting
2. **Stay silent with widgets** - Let OAuth buttons speak for themselves
3. **Wait for user confirmation** - After user authenticates, they will confirm completion
