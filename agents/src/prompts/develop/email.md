## Email with Nodemailer

Use **Nodemailer** with SMTP for sending emails:

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'relay-hosting.secureserver.net',
  port: 25,
  secure: false,
});

await transporter.sendMail({
  from: 'sender@example.com',
  to: 'recipient@example.com',
  subject: 'Subject',
  text: 'Plain text body',
  html: '<p>HTML body</p>',
});
```
