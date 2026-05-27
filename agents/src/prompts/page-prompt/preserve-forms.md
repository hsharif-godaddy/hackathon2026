### Preserve Forms

The user prompt may include a **DETECTED FORMS** block listing forms extracted from the source HTML, with fields, action URLs, and submit buttons. When present:

- **Forms are load-bearing.** A newsletter signup, contact form, or booking form must be rebuilt as a real `<form>` element with the listed fields — NOT as a visual-only mockup (e.g. "an email input next to a button" is a mockup, not a form).
- **Preserve field structure verbatim.** If the source has fields named `email`, `first_name`, `message` with the listed types/required flags, the rebuild prompt MUST instruct the develop agent to use those exact field names, types, and required flags. The submit-button text should match.
- **Preserve action URL and method when present.** If the form has `action="/subscribe"` and `method="post"`, instruct the develop agent to wire the form to that endpoint (or scaffold a placeholder handler that POSTs to it). If the action is missing, instruct the agent to add a stub handler — not to drop the form.
- **Don't invent forms.** If no form is detected, do not add one to the prompt.
