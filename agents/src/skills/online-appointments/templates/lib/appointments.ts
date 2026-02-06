import { addMinutes, format, parse, isAfter, isBefore, isSameDay, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import { z } from 'zod';

/**
 * Configuration Schema - validates config at runtime
 */
export const AppointmentsConfigSchema = z.object({
  serviceName: z.string().min(1, 'Service name is required').max(100, 'Service name too long'),
  duration: z.number().int().min(5, 'Minimum 5 minutes').max(480, 'Maximum 8 hours'),
  businessHoursStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use HH:mm format'),
  businessHoursEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use HH:mm format'),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'At least one working day required'),
});

export type AppointmentsConfig = z.infer<typeof AppointmentsConfigSchema>;

/**
 * Default configuration - used until config file is created
 */
const defaultConfig: AppointmentsConfig = {
  serviceName: 'Consultation',
  duration: 60,
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  workingDays: [1, 2, 3, 4, 5],
};

/**
 * Load and validate configuration
 * Tries to load from appointments.config.ts, falls back to defaults
 */
async function loadConfig(): Promise<AppointmentsConfig> {
  try {
    const { config: userConfig } = await import('./appointments.config');
    const result = AppointmentsConfigSchema.safeParse(userConfig);
    if (result.success) {
      return result.data;
    }
    console.warn('Invalid appointments config, using defaults:', result.error.message);
    return defaultConfig;
  } catch {
    return defaultConfig;
  }
}

export const config: AppointmentsConfig = await loadConfig();

/**
 * Zod schemas for input validation
 */
export const AppointmentInputSchema = z.object({
  customerName: z.string().min(1, 'Name is required').max(255, 'Name too long (max 255 characters)'),
  customerEmail: z.string().email('Invalid email format'),
  customerPhone: z.string().regex(/^[\d\s\-+()]*$/, 'Invalid phone format').max(50).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Use YYYY-MM-DD'),
  time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format. Use HH:mm'),
  notes: z.string().max(5000, 'Notes too long (max 5000 characters)').optional(),
});

export type AppointmentInput = z.infer<typeof AppointmentInputSchema>;

export interface TimeSlot {
  time: string;
  available: boolean;
}

export interface Appointment {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  startTime: Date;
  endTime: Date;
  status: 'confirmed' | 'cancelled' | 'completed';
  notes?: string;
  createdAt: Date;
}

export interface BookingRequest {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  date: string; // YYYY-MM-DD format
  time: string; // HH:mm format (24-hour)
  notes?: string;
}

/**
 * Check if a given date is a working day
 */
export function isWorkingDay(date: Date): boolean {
  return config.workingDays.includes(date.getDay());
}

/**
 * Parse time string (HH:mm) and combine with a date
 * Creates a Date object with the specified time on the given date
 */
export function parseTimeSlot(timeStr: string, date: Date): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  let result = new Date(date);
  result = setHours(result, hours);
  result = setMinutes(result, minutes);
  result = setSeconds(result, 0);
  result = setMilliseconds(result, 0);
  return result;
}

/**
 * Extract time string (HH:mm) from a Date object
 */
export function extractTimeString(date: Date): string {
  return format(date, 'HH:mm');
}

/**
 * Check if a slot ending at slotEnd fits within business hours
 */
function slotFitsInBusinessHours(slotEnd: Date, dayEnd: Date, endTime: string): boolean {
  if (isBefore(slotEnd, dayEnd)) return true;
  return isSameDay(slotEnd, dayEnd) && format(slotEnd, 'HH:mm') <= endTime;
}

/**
 * Generate all possible time slots for a given date
 */
export function generateTimeSlots(date: Date): string[] {
  const slots: string[] = [];
  const start = config.businessHoursStart;
  const end = config.businessHoursEnd;
  const duration = config.duration;

  const dayStart = parse(start, 'HH:mm', date);
  const dayEnd = parse(end, 'HH:mm', date);

  let current = dayStart;
  let slotEnd = addMinutes(current, duration);

  while (slotFitsInBusinessHours(slotEnd, dayEnd, end)) {
    slots.push(format(current, 'HH:mm'));
    current = slotEnd;
    slotEnd = addMinutes(current, duration);
  }

  return slots;
}

/**
 * Check if a date is in the past (before today)
 */
export function isPastDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate < today;
}

/**
 * Check if a specific time slot is in the past
 */
export function isPastTimeSlot(date: Date, time: string): boolean {
  const now = new Date();
  const slotDateTime = parseTimeSlot(time, date);
  return slotDateTime <= now;
}

/**
 * Get available time slots for a date, excluding already booked slots
 * Uses string-based time comparison to avoid timezone issues
 */
export function getAvailableSlots(
  date: Date,
  existingAppointments: Array<{ startTime: Date; endTime: Date; status: string | null }>
): TimeSlot[] {
  // Non-working days have no slots
  if (!isWorkingDay(date)) {
    return [];
  }

  // Past dates have no available slots
  if (isPastDate(date)) {
    return generateTimeSlots(date).map((time) => ({ time, available: false }));
  }

  const allSlots = generateTimeSlots(date);
  const now = new Date();
  const isToday = isSameDay(date, now);
  const currentTimeStr = format(now, 'HH:mm');

  // Extract booked time slots as strings for reliable comparison
  const bookedTimeSlots = new Set(
    existingAppointments
      .filter((apt) => apt.status !== 'cancelled')
      .map((apt) => extractTimeString(new Date(apt.startTime)))
  );

  return allSlots.map((time) => {
    // Check if slot is in the past (for today)
    if (isToday && time <= currentTimeStr) {
      return { time, available: false };
    }

    // Check if this exact time slot is already booked
    if (bookedTimeSlots.has(time)) {
      return { time, available: false };
    }

    // For overlapping appointments (longer duration), check time range conflicts
    const slotStart = parseTimeSlot(time, date);
    const slotEnd = addMinutes(slotStart, config.duration);

    const hasConflict = existingAppointments.some((apt) => {
      if (apt.status === 'cancelled') return false;

      const aptStart = new Date(apt.startTime);
      const aptEnd = new Date(apt.endTime);

      // Check for any overlap between [slotStart, slotEnd) and [aptStart, aptEnd)
      return (
        (isAfter(slotStart, aptStart) && isBefore(slotStart, aptEnd)) ||
        (isAfter(slotEnd, aptStart) && isBefore(slotEnd, aptEnd)) ||
        (isBefore(slotStart, aptStart) && isAfter(slotEnd, aptEnd)) ||
        slotStart.getTime() === aptStart.getTime()
      );
    });

    return { time, available: !hasConflict };
  });
}

/**
 * Calculate end time based on start time and service duration
 */
export function calculateEndTime(startTime: Date): Date {
  return addMinutes(startTime, config.duration);
}

/**
 * Format appointment time for display
 */
export function formatAppointmentTime(date: Date): string {
  return format(date, 'h:mm a');
}

/**
 * Format appointment date for display
 */
export function formatAppointmentDate(date: Date): string {
  return format(date, 'EEEE, MMMM d, yyyy');
}

/**
 * Generate a unique appointment ID using cryptographically secure UUID
 * Uses global crypto.randomUUID() which works in both Node.js and browsers
 */
export function generateAppointmentId(): string {
  return `apt-${crypto.randomUUID()}`;
}
