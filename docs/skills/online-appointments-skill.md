# Online Appointments Skill

Add appointment/booking functionality to customer sites.

## Overview

| Item               | Details                          |
| ------------------ | -------------------------------- |
| **Skill Name**     | `online-appointments`            |
| **Booking URL**    | `/book`                          |
| **API Base**       | `/api/appointments`              |
| **Database Table** | `appointment`                    |
| **Config File**    | `src/lib/appointments.config.ts` |

## When to Use

Use this skill when customers want:

- Appointment scheduling
- Booking system for services
- Consultation booking
- Meeting scheduling
- Session booking (haircuts, massages, etc.)

## Test Prompts

```
"Add appointment booking to my site"
"I want customers to be able to book consultations"
"Add a booking page for my web agency"
"Add appointment booking with 45-minute sessions, Tuesday through Saturday 10am-6pm"
"Set up booking for hair styling appointments, 30 minutes each"
"Create appointments for doctors listed on my website"
```


## What Agent Creates

The agent creates all files from scratch:

- `src/components/appointments/` - DatePicker, TimeSlotPicker, BookingForm components
- `src/lib/appointments.ts` - Utility functions with config schema
- `src/lib/appointments-client.ts` - API client class
- `src/lib/appointments.config.ts` - Configuration with user values
- `src/server/api/appointments/` - API routes (availability, create)
- `src/pages/BookAppointment.tsx` - Custom booking page
- Route in `src/routes.tsx` at `/book`
- Database schema in `schema.ts`

## Configuration

Agent collects from user:

| Field              | Type     | Example                |
| ------------------ | -------- | ---------------------- |
| serviceName        | string   | "Hair Styling"         |
| duration           | number   | 45 (minutes, 5-480)    |
| businessHoursStart | string   | "10:00" (HH:mm)        |
| businessHoursEnd   | string   | "18:00" (HH:mm)        |
| workingDays        | number[] | [1,2,3,4,5,6] (Mon-Sat)|

**Working day values:** 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

## API Endpoints

| Endpoint                                         | Method | Description              |
| ------------------------------------------------ | ------ | ------------------------ |
| `/api/appointments/availability?date=YYYY-MM-DD` | GET    | Get available time slots |
| `/api/appointments`                              | POST   | Create appointment       |

## Expected Agent Flow

1. Ask user for service name, duration, and business hours
2. Validate user input against constraints
3. Create appointment components (DatePicker, TimeSlotPicker, BookingForm)
4. Create utility functions and API client
5. Create config file with validated user values
6. Create API routes for availability and booking
7. Add database schema and run migrations
8. Create BookAppointment page using the created components
9. Add route to routes.tsx
10. Run type check
11. (Optional) Add navigation link

## Key Features

- Working day filtering based on configuration
- Business hours time slot generation
- Real-time availability checking via API
- Transaction-based booking prevents double-booking
- Past date/time blocking
- Zod schema validation

## Dependencies

- `date-fns` - Date manipulation
- `zod` - Runtime validation

## Post-Setup Enhancements

Optional features the agent can offer:

1. Email notifications for booking confirmations
2. Admin dashboard for managing appointments
3. Cancellation/rescheduling for customers
4. Google Calendar sync
