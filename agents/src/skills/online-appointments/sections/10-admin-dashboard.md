## § Admin Dashboard

### 10.1 Admin Routes

**For appointment listing, use the shipped `GET /api/appointments?includeOrderStatus=true`
endpoint** — it already enriches each row with live payment status from the provider. You
only need a thin admin-only wrapper if you want to gate it behind auth. The example below is
the additional cancel/reschedule endpoint.

**File: `src/server/api/admin/appointments/[id]/PATCH.ts`**

```typescript
import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db/client';
import { appointment } from '../../../../db/schema';

export default async function handler(req: Request, res: Response) {
  const { id } = req.params;
  const { status, startTime, endTime } = req.body as {
    status?: 'cancelled';
    startTime?: string;  // ISO timestamp
    endTime?: string;    // ISO timestamp
  };

  const rows = await db.select().from(appointment).where(eq(appointment.id, id)).limit(1);

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  if (status === 'cancelled') {
    await db.update(appointment)
      .set({ status: 'cancelled' })
      .where(eq(appointment.id, id));
    return res.json({ success: true });
  }

  if (startTime || endTime) {
    await db.update(appointment)
      .set({
        startTime: startTime ? new Date(startTime) : rows[0].startTime,
        endTime: endTime ? new Date(endTime) : rows[0].endTime,
      })
      .where(eq(appointment.id, id));
    return res.json({ success: true });
  }

  return res.status(400).json({ error: 'No updates provided' });
}
```

Reschedules update `startTime`/`endTime` (timestamps) — there are no separate `date` / `time`
columns. Cancellation emails, if you want them, are a separate function modeled on the
`sendConfirmationEmail` recipe in § 9.2.

### 10.2 Admin Dashboard UI

**File: `src/pages/AdminDashboard.tsx`** (Vite + React Router; register at `/admin` in
`src/App.tsx`. No `'use client'` directive.)

```typescript
import { useEffect, useState } from 'react';
import { formatMoney } from '@/lib/appointments';

interface AdminAppointment {
  id: string;
  customerName: string;
  customerEmail: string;
  date: string;       // 'YYYY-MM-DD'
  time: string;       // 'HH:mm'
  status: string;
  amount?: number;    // smallest currency unit; undefined if free
  currency?: string;  // ISO 4217 from config
  displayStatus: string;
}

export default function AdminDashboard() {
  const [appointments, setAppointments] = useState<AdminAppointment[]>([]);

  useEffect(() => {
    fetch('/api/appointments?includeOrderStatus=true')
      .then((res) => res.json())
      .then((data) => setAppointments(data.appointments));
  }, []);

  async function cancelAppointment(id: string) {
    await fetch(`/api/admin/appointments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    setAppointments((prev) => prev.filter((appt) => appt.id !== id));
  }

  return (
    <main className="admin-dashboard">
      <h1>Admin Dashboard</h1>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Customer</th>
            <th>Email</th>
            <th>Status</th>
            <th>Amount</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((appt) => (
            <tr key={appt.id}>
              <td>{appt.date}</td>
              <td>{appt.time}</td>
              <td>{appt.customerName}</td>
              <td>{appt.customerEmail}</td>
              <td>{appt.displayStatus}</td>
              {/* "Free" should fire only when there's no amount. If amount is set but
                  currency somehow isn't, the GET handler is misbehaving — fall back to USD
                  rather than relabel the row as free. */}
              <td>{appt.amount == null ? 'Free' : formatMoney(appt.amount, appt.currency ?? 'USD')}</td>
              <td>
                {appt.status === 'confirmed' && (
                  <button onClick={() => cancelAppointment(appt.id)}>Cancel</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```
