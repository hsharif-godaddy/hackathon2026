# Migrating from Nodemailer

If you encounter existing customer code using `nodemailer` and `localhost:25`, migrate it to the helper. The gateway listens at `127.0.0.1:2525` alongside the legacy SMTP listener; both work today, but new code should always use the gateway.

## Mechanical Mapping

| Nodemailer | `sendEmail` |
| --- | --- |
| `transport.sendMail({ from, to, cc, bcc, subject, text, html, replyTo })` | `sendEmail({ from, to, cc, bcc, subject, text, html, replyTo })` |
| `transport.sendMail({ ..., attachments: [{ filename, content, contentType }] })` | `sendEmail({ ..., attachments: [{ filename, content: Buffer.from(content), contentType }] })` — `content` must be `Buffer`/`Uint8Array`. Wrap text content explicitly: `Buffer.from(text, 'utf-8')`. |
| `from: 'noreply@airoapp.ai'` (hardcoded) | omit `from` (gateway picks canonical sender — typically better) |

## Steps

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
