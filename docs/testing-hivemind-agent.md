# Testing the `airo-builder-initial-agent` Hivemind experiment

End-to-end verification that a user lands in a Hivemind cohort, the agent-token BFF maps that cohort to an agent profile, and the agents service routes to the matching initial agent.

Cohort → profile mapping lives in `app/src/config/experiments.ts` (`INITIAL_AGENT_COHORT_TO_PROFILE`). Precedence and sentinel contract are documented in `app/CLAUDE.md` under "Layer 3 — Hivemind experiments".

## Step 1: Verify you are in the test

From the homepage in your browser:

```js
console.log(window.gasketData?.switchboard)
```

You should see a `airo-builder-initial-agent` key with `cohortId` set to one of the experiment cohorts (e.g. `initial_agent_v1`, `initial_agent_v3`).

If the experiment is missing entirely or `cohortId` is `ineligible` / `unassigned` / `not_bucketed`, traffic in the Hivemind environment you're testing is most likely below 100% — bump it to 100% and wait ~2 min for the Switchboard cache to refresh.

## Step 2: Verify the JWT carries the right `agentProfile`

In the browser console on the airo-builder app domain, fetch a fresh token for an existing app and decode the JWT:

```js
fetch('/api/auth/agent-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ siteId: '<your-app-id>' })
})
  .then(r => r.json())
  .then(d => {
    console.log('response:', d);
    const tok = d.token || d.accessToken;
    if (tok) console.log('JWT claims:', JSON.parse(atob(tok.split('.')[1])));
  });
```

Expected `agentProfile` claim depends on the `appbuilder-agent-profile` Switchboard value for the env you're testing:

| Switchboard `appbuilder-agent-profile` | Your cohort | Expected `agentProfile` in JWT |
|---|---|---|
| `'hivemind'` or `'default'` | `initial_agent_v3` | `'initial-agent-v3'` ✓ test working |
| `'hivemind'` or `'default'` | `initial_agent_v1` | `'initial-agent-v1'` ✓ test working |
| `'hivemind'` or `'default'` | `ineligible` / unassigned | `undefined` (no profile) |
| Real profile name (e.g. `'initial-agent-v3'`) | any | that real name — operator override is winning, **experiment is being bypassed** |
| Real profile name (e.g. `'prompt-enhancer'`) | any | `'prompt-enhancer'` — targeted operator override winning |

If the JWT shows a profile that doesn't match your cohort, the Switchboard value isn't deferring to Hivemind. Go to the Switchboard UI for the env you're in and set `appbuilder-agent-profile` default to `'hivemind'` (or `'default'`). Targeted internal-account overrides should remain as real profile names.

## Step 3: Verify the agents service routed to the matching initial agent

Local: `tail -f agents/dev.log | grep -A 1 -E 'agent_router.initial_selected|profile.resolve'` (`-A 1` because the structured `profileName` / `agentId` field is on the line after the log header).

Deployed: in Grafana Loki, run `{job="airo-agents", env="dev"} |= "agent_router.initial_selected"` and filter to your appId.

Look for an `agent_router.initial_selected` log line for your appId:

| `agentId` field | Meaning |
|---|---|
| `initial` | Legacy 1.0 path. Expected for the `initial_agent_v1` cohort (profile pins `initial.promptVersion: 1.0`, which falls through to default routing). |
| `initial-v3` | 3.0 modular prompts. Expected for the `initial_agent_v3` cohort. |
| `initial-<template>` | A template-specific initial agent was selected because the request specified a `templateId`. Profile is ignored on this branch. |

If you see `profile.resolve.unknown` warnings, the JWT carried a profile name that doesn't match a registered profile in `agents/src/profiles/`. Usually a Switchboard typo (e.g. underscores vs hyphens) — fix the value and re-test.

## Step 4 (optional): Force yourself into the other arm

To verify both arms end-to-end without waiting for re-bucketing:

1. In the Hivemind UI for `airo-builder-initial-agent`, add yourself as a shopper-ID override pinned to the other cohort.
2. Wait ~2 min for the Switchboard cache to propagate.
3. Hard-reload the homepage and repeat steps 1–3.

## Step 5: Verify the exposure event fires (denominator check)

The experiment denominator fires when the initial prompt is sent to the agent. In the browser console after triggering the initial-build flow on a fresh app:

```js
window._expDataLayer.filter(e => e.data?.eid?.includes('initialBuild.start'))
```

You should see one event with `eid: 'appbuilder.develop.initialBuild.start.impression'`. The cohort assignment is auto-merged into `custom_properties.cohort` via the analytics layer. If this event never fires, the funnel start isn't being logged and your experiment will have no denominator — see `app/src/hooks/shared/initialBuildFunnel.ts` and `docs/initial-build-funnel-events.md`.

## Common failure modes

- **No `airo-builder-initial-agent` key in `window.gasketData.switchboard`:** dev server hasn't been restarted since adding the experiment to `gasket.ts`, AWS_PROFILE not set locally, or the experiment isn't in the running state in Hivemind for that env. The `airo-builder` app label must be attached to the experiment.
- **Cohort assigned but no `agentProfile` in JWT:** cohort name in Hivemind doesn't match a key in `INITIAL_AGENT_COHORT_TO_PROFILE`. Either rename the cohort or update the map.
- **`agentProfile` set but doesn't match cohort:** Switchboard `appbuilder-agent-profile` is overriding with a real profile name. Set it to `'hivemind'` or `'default'` to defer.
- **`profile.resolve.unknown` warnings in agents service:** profile name in JWT isn't registered in `agents/src/profiles/`. Add the profile JSON or fix the Switchboard/cohort value.
