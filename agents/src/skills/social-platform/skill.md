---
name: social-platform
description: Connect and manage social media platform integrations
whenToUse: User wants to connect their social media accounts. Phrases like "connect to Facebook", "link Instagram", "social media accounts", "connect social".
enablementId: social
---

# Social Platform Integration Skill

**Purpose:** Help users connect and manage their social media platform accounts.

> **Note:** This skill provides social platform integration instructions. Some skills may also provide specialized tools that are automatically loaded when you activate the skill. Tools are prefixed with the skill name (e.g., `skillname__toolname`) to prevent naming conflicts. You can unload a skill's tools with `skill({ action: 'unload', skill: 'name' })` when no longer needed.

---

## When to Use This Skill

**User says:**

- "Connect to Facebook"
- "Connect to Instagram"
- "Connect to Google"
- "Connect Google Business Profile"
- "Link my Google account"
- "Link my social accounts"

---

# Your Role

You have social media management tools available. Use them to help users connect their social media accounts.

## Available Tools

- **`social-platform__socialConnect({ platform })`** - Connect a social platform via OAuth (YOU MUST USE THIS)

## Connecting Platforms

When a user asks to connect a platform, call `social-platform__socialConnect` with the appropriate platform value. The UI will show existing connections (if any) and provide a "New Connection" option for adding another account.

**Trigger phrases:**

- "Connect to [platform]"
- "Connect [platform]"
- "Add [platform]"
- "Link [platform]"
- "Set up [platform]"

**Platform name mapping (use these exact values):**

- Facebook → platform="FACEBOOK"
- Instagram → platform="INSTAGRAM"
- Google / Google Business Profile / GMB → platform="GOOGLE_BUSINESS_PROFILE"

**Examples:**

User: "Connect to Facebook"
You: social-platform__socialConnect({ platform: "FACEBOOK" })

User: "Connect to Instagram"
You: social-platform__socialConnect({ platform: "INSTAGRAM" })

User: "Connect Google Business Profile"
You: social-platform__socialConnect({ platform: "GOOGLE_BUSINESS_PROFILE" })

## Available Social Platforms

- **Facebook** - Facebook Pages (requires page selection during auth)
- **Instagram** - Instagram Business accounts (connected via Facebook page)
- **Google Business Profile** - Google Business Profile / GMB (reviews, locations, insights)

## Tool Response Patterns

The tool returns a connect widget that the UI renders automatically. It shows:
- Existing connections for the platform (user can select one)
- A "New Connection" button to add a new account via OAuth

Stay silent after calling the tool — let the UI handle the interaction.

### After user authenticates

User will tell you "done" or "connected". Respond: "Successfully connected!"

## Platform Authentication Notes

### Facebook & Instagram

- User must select which Facebook page during authentication
- Instagram requires a Facebook page connection

## Tool Usage Summary

**`social-platform__socialConnect({ platform })`**

- Initiates OAuth flow for platform connection
- Use to connect social platforms
- Shows OAuth button widget automatically

## After Connecting Google Business Profile

Once the user confirms their Google Business Profile is connected, offer:

> "Your Google Business Profile is connected! Would you like me to add your Google reviews to your site?"

If they say yes, load the `google-reviews` skill.

---

## Important Rules

1. **Stay silent with widgets** - Let OAuth buttons speak for themselves
2. **Wait for user confirmation** - After user authenticates, they will confirm completion
