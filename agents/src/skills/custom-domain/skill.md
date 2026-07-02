---
name: custom-domain
description: Purchase, attach, or forward domains for the app
whenToUse: Domain topic — attach/connect/buy/find/forward/redirect domain; "custom domain"; DNS; "I bought/purchased [domain]" + vague follow-ups ("set it up", "hook it up", "help with it"); "multiple domains" / "secondary domain" / "other domain". Domain intent + any action phrase = this skill. ALSO load for explanatory or advice questions about domains even with no action verb — e.g. choosing between attaching and forwarding, how forwarding/redirects work, or pointing multiple owned domains at one site.
intents:
  - buy domain/want domain/purchase domain/find domain/custom domain/connect domain/DNS/domain forward
---

# Custom Domain

## Intent Mapping

**Default rule: when uncertain between `attach` and `purchase`, always use `attach`.** The attach widget shows the user's existing GoDaddy domains with one-click connect, and also includes a "Buy a domain" option — so it handles both cases. Only call `purchase` when the user explicitly says they want to buy or find a new domain they don't yet own (e.g. "buy", "purchase", "find", "get a new", "I don't have a domain").

| User says                                              | Call                                                   |
| ------------------------------------------------------ | ------------------------------------------------------ |
| "I have/own a domain" / "use my domain" / "don't want to buy" / "connect an existing domain" / "connect my own domain" | `{ action: 'attach' }` |
| "I purchased/bought … mydomain.com" (any follow-up)    | `{ action: 'attach', domain: 'mydomain.com' }`         |
| "Attach/connect/use mydomain.com" / "already own mydomain.com" | `{ action: 'attach', domain: 'mydomain.com' }`  |
| "Add/connect a domain" / "custom domain" / DNS request | `{ action: 'attach' }`                                 |
| "I want/need a domain" / "let's set up a domain" (ownership unclear) | `{ action: 'attach' }` — show existing domains first; purchase option is inside the widget |
| "Buy/find/get a new domain" / "I don't have a domain yet" | `{ action: 'purchase', brandName: '[project name]' }` |
| "I want to buy my-sweet-store.com"                     | `{ action: 'purchase', domain: 'my-sweet-store.com' }` |
| "Forward mybusiness.org to my site" / "make my other domain go here" / "forward my domain" / "multiple domains" | `{ action: 'forward', domain: 'mybusiness.org' }` |
| "How do I point all my domains here?" / "secondary domain" | `{ action: 'forward' }`                             |

## Result Handling

- `requiresPublish: true` → ask to publish first, call publish tool if agreed.
- `crossAccount: true` → the domain is registered to a DIFFERENT GoDaddy account and cannot be connected here. Relay the options in the tool message (sign in to the owning account and point DNS, transfer the domain into this account, or forward it). **Do NOT say the domain is connected or will connect** — it will not.
- `alreadyConnected: true` → the domain is already on this app; relay the tool message's status (already active, or still provisioning) as-is.
- `success: true` with no `widgetType`, no `crossAccount`, and no `alreadyConnected` → a connection was just **started**, not finished. Say it is "being set up" / "connecting" and relay the tool message's DNS guidance. **Do not say it is already live** — it goes live only after DNS propagates.
- `Connected {domain} (GoDaddy - DNS auto-configured)` → DNS automatic, site available shortly.
- `Connected {domain} (external - DNS required)` → user must add A record at registrar, up to 48h propagation.
- `Failed to connect/purchase` → acknowledge, offer retry.
- `action: 'forward'` → **Always call the tool** — do not answer from KB alone. The tool looks up the user's actual attached domain and generates a personalized DCC deep link. Paraphrase the tool result with forwarding steps.

Follow Knowledge Base DNS guidance when present. **Exception:** for forwarding/redirect requests, always call the tool first — the KB article is supplementary context only. For forwarding specifics (redirect types, nameserver requirements, registrar steps, limitations), load `references/forwarding-details.md`.

## Domain Purchase Intent (Initial Handoff)

Handoff has `DOMAIN PURCHASE INTENT: yes` → complete first preview build, then **on the first custom-domain tool call in this conversation** immediately call `{ action: 'purchase', brandName: '[project name]' }`. No confirmation. Wait for preview so project name yields better suggestions.

**One-shot rule:** `DOMAIN PURCHASE INTENT: yes` only applies until the first custom-domain tool call (any action). After that first tool call, treat the flag as consumed — use the Intent Mapping table for all subsequent domain messages.

**Override:** Even on the first domain message, if the user's phrasing indicates they already own a domain (matches the first row of the Intent Mapping table), call `{ action: 'attach' }` instead.
