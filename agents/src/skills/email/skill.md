---
name: email
description: Send emails via Nodemailer and local SMTP relay
whenToUse: User wants to send emails, add email functionality, or implement notifications via email. Phrases like "send email", "email notification", "nodemailer", "contact form", "email when", "smtp", "email relay", "transactional email".
dependencies:
  - nodemailer
devDependencies:
  - '@types/nodemailer'
---

# Email with Nodemailer

Use **Nodemailer** with the local SMTP relay for sending emails. Emails are routed through a real mail relay, so incorrect addresses cause deliverability failures and can damage sender reputation.

---

## When to Use This Skill

Load when users need to:

- Send transactional emails
- Implement contact forms
- Send notifications via email
- Add email functionality to their app

---

## Installation

### Step 1: Install Nodemailer

```typescript
skill({ action: 'install', skill: 'email' });
```

Installs `nodemailer` (runtime) and `@types/nodemailer` (devDependency). Nodemailer ships no bundled type declarations, so the types package is required for TypeScript validation — the skill installer handles both automatically.

---

## Critical Security Rules

### ⚠️ Sender Address (`from`) - MUST BE HARDCODED

Always set the `from` address to `noreply@airoapp.ai` by default. If the developer specifies a different sender address in this conversation, use that value **hardcoded** in the generated code.

**The `from` address must always be a hardcoded string in the source code.** Never read it from:

- Form input
- Request bodies
- Query parameters
- Environment variables (unless explicitly requested)
- Any runtime variable controlled by end-users

**Why:** This prevents end-users of the built app from spoofing the sender address.

### ⚠️ Recipient Address (`to`) - ALWAYS ASK USER

**Always ask the user for the recipient email address before writing email-sending code.** Do not use placeholder addresses like `user@example.com` or infer an address from context. If the user hasn't specified a recipient, prompt them for one.

---

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
  from: 'noreply@airoapp.ai', // MUST be hardcoded
  to: recipientEmail, // must be provided by the developer, never a placeholder
  subject: 'Welcome!',
  text: 'Plain text body',
  html: '<p>HTML body</p>',
});
```

---

## Common Patterns

### Contact Form Handler

```typescript
import type { Request, Response } from 'express';
import nodemailer from 'nodemailer';

// Must be provided by developer - ask user for the recipient address
const ADMIN_EMAIL = ''; // TODO: set recipient address — ask the user for this value

export default async function handler(req: Request, res: Response) {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const transport = nodemailer.createTransport({
    host: 'localhost',
    port: 25,
    secure: false,
  });

  try {
    await transport.sendMail({
      from: 'noreply@airoapp.ai', // Hardcoded sender
      to: ADMIN_EMAIL, // Recipient from developer configuration
      subject: `Contact form: ${name}`,
      text: `From: ${name} (${email})\n\n${message}`,
      // Note: No html field - user input should not be interpolated into HTML without escaping
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Email send failed:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
}
```

### Notification Email

```typescript
import nodemailer from 'nodemailer';

async function sendWelcomeEmail(userEmail: string) {
  const transport = nodemailer.createTransport({
    host: 'localhost',
    port: 25,
    secure: false,
  });

  await transport.sendMail({
    from: 'noreply@airoapp.ai',
    to: userEmail,
    subject: 'Welcome to Our App',
    text: 'Thanks for signing up!',
    html: '<h1>Welcome!</h1><p>Thanks for signing up!</p>',
  });
}
```

---

## Key Rules

- **`from` must be hardcoded** - Never allow end-users to control the sender address
- **Always ask for recipient** - Never use placeholder email addresses
- **Use localhost:25** - No authentication needed with local SMTP relay
- **secure: false** - TLS not required for local relay
- **Handle errors** - Email failures should not crash the application
