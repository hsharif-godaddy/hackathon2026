---
name: email
description: Send transactional email through the Airo email gateway
whenToUse: >-
  User wants to send transactional emails, add email-sending functionality, or implement
  notifications via email. Phrases like "send email", "email notification", "email when",
  "transactional email", "email relay", "nodemailer", "smtp" (legacy phrasings — see
  Migrating from Nodemailer below). NOT for contact forms — those should use the inbox
  skill, which provides a managed contact form with built-in email notifications and
  threaded replies.
intents:
  - send email/email notification/transactional email/email relay
---

# Email via the Airo Email Gateway

Send mail by `POST`ing JSON to the Airo email gateway. The gateway authors the RFC-5322 message, applies the platform's sender-identity policy, attaches required tracking headers, and forwards to the configured SMTP relay (the GoDaddy hosting relay in production). Customer code never touches SMTP.

This skill installs a small `sendEmail()` helper. All email-sending code in the app should call that helper — do not POST to the gateway directly, and do not import `nodemailer`.

---

## When to Use This Skill

- Send transactional emails (order confirmations, password resets, receipts).
- Implement contact forms.
- Send notifications (alerts, reminders, digests).
- Migrate existing Nodemailer/SMTP code to the gateway (see "Migrating from Nodemailer" below).

---

## Installation

```typescript
skill({ action: 'install', skill: 'email' });
```

This copies `src/server/email.ts` into the app. No `npm install` step — the helper uses native `fetch` and ships no runtime dependency.

After installation, import the helper:

```typescript
import { sendEmail } from '@/server/email';
```

---

## Critical Security Rules

### ⚠️ Sender Address (`from`) — Default to OMITTING

**Omit `from` by default.** The gateway picks the canonical sender per app — typically `<appId>@<defaultDomain>`, or `<appId>@<verifiedCustomDomain>` when the customer has attached and verified one. The gateway always knows the right answer; the app does not.

Set `from` only when the customer explicitly asks for a specific sender on a verified domain. When you do set it:

- It MUST be a hardcoded string literal in source. Never read it from form input, request bodies, query parameters, headers, or environment variables.
- The address must be on the platform default domain (with the app's local-part) or on a domain the customer has verified-attached. Anything else → 400. The error message lists the verified domains so you can correct it.

**Why hardcoded:** prevents end-users of the built app from spoofing the sender.

### ⚠️ Recipient Address (`to`) — STORE AS A SECRET

For transactional notifications where the recipient is fixed configuration (contact form admin, order alerts, system notifications), **request the address via `requestSecrets` and read it from `process.env` at runtime** — do not hardcode it, do not insert a placeholder, do not invent a TODO comment.

```typescript
requestSecrets({
  title: 'Contact form recipient',
  description: 'The email address that receives messages from your contact form.',
  secrets: [{ name: 'CONTACT_FORM_RECIPIENT_EMAIL', required: true }],
  mode: 'add',
});
```

Customer code then reads `process.env.CONTACT_FORM_RECIPIENT_EMAIL` and early-returns if unset (see the contact form pattern below). This matches the pattern other skills (`stripe`, `google-maps`) use for customer-supplied configuration: the secret flows through dev-supervisor's alloc-config and is editable via Settings later, no code change needed.

For per-user recipients (welcome emails, password resets, order receipts to a buyer), the recipient comes from your application data — pass it through directly, never hardcode and never read from request bodies sent by anonymous end-users.

### ⚠️ Don't Echo Gateway Errors to End-Users

The gateway returns helpful error messages in development that may include the customer's verified-domain list. In production these are sanitized, but customer code should still avoid surfacing the raw error string. Log it server-side and show a generic "we couldn't send your message — please try again" to the end-user.

---

## Sender Identity

The gateway resolves the sender per-app from configuration the app cannot see. There are three things to know:

1. **Default sender.** When `from` is omitted, the gateway uses `<appId>@<primaryDomain>`. Primary domain is the customer's verified-attached domain when one exists; otherwise the platform default (`airoapp.ai` in production).
2. **Attached custom domains.** When the customer attaches a domain via Settings, the gateway updates automatically. **No code change is required.** Existing `sendEmail({ ... })` calls start sending from the new domain on the next request.
3. **Unverified `from` rejection.** If you pass `from: "support@acme.com"` and `acme.com` is not on the app's verified-attached list, the gateway returns 400. The helper surfaces that as a thrown `Error` with the gateway's reason. This is intentional — silently rewriting would mask a misconfiguration.

---

## Quickstart

```typescript
import { sendEmail } from '@/server/email';

await sendEmail({
  to: 'customer@example.com',
  subject: 'Welcome',
  text: 'Thanks for signing up!',
  html: '<p>Thanks for signing up!</p>',
});
```

That's the entire surface. Both `text` and `html` are optional individually, but at least one is required. `to` accepts a single string or an array.

---

## Common Patterns

### Contact Form Handler

Before writing this handler, call `requestSecrets` to capture `CONTACT_FORM_RECIPIENT_EMAIL` from the user (see "Recipient Address" above). Then:

```typescript
import type { Request, Response } from 'express';
import { sendEmail } from '@/server/email';

export default async function handler(req: Request, res: Response) {
  const recipient = process.env.CONTACT_FORM_RECIPIENT_EMAIL;
  if (!recipient) {
    // The secret hasn't been set yet. Fail closed — sending to nowhere
    // would silently drop submissions; a 500 surfaces the misconfiguration.
    console.error('email.contact_form.recipient_unset');
    return res.status(500).json({ error: 'Email recipient not configured' });
  }

  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await sendEmail({
      to: recipient,
      replyTo: email, // so the recipient can reply directly to the submitter
      subject: `Contact form: ${name}`,
      text: `From: ${name} (${email})\n\n${message}`,
      // No html field — user input must not be interpolated into HTML without escaping.
    });
    res.json({ success: true });
  } catch (error) {
    console.error('email.send.failed', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
}
```

### Notification Email

```typescript
import { sendEmail } from '@/server/email';

export async function sendWelcomeEmail(userEmail: string) {
  await sendEmail({
    to: userEmail,
    subject: 'Welcome to Our App',
    text: 'Thanks for signing up!',
    html: '<h1>Welcome!</h1><p>Thanks for signing up!</p>',
  });
}
```

### Email With Attachment (e.g. .ics calendar invite)

`content` always takes raw bytes (`Buffer` or `Uint8Array`); the helper base64-encodes for the wire. Wrap text strings explicitly with `Buffer.from(text, 'utf-8')`:

```typescript
import { sendEmail } from '@/server/email';

export async function sendAppointmentConfirmation(
  customerEmail: string,
  icsContent: string,
) {
  await sendEmail({
    to: customerEmail,
    subject: 'Your appointment is confirmed',
    html: '<p>See attached calendar invite.</p>',
    attachments: [
      {
        filename: 'appointment.ics',
        content: Buffer.from(icsContent, 'utf-8'),
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
      },
    ],
  });
}
```

Binary attachments pass through the same way — read the file into a `Buffer`:

```typescript
import { readFile } from 'node:fs/promises';
import { sendEmail } from '@/server/email';

const pdf = await readFile('/tmp/receipt.pdf');
await sendEmail({
  to: customerEmail,
  subject: 'Your receipt',
  text: 'Receipt attached.',
  attachments: [
    { filename: 'receipt.pdf', content: pdf, contentType: 'application/pdf' },
  ],
});
```

---

## Error Handling

`sendEmail` throws on any failure (network error, validation error, gateway 4xx/5xx). Wrap calls in try/catch:

```typescript
try {
  const { messageId } = await sendEmail({ to, subject, text });
  console.log('email.send.ok', { messageId });
} catch (error) {
  console.error('email.send.failed', error);
  // Show a generic failure message to the end user — do not surface error.message.
}
```

The thrown error message includes the gateway's `messageId` when one was minted (useful for log correlation). Don't depend on the message format programmatically; treat any throw as "the email did not send."

---

## Limits

The gateway enforces these caps; the helper does not pre-validate. If you exceed any of them the call throws.

| Limit | Value |
| --- | --- |
| Total recipients (`to` + `cc` + `bcc`) | 100 |
| `subject` length | 998 bytes |
| `text` body | 1 MB |
| `html` body | 1 MB |
| Attachments per send | 10 |
| Decoded size per attachment | 2 MB |
| Total request body | 5 MB |

For mass mail or large attachments, batch into multiple sends or move the data out-of-band.

---

## Migrating from Nodemailer

If you encounter existing customer code using `nodemailer` and `localhost:25`, migrate it to the helper. The gateway listens at `127.0.0.1:2525` alongside the legacy SMTP listener; both work today, but new code should always use the gateway.

**Mechanical mapping:**

| Nodemailer | `sendEmail` |
| --- | --- |
| `transport.sendMail({ from, to, cc, bcc, subject, text, html, replyTo })` | `sendEmail({ from, to, cc, bcc, subject, text, html, replyTo })` |
| `transport.sendMail({ ..., attachments: [{ filename, content, contentType }] })` | `sendEmail({ ..., attachments: [{ filename, content: Buffer.from(content), contentType }] })` — `content` must be `Buffer`/`Uint8Array`. Wrap text content explicitly: `Buffer.from(text, 'utf-8')`. |
| `from: 'noreply@airoapp.ai'` (hardcoded) | omit `from` (gateway picks canonical sender — typically better) |

**Steps:**

1. Install the email skill if not already: `skill({ action: 'install', skill: 'email' })`.
2. Replace each `nodemailer.createTransport(...)` block with `import { sendEmail } from '@/server/email'`.
3. Replace each `transport.sendMail({ ... })` call with `await sendEmail({ ... })`.
4. Remove the hardcoded `from: 'noreply@airoapp.ai'` — let the gateway pick the canonical sender unless the customer has a specific custom-domain sender they want.
5. Remove `nodemailer` and `@types/nodemailer` from `package.json`.
6. Drop any unused imports.

The gateway's input shape was designed to mirror Nodemailer's, so most call sites translate one-for-one. Three differences to watch for:

- **No `Mail.Options` extras.** Fields like `priority`, `headers`, `dsn`, `envelope` aren't supported. If the customer was using them, ask whether they're load-bearing before dropping.
- **Attachments use a smaller schema.** The helper's `attachments` accepts only `{ filename, content, contentType? }`, and `content` must be `Buffer` or `Uint8Array` — Nodemailer accepted UTF-8 strings as text-attachment content; this helper does not. Wrap text strings as `Buffer.from(text, 'utf-8')`. Other Nodemailer attachment options (`path`, `href`, `cid`, `encoding`) aren't supported — read files into a Buffer first and pass the bytes.
- **`from` policy is enforced.** Nodemailer would happily send `from: 'whatever@anywhere.com'`; the gateway returns 400 unless the domain is verified-attached. Default to omitting.

---

## Key Rules Recap

- **Use `sendEmail` from `@/server/email`** — never POST to the gateway directly, never import `nodemailer`.
- **Default to omitting `from`** — the gateway picks the right sender per app.
- **Store fixed recipients as secrets via `requestSecrets`** (e.g. `CONTACT_FORM_RECIPIENT_EMAIL`) and read them from `process.env` — never hardcode and never insert TODO placeholders.
- **For per-user recipients, plumb the value through** — don't read recipient addresses from anonymous request bodies.
- **Hardcode `from` if you set it explicitly** — never read from end-user input.
- **Wrap in try/catch and don't surface raw errors** to end-users.
