## § Email Notifications

**PREREQUISITE: Install email skill first**

```typescript
skill({ action: 'install', skill: 'email' });
```

This provides email sending capabilities with proper configuration.

### 9.1 Calendar Invite Generator

**Create: `src/lib/calendar-invite.ts`**

```typescript
/**
 * Generate .ics calendar file for appointment
 */
export function generateICS(appointment: {
  id: string;
  serviceName: string;
  customerName: string;
  customerEmail: string;
  startTime: Date;
  endTime: Date;
  notes?: string;
  location?: string;
}): string {
  const startDate = formatDateForICS(appointment.startTime);
  const endDate = formatDateForICS(appointment.endTime);
  const now = formatDateForICS(new Date());
  
  // Escape special characters in text fields
  const escape = (str: string) => str.replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n');
  
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Appointment Booking//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${appointment.id}@appointments.local`,
    `DTSTAMP:${now}`,
    `DTSTART:${startDate}`,
    `DTEND:${endDate}`,
    `SUMMARY:${escape(appointment.serviceName)}`,
    `DESCRIPTION:${escape(`Appointment with ${appointment.customerName}${appointment.notes ? '\\n\\nNotes: ' + appointment.notes : ''}`)}`,
    `ATTENDEE;CN=${escape(appointment.customerName)}:mailto:${appointment.customerEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  
  return lines.join('\r\n');
}

/**
 * Format date for ICS file (YYYYMMDDTHHMMSSZ in UTC)
 */
function formatDateForICS(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}
```

### 9.2 Email Notification Function

**Create: `src/server/utils/appointment-email.ts`**

The `email` skill is a recipe (Nodemailer + local SMTP relay), not a runtime module — there
is no `sendEmail` export to import. Construct the transport inline, exactly as documented in
the email skill's `skill.md`:

```typescript
import nodemailer from 'nodemailer';
import { formatInTimeZone } from 'date-fns-tz';
import { generateICS } from '../../lib/calendar-invite';
import { getConfig, formatMoney } from '../../lib/appointments';

const FROM_ADDRESS = 'noreply@airoapp.ai'; // Hardcoded per email skill rules

interface ConfirmationEmailParams {
  customerEmail: string;
  customerName: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  amount?: number; // smallest currency unit; undefined if free
  notes?: string;
}

const transport = nodemailer.createTransport({
  host: 'localhost',
  port: 25,
  secure: false,
});

export async function sendConfirmationEmail(params: ConfirmationEmailParams) {
  const config = await getConfig();

  const icsContent = generateICS({
    id: `apt-${Date.now()}`,
    serviceName: config.serviceName,
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    startTime: params.startTime,
    endTime: params.endTime,
    notes: params.notes,
  });

  const dateStr = formatInTimeZone(params.startTime, config.timezone, 'EEEE, MMMM d, yyyy');
  const timeStr = formatInTimeZone(params.startTime, config.timezone, 'h:mm a');
  const priceStr = params.amount
    ? formatMoney(params.amount, config.currency, 'en-US')
    : 'Free';

  await transport.sendMail({
    from: FROM_ADDRESS,
    to: params.customerEmail,
    subject: `Appointment Confirmed: ${config.serviceName}`,
    html: `
      <h2>Your appointment is confirmed!</h2>
      <p><strong>Service:</strong> ${config.serviceName}</p>
      <p><strong>Date:</strong> ${dateStr}</p>
      <p><strong>Time:</strong> ${timeStr} (${config.timezone.replace(/_/g, ' ')})</p>
      <p><strong>Duration:</strong> ${params.duration} minutes</p>
      <p><strong>Price:</strong> ${priceStr}</p>
      ${params.notes ? `<p><strong>Notes:</strong> ${params.notes}</p>` : ''}
      <p>A calendar invite is attached — add it to your calendar so you don't miss your appointment.</p>
    `,
    attachments: [
      {
        filename: 'appointment.ics',
        content: icsContent,
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
      },
    ],
  });
}
```

**Notes:**
- The local SMTP relay on `localhost:25` is provided by the email skill's runtime environment.
- The `from` address is hardcoded (per the email skill's security rules) — never read it from
  user input or query parameters.
