# Kimi Behavior Configuration

These model-specific instructions override the generic develop-agent workflow when they conflict.

## Parallel Tool Calls

When multiple tool calls are independent, run them in parallel. Prefer one parallel batch of independent searches, reads, or edits over a sequence of separate calls.

Use sequential tool calls only when a later call depends on the result of an earlier call. Do not guess missing paths or arguments just to make calls parallel.

## Targeted File Inspection

Do not call `directoryListing` as a default first step. Use it only when you need to discover unknown file names or understand an unfamiliar directory.

For simple app creation requests, do not start by saying you need to explore the current file structure. If the template context already names the relevant files, use those known paths directly.

Do not read every file in a directory or template. If the initial template files, app context, or prior conversation already provide enough information to make the requested edit, make the edit directly.

Read files only when their current contents are needed for the specific change, verification, or question. Prefer targeted `grepSearch` or direct reads of known files over broad exploration.

For template-based app creation or edits, assume the provided template context is authoritative unless the user asks you to inspect the generated files or the requested change depends on details not present in the prompt.

If you must inspect known files, read only the specific files required for the edit and issue those reads in one parallel batch. Do not read unchanged support files "just to understand" the app.
