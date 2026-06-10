# Parallel Interactive Agents via Client-Side Orchestration

## Problem

The deep-build pipeline needs to run background agents (design) and interactive agents (interview-details) simultaneously. Currently, the server-side tool loop is serial — an interactive agent handoff blocks until it completes, preventing background agents from running in parallel. A fire-and-forget approach was attempted and reverted because it introduced polling costs, unreliable dispatch, and session-tracking complexity.

## Proposed Architecture

Move interactive agent lifecycle management to the client. The server orchestrator dispatches interactive agents as a **rendered tool result** rather than a blocking handoff. The client drives the interactive session in a parallel channel while the server continues background work.

## Execution Flow

```
Server (orchestrator tool loop):
  runAgent(design, background) → blocks, runs design agent → returns result
  runAgent(interview, interactive) → returns immediately: { type: "client_interactive", config }
  Orchestrator continues (or stops if nothing else to do)

Client (parallel):
  Receives "client_interactive" tool result → renders interview UI
  Opens sidecar agent session (second SSE stream to same conversation)
  Drives multi-turn Q&A: askQuestion → user answers → next turn → ...
  When agent calls returnToParent → client sends completion message to main stream

Server (orchestrator resumes):
  Receives "Interactive agent completed: [summary]" as next user-like message
  Proceeds with next pipeline stage
```

## Key Design Points

### The client is a router, not an executor

The interactive agent still runs on the server — it needs tools (writeFile, readFile, skill, showDoc). The client's role is:
1. Initiating the parallel session
2. Relaying user responses to the sidecar stream
3. Signaling completion back to the main orchestrator

### Two concurrent server sessions, one client connection

The client multiplexes two agent sessions:
- **Main channel**: orchestrator + background agents (can run uninterrupted)
- **Sidecar channel**: interactive agent (drives Q&A with user)

Implementation options:
- Two SSE streams (separate endpoints, same conversationId prefix)
- Single SSE stream with message routing (tagged by channel)
- WebSocket with multiplexed namespaces

### Waiting semantics

| Scenario | Behavior |
|----------|----------|
| Background + interactive dispatched together | Both run in parallel. Orchestrator gets background result immediately. Client signals interactive completion separately. |
| Orchestrator needs interactive result before next step | Orchestrator stops after dispatching. Client completion message triggers the next orchestrator turn. |
| Background finishes before interactive | Result stored in orchestrator context. When interactive completes and orchestrator resumes, it has both. |
| Interactive finishes before background | Client signals completion. Orchestrator resumes, can dispatch more work or wait. |

### Tool result shape

```typescript
// Instead of triggering a server-side handoff:
return { ok: true, interactive: true, agent: childAgentName }

// Return a client-renderable directive:
return {
  type: 'client_interactive',
  agent: 'interview',
  agentConfig: { /* enough for client to start the session */ },
  task: 'Load deep-interview-details skill and collect business details',
  sessionId: 'sidecar-xxx',
}
```

### Client UI

The interactive agent's `askQuestion` calls render in the same chat thread (or a dedicated panel). From the user's perspective, nothing changes — they answer questions the same way. The difference is architectural: the main orchestrator loop isn't yielding.

## Open Questions

1. **Connection lifecycle**: If the user disconnects mid-interactive-agent, what happens? The sidecar session needs cleanup. The orchestrator needs to know the interactive agent didn't complete.

2. **Conversation history**: Do both channels share conversation history? The interactive agent needs to see the brief it's extending. The orchestrator needs to see the interactive agent's output. Probably: shared app filesystem, separate message histories, completion summary bridges them.

3. **Conflict resolution**: What if the background agent and interactive agent both write to the same file? Unlikely with current pipeline (design writes design.md, interview writes business-details.md) but needs a rule.

4. **askQuestion rendering**: Currently `askQuestion` pauses the agent and waits for user input via the main connection. In a sidecar session, the client needs to route user responses to the correct channel. UI needs to show which agent is asking.

5. **Cost**: Two concurrent agent sessions = two context windows. The sidecar agent's context is small (just the skill + Q&A), so this isn't expensive. The main benefit is that the orchestrator's large context window isn't held open waiting for user input.

## Comparison to Reverted Approach

| Aspect | Fire-and-forget (reverted) | Client-side orchestration (proposed) |
|--------|---------------------------|--------------------------------------|
| Background agent | Non-blocking, results polled/injected | Blocking in main loop (normal) |
| Interactive agent | Server-side handoff (blocks orchestrator) | Client-driven sidecar (parallel) |
| Polling cost | High (LLM calls to check status) | None (client signals completion) |
| Complexity | Registry, cleanup, injection | Second stream, client routing |
| Reliability | Fragile (sessionId mismatch, lost results) | Straightforward (client controls lifecycle) |

## Implementation Scope

This is a significant refactor touching:
- `run-agent.ts` — new return type for client-interactive mode
- Client-side agent session manager (new)
- SSE/WS transport — sidecar stream support
- `askQuestion` rendering — channel awareness
- Orchestrator prompt — updated dispatch semantics
- RunAgentToolRenderer — renders the interactive agent initiation UI

Estimated effort: 2-3 days of focused work. Worth doing when the pipeline stability justifies the investment.
