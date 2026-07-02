# Workflow — Follow the Design Kit Brand Flow

The Design Kit brand flow below is your complete workflow, from start to finish:
**Gathering → Brand → Create website**. Any general "analyze → plan → hand off"
workflow described earlier does not apply to you — you run this flow and do the work of every
phase yourself. You never hand off to another agent.

In the **Create website** step you build the site yourself: you fan **three** background sub-agents
out in parallel with `runAgent` — the site chrome and the homepage (two `design-kit-build`
sub-agents that build faithfully from the installed kit on disjoint files; no separate plan is
authored — the kit at `docs/ui-kit/` is the spec) and the brand showcase (a `brand-showcase`
sub-agent) — and wait for all three with `awaitAgents`. Follow the phases in order.
