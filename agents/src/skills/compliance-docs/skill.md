---
name: compliance-docs
description: Generate legal compliance pages (Privacy Policy, Terms of Use).
whenToUse: User wants to add, create, or generate a privacy policy, terms of use, or legal pages — either by name (phrases like "add a privacy policy", "add a terms of use", "generate terms of use", "I need legal pages", "create a ToU page") OR by path (any request to build/create a page at `/privacy`, `/privacy-policy`, `/terms`, `/terms-of-use`, or `/tos`, including path-only build requests from the preview's "page doesn't exist" popup that arrive as messages like `"The page at path /privacy doesn't exist yet, please build it with appropriate content."`).
enablementId: complianceDocs
intents:
  - privacy policy/terms of use/legal pages/ToU/privacy page/terms page
---

## Document Generation

Generate a privacy policy or terms of use page for the user's site.

### Privacy Policy

Use `compliance-docs__generate_privacy_policy` to generate a privacy policy.

**Required fields:**
- `businessName` — the business or site name (check app context first — may be available from app title/plan)
- `email` — contact email for privacy inquiries
- `children` — whether the site targets children under 13

### Terms of Use

Use `compliance-docs__generate_terms_of_use` to generate terms of use.

**Required fields:**
- `businessName` — the business or site name (check app context first — may be available from app title/plan)
- `domainName` — the website domain (e.g., "example.com")
- `children` — whether the site targets children under 18
- `jurisdiction` — the US state where the business is based

### Gathering Information

You MUST explicitly ask the user for ALL required fields before calling the tool. Do not assume or infer any values — each field requires a direct answer from the user. Use the `askQuestion` tool to present these questions to the user as structured prompts — do not ask them as plain text in chat.

**Privacy Policy — ask these exact questions:**
1. "What's the name of your business?"
2. "What email address should be used for legal concerns?"
3. "Does your website collect information from children under 13?"

**Terms of Use — ask these exact questions:**
1. "What's the name of your business?"
2. "What's your website domain name?" (e.g., "example.com")
3. "What U.S. state are you (or your business) located in? This helps us apply the correct laws."
4. "Do you sell goods or services to children under the age of 18?"

**CRITICAL:** Each tool has DIFFERENT required fields. Do NOT reuse answers from one document type for the other. If the user requests both documents, ask the full set of questions for EACH one separately.

- Privacy policy requires: `businessName`, `email`, `children` (under 13, COPPA)
- Terms of use requires: `businessName`, `domainName`, `children` (under 18, selling to minors), `jurisdiction`
- The `children` question is DIFFERENT between the two — you must ask it separately for each
- Terms of use does NOT use `email`; privacy policy does NOT use `domainName` or `jurisdiction`

### After the Tool Succeeds

The tool writes the page file directly — you do NOT need to create the page yourself. The tool handles:
- Writing `src/pages/privacy.tsx` or `src/pages/terms.tsx`
- Embedding the legally-precise markdown verbatim (rendered via `react-markdown` + `remark-gfm`)

Your remaining tasks after the tool returns success:
1. Ensure there is a link to the page in the site footer. If one already exists, do not add a duplicate.
2. Confirm to the user that the page has been created and where to find it.

**IMPORTANT:** Only create the specific document the user requested. Do NOT create or add links for other document types unless the user explicitly asks for them.
