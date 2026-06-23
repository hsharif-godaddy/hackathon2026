---
name: email
description: Send transactional email through the Airo email gateway
whenToUse: >-
  User wants to send transactional emails, add email-sending functionality, or
  implement notifications via email. Phrases like "send email", "email
  notification", "email when", "notify by email", "transactional email",
  "welcome email", "order confirmation email", "email relay", "nodemailer",
  "smtp". NOT for
  contact forms — those should use the inbox skill, which provides a managed
  contact form with built-in email notifications and threaded replies.
intents:
  - send email/email notification/transactional email/email relay
  - welcome email/order confirmation/password reset email
  - migrate from nodemailer/smtp
---

# Email via the Airo Email Gateway

Send mail by `POST`ing JSON to the Airo email gateway. The gateway authors the RFC-5322 message, applies the platform's sender-identity policy, attaches required tracking headers, and forwards to the configured SMTP relay (the GoDaddy hosting relay in production). Customer code never touches SMTP.

This skill installs a small `sendEmail()` helper. All email-sending code in the app should call that helper — do not POST to the gateway directly, and do not import `nodemailer`.

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

### Sender Address (`from`) — Default to OMITTING

Omit `from` by default. The gateway picks the canonical sender per app — typically `<appId>@<defaultDomain>`, or `<appId>@<verifiedCustomDomain>` when the customer has attached and verified one. The gateway always knows the right answer; the app does not.

Set `from` only when the customer explicitly asks for a specific sender on a verified domain. When you do set it:

- It must be a hardcoded string literal in source. Never read it from form input, request bodies, query parameters, headers, or environment variables.
- The address must be on the platform default domain (with the app's local-part) or on a domain the customer has verified-attached. Anything else → 400.

Why hardcoded: prevents end-users of the built app from spoofing the sender.

### Recipient Address (`to`) — STORE AS A SECRET

For transactional notifications where the recipient is fixed configuration (order alerts, system notifications), request the address via `requestSecrets` and read it from `process.env` at runtime — do not hardcode it, do not insert a placeholder.

```typescript
requestSecrets({
  title: 'Notification recipient',
  description: 'The email address that receives notifications.',
  secrets: [{ name: 'NOTIFICATION_RECIPIENT_EMAIL', required: true }],
  mode: 'add',
});
```

Customer code then reads `process.env.NOTIFICATION_RECIPIENT_EMAIL` and **early-returns with an error if unset**. Never use a fallback — neither `|| 'user@example.com'` nor `?? 'user@example.com'`. The whole point of `requestSecrets` is that the address lives in configuration, not source code. The correct pattern:

```typescript
const recipient = process.env.NOTIFICATION_RECIPIENT_EMAIL;
if (!recipient) {
  console.error('email.recipient_unset');
  return res.status(500).json({ error: 'Email recipient not configured' });
}
```

A hardcoded fallback (even one the user mentioned in conversation) defeats the purpose — it bakes a personal email into source code that will be committed to git, shared, and published. Always early-return instead. This applies to any syntax that provides a default value: `||`, `??`, ternary, or variable assignment.

For per-user recipients (welcome emails, password resets, order receipts to a buyer), the recipient comes from your application data — pass it through directly.

### Don't Echo Gateway Errors to End-Users

Log errors server-side and show a generic "we couldn't send your message — please try again" to the end-user.

---

## Sender Identity

The gateway resolves the sender per-app from configuration the app cannot see:

1. **Default sender.** When `from` is omitted, the gateway uses `<appId>@<primaryDomain>`.
2. **Attached custom domains.** When the customer attaches a domain via Settings, the gateway updates automatically — no code change required.
3. **Unverified `from` rejection.** If you pass a `from` address on an unverified domain, the gateway returns 400.

---

## Import Path

Always import from `@/server/email` — this resolves to the installed helper regardless of where your file lives in the project:

```typescript
import { sendEmail } from '@/server/email';
```

Do not use relative paths like `'../../email.js'` — they break when files move.

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

Both `text` and `html` are optional individually, but at least one is required. `to` accepts a single string or an array.

---

## Common Patterns

### Notification Email (Welcome, Receipts, Alerts)

Keep email templates concise. Start with simple inline HTML — a short heading, a paragraph, and optionally a CTA link. Do not generate elaborate multi-table HTML email templates with full CSS unless the user explicitly asks for a polished design.

```typescript
import { sendEmail } from '@/server/email';

export async function sendWelcomeEmail(userEmail: string, name: string) {
  await sendEmail({
    to: userEmail,
    subject: 'Welcome to Our App',
    text: `Hi ${name}, thanks for signing up!`,
    html: `<h1>Welcome, ${name}!</h1><p>Thanks for signing up. You're all set.</p>`,
  });
}
```

Notice: no `from` field — the gateway picks the correct sender. The recipient is the user's own email (dynamic, from your app data).

### Email With Attachment

`content` takes raw bytes (`Buffer` or `Uint8Array`); the helper base64-encodes for the wire. Wrap text strings with `Buffer.from(text, 'utf-8')`:

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
}
```

---

## Anti-Patterns — Do Not Do These

| Anti-pattern | Why it's wrong | Correct approach |
| --- | --- | --- |
| `process.env.X \|\| 'a@b.com'` or `?? 'a@b.com'` | Hardcodes email in source; defeats requestSecrets | Early-return with 500 if env var unset |
| `from: req.body.email` | Sender spoofing — lets visitors forge the From header | Use `replyTo: req.body.email` instead |
| `import nodemailer from 'nodemailer'` | Bypasses the gateway; won't work at runtime | Use `sendEmail` from `@/server/email` |
| Generating 100+ line HTML email templates | Over-engineers the initial implementation | Start simple; elaborate only if asked |
| `import { sendEmail } from '../../email.js'` | Relative import breaks when files move | Always `import from '@/server/email'` |

---

## Limits

| Limit | Value |
| --- | --- |
| Total recipients (`to` + `cc` + `bcc`) | 100 |
| `subject` length | 998 bytes |
| `text` body | 1 MB |
| `html` body | 1 MB |
| Attachments per send | 10 |
| Decoded size per attachment | 2 MB |
| Total request body | 5 MB |

---

## Nodemailer Migration

When migrating existing Nodemailer/SMTP code to the gateway, load the detailed guide:

```typescript
skill({ action: 'loadReference', path: 'email/references/migrating-from-nodemailer' })
```
