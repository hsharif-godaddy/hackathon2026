# Phase 2: Synthesize Frontend Report

Write a concise Slack-ready frontend-only report.

Required sections:

**App:** `{appId}`

**What I checked**
- State that this run checked `source=airo-app` logs only.
- Include window and fetched log count from the index.
- If coverage is incomplete, say so here and in Unknowns.

**What happened**
- Timeline bullets with timestamps and raw refs.

**Why / likely cause**
- Separate CONFIRMED from SUSPECTED.
- Do not infer from customer feedback alone.

**Recommended fix**
- Concrete next steps grounded in the observed frontend logs.

**Unknowns**
- Missing or incomplete buckets.
- Any required source outside `airo-app`, explicitly marked out of scope.

Keep it under 40 lines unless the evidence truly needs more detail.
