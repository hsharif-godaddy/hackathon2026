## § UI Components

### 6.1 Calendar Component

**Purpose:** Visual date picker with disabled past dates and non-working days.

**Create: `components/Calendar.tsx`**

```typescript
import { useState } from 'react';
import { addMonths, format, isSameMonth, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns';

interface CalendarProps {
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  workingDays: number[]; // 0=Sun..6=Sat — matches AppointmentsConfigSchema and date-fns getDay
}

export function Calendar({ selectedDate, onSelectDate, workingDays }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  // Headers are Sun..Sat, matching date-fns getDay() (0=Sun..6=Sat). Pad the grid with
  // empty leading cells so the month's first day lands under its correct weekday header.
  const leadingBlanks = Array.from({ length: getDay(monthStart) });

  function isDateAvailable(date: Date): boolean {
    // workingDays uses the same 0=Sun..6=Sat domain as date-fns getDay; do not remap.
    return workingDays.includes(getDay(date)) && date >= new Date();
  }

  return (
    <div className="calendar">
      <div className="calendar-header">
        <button onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}>←</button>
        <span>{format(currentMonth, 'MMMM yyyy')}</span>
        <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>→</button>
      </div>
      <div className="calendar-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day} className="calendar-day-header">{day}</div>
        ))}
        {leadingBlanks.map((_, i) => (
          <div key={`blank-${i}`} className="calendar-day-blank" />
        ))}
        {days.map((day) => {
          const available = isDateAvailable(day);
          const selected = selectedDate && format(day, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
          return (
            <button
              key={day.toString()}
              onClick={() => available && onSelectDate(day)}
              disabled={!available}
              className={`calendar-day ${selected ? 'selected' : ''} ${!available ? 'disabled' : ''}`}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

### 6.2 Time Slot Picker

**Purpose:** Shows available time slots for selected date.

**Create: `components/TimeSlotPicker.tsx`**

```typescript
interface TimeSlotPickerProps {
  slots: string[]; // ["09:00", "10:00", "11:00"]
  selectedTime: string | null;
  onSelectTime: (time: string) => void;
  bookedSlots: string[]; // Already booked times
  timezone?: string; // IANA timezone for display (e.g., "America/New_York")
}

export function TimeSlotPicker({ slots, selectedTime, onSelectTime, bookedSlots, timezone }: TimeSlotPickerProps) {
  return (
    <div className="time-slots">
      {slots.map((slot) => {
        const isBooked = bookedSlots.includes(slot);
        const isSelected = selectedTime === slot;
        return (
          <button
            key={slot}
            onClick={() => !isBooked && onSelectTime(slot)}
            disabled={isBooked}
            className={`time-slot ${isSelected ? 'selected' : ''} ${isBooked ? 'booked' : ''}`}
          >
            {slot}
            {isBooked && ' (Booked)'}
          </button>
        );
      })}
      {timezone && (
        <p className="text-sm text-muted-foreground mt-2">
          All times shown in {timezone.replace(/_/g, ' ')} time
        </p>
      )}
    </div>
  );
}
```

### 6.3 Pricing Tier Selector (Variable Pricing Only)

**Create: `components/PricingTierSelector.tsx`**

```typescript
import { formatMoney } from '@/lib/appointments';

interface PricingTier {
  label: string;
  duration: number;
  amount: number;
  skuId: string;
}

interface PricingTierSelectorProps {
  tiers: PricingTier[];
  currency: string;            // ISO 4217 from config
  selectedTier: PricingTier | null;
  onSelectTier: (tier: PricingTier) => void;
}

export function PricingTierSelector({ tiers, currency, selectedTier, onSelectTier }: PricingTierSelectorProps) {
  return (
    <div className="pricing-tiers">
      <label>Select Service Type:</label>
      <div className="tier-options">
        {tiers.map((tier) => {
          const isSelected = selectedTier?.label === tier.label;
          return (
            <button
              key={tier.label}
              onClick={() => onSelectTier(tier)}
              className={`tier-option ${isSelected ? 'selected' : ''}`}
            >
              <div className="tier-label">{tier.label}</div>
              <div className="tier-duration">{tier.duration} minutes</div>
              <div className="tier-price">{formatMoney(tier.amount, currency)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```
