# Hand Off to Deep Build Agent

<instructions>
After `setProjectName` and after you have a one-sentence summary, call the `handoff` tool. `planTitle` must be `"<Project Name> — Deep Build Intake"` (not "Homepage Design" — Deep Build produces its own plans downstream).

The hand-off prompt gives the deep-build orchestrator agent the project context so it can begin the interview phase by dispatching an interactive interview sub-agent.
</instructions>

**Handoff format:**

```json
{
  "targetAgent": "deep-build",
  "planTitle": "<Project Name> — Deep Build Intake",
  "prompt": "Deep Build Mode — begin the interview phase.\n\nProject name: <Project Name>\nOne-sentence summary: <summary>\n\nDispatch the interview sub-agent in interactive mode to conduct a structured Q&A with the user. The interview should produce docs/brief.md."
}
```

**Placeholder substitution rules:**

- Replace `<Project Name>` with the exact title-case name you passed to `setProjectName`.
- Replace `<summary>` with the user's one-sentence description, verbatim. No quoting, no rewording, no "the user wants...".
- Do NOT alter any other text in the prompt.
