# Compliance Docs Skill Design

Generate legal compliance pages (Privacy Policy, Terms of Use) via the GoDaddy compliance agent, following the same skill pattern as `media-logo`.

## Context

After the initial site build completes, the develop agent suggests next steps. Two new explicit suggestions will appear: "Add a privacy policy" and "Add a terms of use." When the user picks one, the `compliance-docs` skill loads, the agent gathers required fields conversationally, calls the compliance agent endpoint, and creates a page in the app using its normal file-writing tools.

## Architecture

### Components

| Component          | Path                                               | Role                                           |
| ------------------ | -------------------------------------------------- | ---------------------------------------------- |
| Skill definition   | `agents/src/skills/compliance-docs/skill.md`       | Loading conditions + agent instructions        |
| Tool               | `agents/src/skills/compliance-docs/tools/index.ts` | `generate_document` tool definition + handler  |
| Service            | `agents/src/services/ComplianceService.ts`         | S2S HTTP call to compliance agent              |
| Suggested response | `agents/src/prompts/develop/suggested-response.md` | Mention compliance docs as a post-build option |

### Data Flow

```
User says "add a privacy policy"
  -> skill loads (matches whenToUse phrases)
  -> agent gathers missing fields conversationally (email, children, etc.)
  -> agent calls compliance-docs__generate_document tool
  -> tool calls ComplianceService.generateDocument()
  -> ComplianceService makes POST /api/document/generate to compliance agent (S2S auth)
  -> markdown returned to agent
  -> agent creates a new page (e.g., /privacy-policy) using its normal file-writing tools
  -> agent confirms to user
```

## Skill Definition

```yaml
---
name: compliance-docs
description: Generate legal compliance pages (Privacy Policy, Terms of Use).
whenToUse:
  User wants to add, create, or generate a privacy policy, terms of use,
  or legal pages. Phrases like "add a privacy policy", "add a terms of use",
  "generate terms of use", "I need legal pages", "create a ToU page".
---
```

Skill body instructs the agent to:

1. Determine which document type the user wants (privacy-policy or terms-of-use)
2. Gather required fields not already in context (businessName from app plan, others by asking)
3. Call `compliance-docs__generate_document`
4. Create a page at an appropriate route with the returned markdown
5. Suggest adding a footer link to the new page (standard placement for legal pages)
6. Inform the user the page is live

## Tool: `generate_document`

### Input Schema

Discriminated union mirroring the compliance API:

```typescript
const GenerateDocumentInputSchema = z.discriminatedUnion("documentType", [
  z.object({
    documentType: z.literal("privacy-policy"),
    businessName: z.string().min(1).max(200),
    email: z.string().email(),
    children: z.boolean(),
  }),
  z.object({
    documentType: z.literal("terms-of-use"),
    businessName: z.string().min(1).max(200),
    domainName: z.string().min(1).max(200),
    children: z.boolean(),
    jurisdiction: z.string().min(1), // US state
  }),
]);
```

### Output

Returns to the agent:

```typescript
{
  documentType: "privacy-policy" | "terms-of-use",
  markdown: string, // Full rendered markdown document
}
```

The agent then uses its normal page-creation flow to write the file and add routing.

## ComplianceService

Follows the `LogoService` pattern:

```typescript
// agents/src/services/ComplianceService.ts

import { getS2SToken } from "@airo/ai-lib";
import { logger } from "../logging/index.js";
import { resolveEnv } from "../utils/gd-env.js";

// Environment-based URL resolution
// Dev:  https://compliance-agent.mvci.api.dev-godaddy.com
// Test: https://compliance-agent.mvci.api.test-godaddy.com
// Prod: https://compliance-agent.mvci.api.godaddy.com

// POST /api/document/generate
// Headers:
//   Authorization: Bearer <S2S token>
//   x-app-key: airo-app-builder
//   x-customer-id: <customerId>
// Body: GenerateDocumentInput (privacy-policy or terms-of-use variant)
// Response: { documentType, markdown }
```

Key differences from LogoService:

- No budget/grant integration (no LLM costs on our side — compliance agent uses templates)
- No `x-budget-user-id` header needed
- 30s timeout (template rendering, not AI generation)
- No retry logic beyond standard HTTP error handling

## Suggested Response Integration

Add two explicit suggestions in `agents/src/prompts/develop/suggested-response.md`. The agent shows these after the initial build completes:

```typescript
suggestedResponse({
  question: "What would you like to do next?",
  suggestions: [
    { text: "Change the color scheme" },
    { text: "Add a privacy policy" },
    { text: "Add a terms of use" },
    // ... other contextual suggestions
  ],
});
```

The skill is not pre-loaded — it activates only when the user responds with intent matching the skill's `whenToUse` conditions.

## Page Creation Behavior

The agent handles page creation using its existing tools. The skill.md provides guidance:

- **Route naming:** `/privacy-policy` or `/terms-of-use` (kebab-case)
- **Page content:** Wrap the markdown in the app's framework-appropriate component/layout
- **Navigation:** Suggest placing a link in the footer (not main nav) — standard for legal pages, but agent uses judgment based on app structure
- **No special UI rendering** — unlike logos (grid widgets, action buttons), legal docs are text content

## Error Handling

- Compliance service unreachable or error response: tool returns error message, agent informs user
- Validation errors (e.g., invalid state): surfaced conversationally, agent asks user to correct
- No retry/grant logic needed

## Fields the Agent Gathers

| Field          | Source                                               | Document Types      |
| -------------- | ---------------------------------------------------- | ------------------- |
| `businessName` | App plan context (app.title) — ask if missing        | Both                |
| `email`        | Ask user                                             | privacy-policy only |
| `children`     | Ask user: "Does your site target children under 13?" | Both                |
| `domainName`   | Ask user (or infer from app config if available)     | terms-of-use only   |
| `jurisdiction` | Ask user: "What US state is your business based in?" | terms-of-use only   |

## Compliance Agent Endpoint Reference

- **Repo:** `gdcorp-partners/gai-compliance-agent`
- **Branch:** `document-generate-endpoint`
- **Route:** `POST /api/document/generate`
- **Auth:** AWS IAM or IDP (S2S token)
- **Response:** `{ documentType: string, markdown: string }`
