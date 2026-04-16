# Documentation Index

> **Note:** The `thought-exercise/` directory contains exploratory design exercises and does not reflect the current architecture.

## Architecture

- [ai-system-architecture.md](ai-system-architecture.md) — AI/LLM interaction pipeline: agents, providers, caching, summarization
- [unified-nomad-job-architecture.md](unified-nomad-job-architecture.md) — Single Nomad job consolidation for preview and publish
- [client-websocket-architecture.md](client-websocket-architecture.md) — WebSocket state machine and client-server coordination
- [persistent-storage-architecture.md](persistent-storage-architecture.md) — Ceph filesystem architecture for app persistence
- [git-operations-architecture.md](git-operations-architecture.md) — Git workflow isolation and LLM interaction tracking
- [stop-and-queue-architecture.md](stop-and-queue-architecture.md) — User-controlled agent stream stopping and message queuing
- [prompt-caching-architecture.md](prompt-caching-architecture.md) — Anthropic prompt caching strategy
- [video-generation-architecture.md](video-generation-architecture.md) — WebSocket-based async video generation
- [website-rebuild-data-flows.md](website-rebuild-data-flows.md) — Data flow for website scraping and rebuild
- [publish-archive-strategy.md](publish-archive-strategy.md) — AAB vs PaaS archive strategy detection
- [frontend-aws-architecture.md](frontend-aws-architecture.md) — Next.js frontend on AWS infrastructure
- [onprem-hosting-architecture.md](onprem-hosting-architecture.md) — On-premises hosting using Nomad and Cilium

## Security

- [cors-security-guide.md](cors-security-guide.md) — CORS configuration and verification
- [cors-audit-summary.md](cors-audit-summary.md) — CORS audit results
- [app-transfer-security.md](app-transfer-security.md) — Token-based app ownership transfer
- [preview-app-authentication.md](preview-app-authentication.md) — Cross-domain JWT for preview apps
- [image_security.md](image_security.md) — External image URL blocking
- [oauth-architecture.md](oauth-architecture.md) — OAuth PKCE and client credentials flows
- [ui-agents-authentication-architecture.md](ui-agents-authentication-architecture.md) — JWT auth between UI and agents
- [authz-options.md](authz-options.md) — PaaS product-level authorization options

## Operations

- [OPERATIONAL_PLAYBOOK.md](OPERATIONAL_PLAYBOOK.md) — On-call runbook, alerts, dashboards
- [LOCAL_APM_SETUP.md](LOCAL_APM_SETUP.md) — Local Elastic APM stack for dev
- [REQUEST_CONTEXT_GUIDE.md](REQUEST_CONTEXT_GUIDE.md) — AsyncLocalStorage request context for logging

## Features

- [CLIENT-SIDE-TOOLS.md](CLIENT-SIDE-TOOLS.md) — Browser-side tool execution via WebSocket
- [mediasearch.md](mediasearch.md) — Getty Images media search integration
- [knowb-knowledge-base.md](knowb-knowledge-base.md) — KnowB RAG service configuration
- [site-publish-doc.md](site-publish-doc.md) — Publish workflow via StepFunctions
- [design-agent-design.md](design-agent-design.md) — Design agent architecture
- [design-agent-examples.md](design-agent-examples.md) — Design agent usage examples
- [design-agent-summary.md](design-agent-summary.md) — Design agent overview
- [manual-recovery-analysis.md](manual-recovery-analysis.md) — Manual recovery flow safety
- [commerce-cart-cache-issue.md](commerce-cart-cache-issue.md) — Known cart caching issue
- [agent-tool-inventory.md](agent-tool-inventory.md) — Agent tool and service inventory

## PaaS

- [paas/github-sync-design.md](paas/github-sync-design.md) — Bidirectional GitHub sync
- [paas/github-sync-class-diagram.md](paas/github-sync-class-diagram.md) — GitHub sync component diagram
- [paas/paas-customer-logs-access.md](paas/paas-customer-logs-access.md) — Customer deployment log visibility
- [paas/zip-import-architecture.md](paas/zip-import-architecture.md) — Code import via zip upload
- [paas/zip-import-plan.md](paas/zip-import-plan.md) — Zip import design decisions

## Skills

- [skills/stripe-skill.md](skills/stripe-skill.md) — Stripe payment integration
- [skills/online-appointments-skill.md](skills/online-appointments-skill.md) — Online appointment booking

## Social

- [social/social-connections-diagrams.md](social/social-connections-diagrams.md) — Social media connection flows

## Tech Debt

- [tech-debt/summarization-improvements.md](tech-debt/summarization-improvements.md) — Conversation summarization improvements

## Plans

Each plan has a `status:` frontmatter field. Allowed values: `implemented`, `active`, `completed`, `superseded`, `not-implemented`, `archived`.

### Core Plans

- [plans/](plans/) — 35 feature and refactor plans

### PaaS Plans

- [paas/plans/](paas/plans/) — 6 PaaS-specific plans

### Superpowers Plans & Specs

- [superpowers/plans/](superpowers/plans/) — implementation plans
- [superpowers/specs/](superpowers/specs/) — design specs

## Thought Exercise (Exploratory)

> These documents explore potential future capabilities. They are not committed designs.

- [thought-exercise/platform-architecture.md](thought-exercise/platform-architecture.md) — Platform microservices concepts
- [thought-exercise/agent-features.md](thought-exercise/agent-features.md) — Specialized AI agent suite
- [thought-exercise/ai-features.md](thought-exercise/ai-features.md) — Managed AI capabilities
- [thought-exercise/architecture-diagrams.md](thought-exercise/architecture-diagrams.md) — Architecture diagrams
- [thought-exercise/development-features.md](thought-exercise/development-features.md) — Standardized tech stack
- [thought-exercise/hosting-features.md](thought-exercise/hosting-features.md) — Enterprise hosting features
- [thought-exercise/security-features.md](thought-exercise/security-features.md) — AI security analyst
- [thought-exercise/tech-stack.md](thought-exercise/tech-stack.md) — Tech stack philosophy

## Archived

> These docs have been superseded. See root CLAUDE.md for the canonical architecture overview.

- [overview.md](overview.md) — Original platform overview (archived)
- [ai-hosting-platform-docs.md](ai-hosting-platform-docs.md) — AI hosting platform docs (archived)
