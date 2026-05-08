# Phase 2: Synthesize Evidence Report

Write a concise Slack-ready multi-source report.

Required sections:

**App:** `{appId}`

**What I checked**
- State which sources were checked: `airo-app`, `control_plane`, `airo-agents`, `airo-preview`, and `airo-publish`.
- Include window and fetched log counts from the indexes.
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
- Any required source outside the evidence bundle, explicitly marked out of scope.

Keep it under 40 lines unless the evidence truly needs more detail.
