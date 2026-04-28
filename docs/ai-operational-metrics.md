# AI Operational Metrics & Open Questions

Companion to [ai-system-architecture.md](ai-system-architecture.md). One-pager of questions we want external input on, each with the metric / constraint / architectural fact that makes it a question.

Setup: all agent LLM traffic goes to a single GoCode/LiteLLM endpoint, which internally load-balances ~50/50 per-customer between AWS Bedrock and Azure OpenAI passthrough for Sonnet 4.6. Guidance we want is pattern-level and provider-neutral.

Numbers captured 2026-04-23 (24h prod window), re-verified 2026-04-27. Distributions stable between runs; absolute volume varies ~20% weekday/weekend.

## Workload shape (the "why" behind every question)

- **17.8k agent turns/day**, ~$6.8k/day, 1,670 active apps. 98% Sonnet / 98% `develop` agent.
- **One turn = many HTTP calls.** Token figures are `totalUsage` summed across a turn's tool-loop steps (see `packages/ai-transport/src/experimental-websocket-server.ts:3840`). Per-turn cumulative input: p50 187k, p95 1.22M, p99 2.97M. Individual calls stay inside the standard 200k window; the p95 implies ~6 HTTP calls per turn.
- **Cache hit rate is bimodal**: aggregate 82%, but p10 = 38%, p25 = 50%. Median fresh tokens per turn = 66k ($3k/day floor).
- **Summarization fires on ~99% of turns** (17.6k/day). Trigger is token-threshold, not idle.
- **Budget-exceeded ~7% of turns** (1,247/day), each triggering mid-request grant advancement.

## Open questions

1. **Bimodal cache hit rate.** 25% of turns hit <50% cache despite stable-prefix caching with 4 breakpoints, `after_history` placement of dynamic data, and 5-turn summary pinning. Structural limit of prefix caching on long agentic loops, or are we leaving wins on the table? 5-minute Anthropic TTL is a suspect but we don't yet track idle-gap distribution.

2. **~1.2M-token p95 cumulative per-turn input.** Driven by ~6 tool-loop HTTP calls per turn at p95 (each <200k). Is this normal for code-gen agents of our scope, or does it mean we're keeping too much in-context vs. externalising to retrieval / reducing loop iterations? maxSteps is 100 for `develop`; we don't emit how often it's hit.

3. **Summarize-on-threshold vs. summarize-on-idle.** Firing after 99% of turns means we repeatedly pay the post-summarization cache miss. Is threshold-based the wrong trigger for this workload?

4. **Tier differentiation.** 98% of spend is Sonnet. Haiku/Opus tiers exist but aren't selected. What signals do similar workloads use to route cheaper operations (single-line patches, trivial confirmations) to Haiku without degrading UX?

5. **Provider degradation handling.** Split is static ~50/50 per-customer with stable backend affinity (to preserve cache prefix). On provider error we surface it; we don't fail over. What does a safe multi-provider failover look like when cache affinity is per-customer?

6. **Per-tenant budget enforcement.** 7% of turns hit budget and advance grants mid-request via our own code. Is the mid-request-advancement pattern standard, or is pre-turn reservation / post-turn settlement more common?

## Data we don't have yet (would improve the conversation)

Backend provider label on each call (GoCode doesn't surface which backend served it); idle-gap between turns; cache scenario label (intra-turn / first-of-turn / post-summarization / post-idle); content block count per request; per-compaction-strategy fire counts; steps-per-turn vs. maxSteps; TTFT in Loki (currently only in Langfuse).

All are small instrumentation changes; one PR before the engagement would let us answer follow-ups from Loki alone.

## Related

- [ai-system-architecture.md](ai-system-architecture.md) - how the system works
- [prompt-caching-architecture.md](prompt-caching-architecture.md) - cache breakpoint mechanics
- [model-override.md](model-override.md) - ops runbook for model switching
