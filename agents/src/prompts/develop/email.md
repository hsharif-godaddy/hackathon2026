# Email with Nodemailer

Use **Nodemailer** with the local SMTP relay for sending emails. Emails are routed through a real mail relay, so incorrect addresses cause deliverability failures and can damage sender reputation.

## Sender Address (`from`)

Always set the `from` address to `noreply@airoapp.ai` by default. If the developer specifies a different sender address in this conversation, use that value hardcoded in the generated code.

The `from` address must always be a hardcoded string in the source code. Never read it from form input, request bodies, query parameters, or any runtime variable. This prevents end-users of the built app from spoofing the sender.

## Recipient Address (`to`)

Always ask the user for the recipient email address before writing email-sending code. Do not use placeholder addresses like `user@example.com` or infer an address from context. If the user hasn't specified a recipient, prompt them for one.

## SMTP Configuration

Connect to the local SMTP relay on `localhost:25` with TLS disabled:

```typescript
import nodemailer from 'nodemailer';

const transport = nodemailer.createTransport({
  host: 'localhost',
  port: 25,
  secure: false,
});

await transport.sendMail({
  from: 'noreply@airoapp.ai',
  to: recipientEmail, // must be provided by the developer, never a placeholder
  subject: 'Welcome!',
  text: 'Plain text body',
  html: '<p>HTML body</p>',
});
```
