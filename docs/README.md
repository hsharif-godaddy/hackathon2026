# Documentation Index

## Architecture

- [ai-system-architecture.md](ai-system-architecture.md) — AI/LLM interaction pipeline: agents, providers, caching, summarization
- [unified-nomad-job-architecture.md](unified-nomad-job-architecture.md) — Single Nomad job consolidation for preview and publish
- [persistent-storage-architecture.md](persistent-storage-architecture.md) — Ceph filesystem architecture for app persistence
- [git-operations-architecture.md](git-operations-architecture.md) — Git workflow isolation and LLM interaction tracking
- [stop-and-queue-architecture.md](stop-and-queue-architecture.md) — User-controlled agent stream stopping and message queuing
- [prompt-caching-architecture.md](prompt-caching-architecture.md) — Anthropic prompt caching strategy
- [video-generation-architecture.md](video-generation-architecture.md) — WebSocket-based async video generation
- [publish-archive-strategy.md](publish-archive-strategy.md) — AAB vs PaaS archive strategy detection
- [frontend-aws-architecture.md](frontend-aws-architecture.md) — Next.js frontend on AWS infrastructure
- [onprem-hosting-architecture.md](onprem-hosting-architecture.md) — On-premises hosting using Nomad and Cilium

## Security

- [cors-security-guide.md](cors-security-guide.md) — CORS configuration and verification
- [app-transfer-security.md](app-transfer-security.md) — Token-based app ownership transfer
- [preview-app-authentication.md](preview-app-authentication.md) — Cross-domain JWT for preview apps
- [image_security.md](image_security.md) — External image URL blocking
- [oauth-architecture.md](oauth-architecture.md) — OAuth PKCE and client credentials flows
- [ui-agents-authentication-architecture.md](ui-agents-authentication-architecture.md) — JWT auth between UI and agents
- [airo-enterprise/](airo-enterprise/README.md) — Enterprise feature set: per-app SSO, member identity, quotas

## Operations

- [release-pipeline.md](release-pipeline.md) — Release runbook: GHA workflows, train schedule, approval gate, Slack, dark release, dev dark release, rollback
- [OPERATIONAL_PLAYBOOK.md](OPERATIONAL_PLAYBOOK.md) — On-call runbook, alerts, dashboards
- [LOCAL_APM_SETUP.md](LOCAL_APM_SETUP.md) — Local Elastic APM stack for dev
- [REQUEST_CONTEXT_GUIDE.md](REQUEST_CONTEXT_GUIDE.md) — AsyncLocalStorage request context for logging

## Features

- [CLIENT-SIDE-TOOLS.md](CLIENT-SIDE-TOOLS.md) — Browser-side tool execution via WebSocket
- [mediasearch.md](mediasearch.md) — Getty Images media search integration
- [knowb-knowledge-base.md](knowb-knowledge-base.md) — KnowB RAG service configuration
- [site-publish-doc.md](site-publish-doc.md) — Publish workflow via StepFunctions
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
