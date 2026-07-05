---
name: compliance-docs
description: Generate legal compliance pages (Privacy Policy, Terms of Use).
whenToUse: User wants to add, create, or generate a privacy policy, terms of use, or legal pages — either by name (phrases like "add a privacy policy", "add a terms of use", "generate terms of use", "I need legal pages", "create a ToU page") OR by path (any request to build/create a page at `/privacy`, `/privacy-policy`, `/terms`, `/terms-of-use`, or `/tos`, including path-only build requests from the preview's "page doesn't exist" popup that arrive as messages like `"The page at path /privacy doesn't exist yet, please build it with appropriate content."`). ALWAYS load this skill for these requests and generate the document through it — never hand-write `src/pages/privacy.tsx` / `src/pages/terms.tsx` yourself. This applies even if a prior charge prompt was cancelled — a repeat request is a brand-new request, so load this skill again rather than trying to hand-build a free version.
enablementId: complianceDocs
markets:
  - en-US
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

Before gathering the domain, call `compliance-docs__get_purchased_domain` — it returns the domain already on file for this app (e.g. carried in from a domain purchase). Use that value if present; only ask the user for the domain when it reports none.

**Required fields:**
- `businessName` — the business or site name (check app context first — may be available from app title/plan)
- `domainName` — the website domain (e.g., "example.com"). **Mandatory.** First call `compliance-docs__get_purchased_domain`: if it returns a domain, pass that value as `domainName` and skip asking. If it reports none, ask the user for their domain and pass that.
- `children` — whether the site targets children under 18
- `jurisdiction` — the US state where the business is based

### Gathering Information

You MUST explicitly ask the user for ALL required fields before calling the tool. Do not assume or infer any values — each field requires a direct answer from the user. Use the `askQuestion` tool to present these questions to the user as structured prompts — do not ask them as plain text in chat. (Exception: the Terms of Use `domainName` may come from `compliance-docs__get_purchased_domain` instead of the user — see below.)

**Privacy Policy — ask these exact questions:**
1. "What's the name of your business?"
2. "What email address should be used for legal concerns?"
3. "Does your website collect information from children under 13?"

**Terms of Use — ask these exact questions:**
1. "What's the name of your business?"
2. Website domain — **first call `compliance-docs__get_purchased_domain`. If it returns a domain, use it and skip this question. Only if it reports no domain, ask: "What's your website domain name?" (e.g., "example.com").**
3. "What U.S. state are you (or your business) located in? This helps us apply the correct laws."
4. "Do you sell goods or services to children under the age of 18?"

**CRITICAL:** Each tool has DIFFERENT required fields. Do NOT reuse answers from one document type for the other. If the user requests both documents, ask the full set of questions for EACH one separately.

- Privacy policy requires: `businessName`, `email`, `children` (under 13, COPPA)
- Terms of use requires: `businessName`, `domainName`, `children` (under 18, selling to minors), `jurisdiction`
- The `children` question is DIFFERENT between the two — you must ask it separately for each
- Terms of use does NOT use `email`; privacy policy does NOT use `domainName` or `jurisdiction`

### Generating a document (and its charge)

Once you have gathered ALL required fields, just call the matching generate tool
(`compliance-docs__generate_privacy_policy` or `compliance-docs__generate_terms_of_use`). The charge is
handled for you — do NOT quote a price or assume a cost, as it is variable and may be free:

- If the tool **succeeds**, the document was generated (and any charge applied). Continue with the follow-up tasks below.
- If the tool returns **CONFIRMATION_REQUIRED**, a charge applies that the user hasn't approved. Call
  `compliance-docs__request_charge_confirmation` with the matching `documentType` to show the Accept/Cancel
  dialog, then:
  - If the user **accepts**, call the generate tool again with the same fields.
  - If the user **cancels**, do NOT generate the document for that request. Briefly acknowledge and stop.

Never call `compliance-docs__request_charge_confirmation` on its own — only in response to a
CONFIRMATION_REQUIRED result. Free documents and regenerations of an already-paid document generate
directly with no dialog. If the user requests both documents, handle each separately.

**A cancellation applies only to that one prompt — it is NOT a standing instruction.** If the user later asks again to add, create, or generate the document (e.g. "add a privacy policy page"), treat it as a brand-new request: gather any missing fields and call the generate tool again. NEVER refuse a document the user is actively asking for just because an earlier attempt was cancelled.

### After the Tool Succeeds

The tool writes the page file directly — you do NOT need to create the page yourself. The tool handles:
- Writing `src/pages/privacy.tsx` or `src/pages/terms.tsx`
- Embedding the legally-precise markdown verbatim (rendered via `react-markdown` + `remark-gfm`)

Your remaining tasks after the tool returns success:
1. Ensure there is a link to the page in the site footer. If one already exists, do not add a duplicate.
2. Confirm to the user that the page has been created and where to find it.

**IMPORTANT:** Only create the specific document the user requested. Do NOT create or add links for other document types unless the user explicitly asks for them.
