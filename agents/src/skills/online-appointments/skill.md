---
name: online-appointments
description: Add appointment/booking functionality - use when customer wants scheduling, booking, or appointments for services (consultations, meetings, sessions, haircuts, etc.)
dependencies:
  - date-fns
  - zod
---

# Online Appointments Skill

Add a simple appointment booking system for a single service with date/time selection, customer form, and availability checking.

---

## Quick Reference

| Item               | Details                          |
| ------------------ | -------------------------------- |
| **Booking URL**    | `/book`                          |
| **API Base**       | `/api/appointments`              |
| **Database Table** | `appointment`                    |
| **Config**         | `src/lib/appointments.config.ts` |

---

## Step 1: Ask User for Configuration

**IMPORTANT: Always ask these questions before proceeding.**

> "I'll set up appointment booking. Please tell me:
>
> 1. What's the service name? (e.g., 'Web Design Consultation', 'Haircut', 'Strategy Session')
> 2. How long is each appointment? (e.g., 30, 60, 90 minutes)
> 3. What are your business hours? (e.g., Mon-Fri 9am-5pm, Mon-Sat 10am-6pm)"

**Wait for user response before continuing.**

---

## Step 2: Validate User Input

| Field              | Type     | Validation                         |
| ------------------ | -------- | ---------------------------------- |
| serviceName        | string   | 1-100 characters, non-empty        |
| duration           | number   | Integer between 5-480 minutes      |
| businessHoursStart | string   | 24-hour format HH:mm (e.g., 09:00) |
| businessHoursEnd   | string   | 24-hour format HH:mm (e.g., 17:00) |
| workingDays        | number[] | Array of 0-6 (0=Sun, 6=Sat)        |

---

## Step 3: Install Skill Templates

```typescript
skill({ action: 'install', skill: 'online-appointments' });
```

This installs the backend:

- `src/lib/appointments.ts` - Utility functions, types, and config schema
- `src/lib/appointments-client.ts` - API client class
- `src/server/api/appointments/availability/GET.ts` - Availability endpoint
- `src/server/api/appointments/POST.ts` - Create appointment endpoint

---

## Step 4: Create Configuration File

Create `src/lib/appointments.config.ts` with Zod validation:

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  serviceName: z.string().min(1).max(100),
  duration: z.number().int().min(5).max(480),
  businessHoursStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  businessHoursEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1),
});

export const config = ConfigSchema.parse({
  serviceName: 'SERVICE_NAME',
  duration: DURATION,
  businessHoursStart: 'HH:mm',
  businessHoursEnd: 'HH:mm',
  workingDays: [DAYS],
});
```

**Working day values:** Mon-Fri = `[1,2,3,4,5]`, Mon-Sat = `[1,2,3,4,5,6]`, Tue-Sat = `[2,3,4,5,6]`

---

## Step 5: Add Database Schema

Add to `src/server/db/schema.ts`:

```typescript
export const appointment = mysqlTable('appointment', {
  id: varchar('id', { length: 50 }).primaryKey(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  customerEmail: varchar('customer_email', { length: 255 }).notNull(),
  customerPhone: varchar('customer_phone', { length: 50 }),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  status: varchar('status', { length: 20 }).default('confirmed'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

Run migrations: `npm run db:generate && npm run db:migrate`

---

## Step 6: Create UI Components

Create the following components in `src/components/appointments/`. Match the site's existing design patterns and styling.

### DatePicker Component

Create a calendar component for date selection.

**Props:**

- `selectedDate: Date | null` - Currently selected date
- `onSelect: (date: Date) => void` - Callback when date is selected
- `minDate?: Date` - Minimum selectable date (default: today)

**Features:**

- Month navigation (prev/next)
- Working day filtering using `isWorkingDay()` from `@/lib/appointments`
- Past date blocking
- Visual indication of selected date

**Integration:**

```typescript
import { isWorkingDay } from '@/lib/appointments';
```

### TimeSlotPicker Component

Create a time slot selection component that fetches availability from the API.

**Props:**

- `date: Date` - The selected date
- `selectedTime: string | null` - Currently selected time (HH:mm format)
- `onSelect: (time: string) => void` - Callback when time is selected

**Features:**

- Fetch available slots from API on date change
- Display slots as buttons/cards showing available/unavailable state
- Loading state while fetching
- Error handling

**Integration:**

```typescript
import { appointmentsClient } from '@/lib/appointments-client';

// Fetch availability
const { slots } = await appointmentsClient.getAvailability(format(date, 'yyyy-MM-dd'));
// slots = [{ time: "09:00", available: true }, { time: "10:00", available: false }, ...]
```

### BookingForm Component

Create a customer information form.

**Props:**

- `selectedDate: Date` - The selected date
- `selectedTime: string` - The selected time (HH:mm format)
- `onSubmit: (data: BookingData) => Promise<void>` - Submit callback
- `onBack: () => void` - Go back callback

**Fields:**

- `customerName` (required) - Text input
- `customerEmail` (required) - Email input
- `customerPhone` (optional) - Phone input
- `notes` (optional) - Textarea

**Features:**

- Form validation
- Submit loading state
- Error display
- Back button

**Integration:**

```typescript
import { appointmentsClient } from '@/lib/appointments-client';
import { formatAppointmentDate, formatAppointmentTime } from '@/lib/appointments';

// Submit booking
const result = await appointmentsClient.createAppointment({
  customerName,
  customerEmail,
  customerPhone,
  date: format(selectedDate, 'yyyy-MM-dd'),
  time: selectedTime,
  notes,
});
```

### Export Components

Create `src/components/appointments/index.ts`:

```typescript
export { DatePicker } from './DatePicker';
export { TimeSlotPicker } from './TimeSlotPicker';
export { BookingForm } from './BookingForm';
```

---

## Step 7: Create Booking Page

Create `src/pages/BookAppointment.tsx` with a multi-step flow:

1. **Step 1:** Select date (DatePicker)
2. **Step 2:** Select time (TimeSlotPicker)
3. **Step 3:** Fill form (BookingForm)
4. **Step 4:** Show confirmation

**Use the created components and utilities:**

```typescript
import { DatePicker, TimeSlotPicker, BookingForm } from '@/components/appointments';
import { config, formatAppointmentDate, formatAppointmentTime } from '@/lib/appointments';
```

Add route to `src/routes.tsx` at path `/book`.

---

## Step 8: Run Type Check

```bash
npm run type-check
```

---

## API Reference

| Endpoint                                         | Method | Description              |
| ------------------------------------------------ | ------ | ------------------------ |
| `/api/appointments/availability?date=YYYY-MM-DD` | GET    | Get available time slots |
| `/api/appointments`                              | POST   | Create appointment       |

**Availability Response:**

```typescript
{ date: string, slots: Array<{ time: string, available: boolean }> }
```

**Create Request:**

```typescript
{ customerName, customerEmail, customerPhone?, date, time, notes? }
```

**Create Response:**

```typescript
{
  (id, customerName, customerEmail, date, time, endTime, status, serviceName, duration);
}
```

---

## After Setup Complete

> "Appointment booking is now set up!
>
> - **Booking page:** `/book`
> - **Service:** [SERVICE_NAME] ([DURATION] minutes)
> - **Hours:** [BUSINESS_HOURS] on [WORKING_DAYS]
>
> **Would you like me to add any enhancements?**
>
> 1. Email notifications
> 2. Admin dashboard (with authN / authZ)
> 3. Cancellation/rescheduling
> 4. Google Calendar sync"

---
