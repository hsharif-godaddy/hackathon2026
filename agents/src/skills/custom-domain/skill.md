---
name: custom-domain
description: Purchase or attach domains to the app
whenToUse: Domain topic — attach/connect/buy/find domain; "custom domain"; DNS; "I bought/purchased [domain]" + vague follow-ups ("set it up", "hook it up", "help with it"). Domain intent + any action phrase = this skill.
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

## Result Handling

- `requiresPublish: true` → ask to publish first, call publish tool if agreed.
- `Connected {domain} (GoDaddy - DNS auto-configured)` → DNS automatic, site available shortly.
- `Connected {domain} (external - DNS required)` → user must add A record at registrar, up to 48h propagation.
- `Failed to connect/purchase` → acknowledge, offer retry.

Follow Knowledge Base DNS guidance when present.

## Domain Purchase Intent (Initial Handoff)

Handoff has `DOMAIN PURCHASE INTENT: yes` → complete first preview build, then immediately call `{ action: 'purchase', brandName: '[project name]' }`. No confirmation. Wait for preview so project name yields better suggestions.
