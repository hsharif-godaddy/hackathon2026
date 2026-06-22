# Contact Form — Generation Requirements & Submission Contract

After `setup_form` succeeds, **generate a form component** tailored to the user's request. The form can have any design, layout, or fields — the only requirements are:

1. It POSTs JSON to `/api/contact/{formName}` (e.g. `/api/contact/contact-us`) using the submission contract below
2. The body includes `user.email` at minimum
3. **`messages_attributes[0].body` is REQUIRED by the server** (400 error if missing or empty). The submit handler must always send a non-empty body. If the form has no message textarea, or the user leaves it blank, use a default value such as `"New contact form submission"`. Never POST with an empty or missing body.
4. It handles loading, success, and error states
5. **EVERY form field that is rendered MUST be read in the submit handler and included in the payload.** No exceptions. If a field appears in the UI, its value must appear in either `user` (email/name) or `conversation.data` (everything else). Never render a field without wiring it into the submission.
6. **Include a honeypot field.** A hidden text input that real users never see. The submit handler must NOT include it in the POST body — the server route drops submissions silently when it is non-empty.

```tsx
{/* Honeypot — positioned off-screen, never included in POST body */}
<input
  type="text"
  name="_gotcha"
  tabIndex={-1}
  autoComplete="off"
  style={{ position: "absolute", left: "-9999px" }}
  aria-hidden="true"
/>
```

Example — a checkbox labeled "Existing customer" must be read and included:

```typescript
const existingCustomer = data.get('existing-customer') === 'on';

body: JSON.stringify({
  conversation: {
    messages_attributes: [{ body: message }],
    data: {
      __gd_contact_form_title: 'Contact Us',
      'Existing customer': existingCustomer ? 'Yes' : 'No',
    },
  },
  user: { email, name },
})
```

## Submission Contract

The form MUST POST JSON to `/api/contact/{formName}` matching:

```json
{
  "conversation": {
    "messages_attributes": [{ "body": "The visitor's message" }],
    "data": {
      "__gd_contact_form_title": "Contact Us",
      "What can we help with?": "Order Status"
    }
  },
  "user": {
    "email": "visitor@example.com",
    "name": "Visitor Name"
  }
}
```

**Field mapping rules:**

- `messages_attributes[0].body` — **REQUIRED.** Use the message textarea value if provided; otherwise fall back to a default like `"New contact form submission"`. Must be non-empty — the server rejects submissions without it. Never concatenate other field values into the message body.
- `conversation.data` — ALL additional form fields (dropdowns, radio buttons, checkboxes, hidden fields) go here as key-value pairs. The key MUST be the field's label text (e.g. a dropdown labeled "What can we help with?" with value "Order Status" becomes `"What can we help with?": "Order Status"` in `data`).
- `user.email` / `user.name` — visitor identity fields.
- `__gd_contact_form_title` — always include in `data`, set to the form's heading.

**Do NOT concatenate extra fields into the message body** (e.g. `[${topic}] ${message}` is wrong). Each field must be its own key in `conversation.data` so it appears as structured metadata in the inbox.

The server route handles all backend communication — the form only needs to POST the shape above.
