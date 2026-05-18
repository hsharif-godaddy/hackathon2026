import { addMinutes, format, parse, isAfter, isBefore, isSameDay, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import { z } from 'zod';
import { logger } from './logger';

/**
 * Pricing Tier Schema - for variable pricing with multiple SKUs
 */
export const PricingTierSchema = z.object({
  /** Tier name/label (e.g., "30 minutes", "1 hour", "2 hours") */
  label: z.string().min(1).max(100),
  /** Duration in minutes for this tier */
  duration: z.number().int().min(5).max(480),
  /** Price in cents (e.g., 5000 for $50.00) */
  amount: z.number().int().min(0),
  /** Commerce SKU ID for this tier */
  skuId: z.string().min(1),
});

export type PricingTier = z.infer<typeof PricingTierSchema>;

/**
 * Configuration Schema - validates config at runtime
 */
export const AppointmentsConfigSchema = z.object({
  serviceName: z.string().min(1, 'Service name is required').max(100, 'Service name too long'),
  duration: z.number().int().min(5, 'Minimum 5 minutes').max(480, 'Maximum 8 hours'),
  businessHoursStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use HH:mm format'),
  businessHoursEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use HH:mm format'),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1, 'At least one working day required'),
  /**
   * ISO 4217 currency code used for display formatting and SKU lookup hints.
   *
   * IMPORTANT: This must match the currency the SKUs in your GoDaddy Commerce store are
   * priced in. GoDaddy Commerce derives the checkout currency from the SKU itself — this
   * config field is for our display layer only.
   *
   * Validated as three uppercase letters (ISO 4217 alphabetic). Rejecting malformed values
   * here is cheaper than discovering them later when `formatMoney` throws RangeError on the
   * first booking.
   */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Use ISO 4217 currency code (3 uppercase letters, e.g. USD, EUR, JPY)')
    .default('USD'),
  /** Pricing tiers with SKU mappings. Optional only for free appointments (no payment). */
  pricingTiers: z.array(PricingTierSchema).min(1).optional(),
}).refine(
  (config) => {
    // Skip validation if pricingTiers not present (free appointments only)
    if (!config.pricingTiers || config.pricingTiers.length === 0) {
      return true;
    }
    // Validate no duplicate amounts (prevents unreachable SKUs)
    const amounts = config.pricingTiers.map(t => t.amount);
    const uniqueAmounts = new Set(amounts);
    return uniqueAmounts.size === amounts.length;
  },
  {
    message: 'Pricing tiers must have unique amounts. Duplicate amounts make some SKUs unreachable.',
    path: ['pricingTiers'],
  }
);

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
  currency: 'USD',
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
    // Acceptable: logs top-level Zod message instead of per-field issues for simplicity.
    // Misconfigured fields (e.g. duplicate pricingTiers amounts) will show generic message.
    logger.warn('appointments.config.invalid', {
      error: result.error.message,
      message: 'Invalid appointments config, using defaults'
    });
    return defaultConfig;
  } catch (error) {
    // Import error (syntax error, missing file, etc.) - log before falling back to defaults
    logger.warn('appointments.config.load_failed', {
      error: error instanceof Error ? error.message : String(error),
      message: 'Failed to load appointments.config.ts, using defaults'
    });
    return defaultConfig;
  }
}

let _config: AppointmentsConfig | null = null;

/**
 * Get the appointments configuration.
 * Loads and caches config on first call; returns cached value thereafter.
 */
export async function getConfig(): Promise<AppointmentsConfig> {
  if (!_config) {
    _config = await loadConfig();
  }
  return _config;
}

/**
 * Synchronous config access for code that has already called getConfig().
 * Falls back to defaults if config hasn't been loaded yet.
 */
export function getConfigSync(): AppointmentsConfig {
  return _config ?? defaultConfig;
}

/**
 * Zod schemas for input validation
 */
export const AppointmentInputSchema = z.object({
  customerName: z.string().min(1, 'Name is required').max(255, 'Name too long (max 255 characters)'),
  customerEmail: z.email('Invalid email format'),
  customerPhone: z.string().regex(/^[\d\s\-+()]*$/, 'Invalid phone format').max(50).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Use YYYY-MM-DD'),
  time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid time format. Use HH:mm'),
  notes: z.string().max(5000, 'Notes too long (max 5000 characters)').optional(),
  requiresPayment: z.boolean().optional().default(false),
  amount: z.number().int().min(0).optional(),
}).refine(
  (data) => {
    // If payment required, amount must be present and > 0
    if (data.requiresPayment) {
      return data.amount !== undefined && data.amount > 0;
    }
    return true;
  },
  {
    message: 'Amount must be greater than 0 when payment is required',
    path: ['amount'],
  }
);

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
  requiresPayment: boolean;
  amount?: number;
  /** ISO 4217 currency code (display only — actual checkout currency is determined by the SKU). */
  currency: string;
  orderId?: string;
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
  return getConfigSync().workingDays.includes(date.getDay());
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
  const cfg = getConfigSync();
  const slots: string[] = [];
  const start = cfg.businessHoursStart;
  const end = cfg.businessHoursEnd;
  const duration = cfg.duration;

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
    const slotEnd = addMinutes(slotStart, getConfigSync().duration);

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
  return addMinutes(startTime, getConfigSync().duration);
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
 * Format a money amount for display.
 *
 * `amountMinor` is in the smallest currency unit (cents for USD, yen for JPY, fils for KWD).
 * The CLDR data behind Intl.NumberFormat knows the right number of fraction digits per
 * currency, so we divide by 10^fractionDigits to get the major-unit value before formatting.
 *
 * Server callers should pass an explicit `locale`. Browser callers can omit it to use the
 * user's locale.
 *
 * @example
 * formatMoney(8000, 'USD', 'en-US')   // "$80.00"
 * formatMoney(8000, 'EUR', 'de-DE')   // "80,00 €"
 * formatMoney(1000, 'JPY', 'ja-JP')   // "￥1,000"
 * formatMoney(1500, 'KWD', 'ar-KW')   // "1.500 د.ك."
 */
export function formatMoney(amountMinor: number, currency: string, locale?: string): string {
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const fractionDigits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  return fmt.format(amountMinor / Math.pow(10, fractionDigits));
}

/**
 * Generate a unique appointment ID using cryptographically secure UUID
 * Uses global crypto.randomUUID() which works in both Node.js and browsers
 */
export function generateAppointmentId(): string {
  return `apt-${crypto.randomUUID()}`;
}
