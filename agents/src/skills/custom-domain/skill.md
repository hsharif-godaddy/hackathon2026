---
name: custom-domain
description: Purchase, attach, or forward domains for the app
whenToUse: Domain topic — attach/connect/buy/find/forward/redirect domain; "custom domain"; DNS; "I bought/purchased [domain]" + vague follow-ups ("set it up", "hook it up", "help with it"); "multiple domains" / "secondary domain" / "other domain". Domain intent + any action phrase = this skill.
---

# Custom Domain

## Intent Mapping

| User says                                              | Call                                                   |
| ------------------------------------------------------ | ------------------------------------------------------ |
| "I purchased/bought … mydomain.com" (any follow-up)    | `{ action: 'attach', domain: 'mydomain.com' }`         |
| "Attach/connect/use mydomain.com"                      | `{ action: 'attach', domain: 'mydomain.com' }`         |
| "Add/connect a domain" / "custom domain" / DNS request | `{ action: 'attach' }`                                 |
| "Buy/find a domain" / "I need a domain"                | `{ action: 'purchase', brandName: '[project name]' }`  |
| "I want to buy my-sweet-store.com"                     | `{ action: 'purchase', domain: 'my-sweet-store.com' }` |
| "Forward mybusiness.org to my site" / "make my other domain go here" / "forward my domain" / "multiple domains" | `{ action: 'forward', domain: 'mybusiness.org' }` |
| "How do I point all my domains here?" / "secondary domain" | `{ action: 'forward' }`                             |

## Result Handling

- `requiresPublish: true` → ask to publish first, call publish tool if agreed.
- `Connected {domain} (GoDaddy - DNS auto-configured)` → DNS automatic, site available shortly.
- `Connected {domain} (external - DNS required)` → user must add A record at registrar, up to 48h propagation.
- `Failed to connect/purchase` → acknowledge, offer retry.
- `action: 'forward'` → **Always call the tool** — do not answer from KB alone. The tool looks up the user's actual attached domain and generates a personalized DCC deep link. Paraphrase the tool result with forwarding steps.

Follow Knowledge Base DNS guidance when present. **Exception:** for forwarding/redirect requests, always call the tool first — the KB article is supplementary context only.

## Domain Purchase Intent (Initial Handoff)

Handoff has `DOMAIN PURCHASE INTENT: yes` → complete first preview build, then immediately call `{ action: 'purchase', brandName: '[project name]' }`. No confirmation. Wait for preview so project name yields better suggestions.
