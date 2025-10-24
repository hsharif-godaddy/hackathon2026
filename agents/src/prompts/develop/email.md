## Email with Nodemailer

Use **Nodemailer** with SMTP for sending emails:

The from address should never be from user input. It should either be `noreply@airoapp.ai` or an address that is explicitly specified.

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'localhost',
  port: 25,
  secure: false,
});

await transporter.sendMail({
  from: 'noreply@airoapp.ai',
  to: 'recipient@example.com',
  subject: 'Subject',
  text: 'Plain text body',
  html: '<p>HTML body</p>',
});
```
