import {
  addMinutes,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  getDay,
  getHours,
  startOfDay,
  isBefore,
  isAfter,
  isEqual,
} from "date-fns";
import { TZDate } from "@date-fns/tz";

export interface RecurrenceRule {
  rule_type: "minutely" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  validations?: {
    day_of_week?: number[];
    hour_of_day?: number[];
    minute_of_hour?: number[];
  };
}

export interface ServiceSchedule {
  start_time: string;
  end_time: string;
  rrules?: RecurrenceRule[];
}

export function parseSchedule(scheduleJson: string | null): ServiceSchedule | null {
  if (!scheduleJson) return null;
  try {
    return JSON.parse(scheduleJson) as ServiceSchedule;
  } catch {
    return null;
  }
}

function parseNaiveDatetime(dateStr: string, timezone: string): TZDate {
  const [datePart, timePart] = dateStr.split("T");
  const [year, month, day] = (datePart ?? "").split("-").map(Number) as [number, number, number];
  const [hour, minute, second] = (timePart ?? "00:00:00").split(":").map(Number) as [
    number,
    number,
    number,
  ];
  return new TZDate(year, month - 1, day, hour, minute, second, timezone);
}

export function expandOccurrences(
  schedule: ServiceSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
  maxOccurrences?: number,
): Date[] {
  const schedEnd = parseNaiveDatetime(schedule.end_time, timezone);
  const effectiveRangeEnd = isBefore(schedEnd, rangeEnd) ? schedEnd : rangeEnd;

  if (!schedule.rrules || schedule.rrules.length === 0) {
    const singleStart = parseNaiveDatetime(schedule.start_time, timezone);
    if (
      (isAfter(singleStart, rangeStart) || isEqual(singleStart, rangeStart)) &&
      isBefore(singleStart, effectiveRangeEnd)
    ) {
      return [singleStart];
    }
    return [];
  }

  const allOccurrences: Date[] = [];
  for (const rule of schedule.rrules) {
    const schedStart = parseNaiveDatetime(schedule.start_time, timezone);
    const ruleOccurrences = expandRule(rule, schedule, schedStart, effectiveRangeEnd, timezone);
    allOccurrences.push(...ruleOccurrences);
  }

  allOccurrences.sort((a, b) => a.getTime() - b.getTime());

  const limited = maxOccurrences ? allOccurrences.slice(0, maxOccurrences) : allOccurrences;

  return limited.filter(
    (d) => (isAfter(d, rangeStart) || isEqual(d, rangeStart)) && isBefore(d, rangeEnd),
  );
}

function expandRule(
  rule: RecurrenceRule,
  schedule: ServiceSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): Date[] {
  switch (rule.rule_type) {
    case "minutely":
      return expandMinutely(rule, schedule, rangeStart, rangeEnd, timezone);
    case "hourly":
      return expandHourly(rule, schedule, rangeStart, rangeEnd, timezone);
    case "daily":
      return expandDaily(rule, schedule, rangeStart, rangeEnd, timezone);
    case "weekly":
      return expandWeekly(rule, schedule, rangeStart, rangeEnd, timezone);
    case "monthly":
      return expandMonthly(rule, schedule, rangeStart, rangeEnd, timezone);
    case "yearly":
      return expandYearly(rule, schedule, rangeStart, rangeEnd, timezone);
    default:
      return [];
  }
}

function expandMinutely(
  rule: RecurrenceRule,
  schedule: ServiceSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): Date[] {
  const safeInterval: number = rule.interval > 0 ? rule.interval : 1;
  const occurrences: Date[] = [];
  const schedStart: TZDate = parseNaiveDatetime(schedule.start_time, timezone);
  const effectiveStart: Date = isAfter(rangeStart, schedStart) ? rangeStart : schedStart;

  const dayStart: Date = startOfDay(new TZDate(effectiveStart, timezone));
  const dayEnd: Date = startOfDay(new TZDate(rangeEnd, timezone));

  let currentDay: Date = dayStart;
  while (!isAfter(currentDay, addDays(dayEnd, 1))) {
    const dow: number = getDay(currentDay);
    if (rule.validations?.day_of_week && !rule.validations.day_of_week.includes(dow)) {
      currentDay = addDays(currentDay, 1);
      continue;
    }

    const hours: number[] = rule.validations?.hour_of_day ?? Array.from({ length: 24 }, (_, i) => i);
    for (const hour of hours) {
      let cursor: TZDate = new TZDate(
        currentDay.getFullYear(),
        currentDay.getMonth(),
        currentDay.getDate(),
        hour,
        0,
        0,
        0,
        timezone,
      );

      const nextHour: Date = addMinutes(cursor, 60);
      while (isBefore(cursor, nextHour)) {
        if (
          (isAfter(cursor, effectiveStart) || isEqual(cursor, effectiveStart)) &&
          isBefore(cursor, rangeEnd)
        ) {
          occurrences.push(cursor);
        }
        cursor = addMinutes(cursor, safeInterval);
      }
    }

    currentDay = addDays(currentDay, 1);
  }

  return occurrences;
}

function expandHourly(
  rule: RecurrenceRule,
  schedule: ServiceSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): Date[] {
  const safeInterval: number = rule.interval > 0 ? rule.interval : 1;
  const occurrences: Date[] = [];
  const schedStart: TZDate = parseNaiveDatetime(schedule.start_time, timezone);
  const effectiveStart: Date = isAfter(rangeStart, schedStart) ? rangeStart : schedStart;

  let cursor: TZDate = new TZDate(effectiveStart, timezone);
  cursor = new TZDate(
    cursor.getFullYear(),
    cursor.getMonth(),
    cursor.getDate(),
    getHours(cursor),
    0,
    0,
    0,
    timezone,
  );

  while (isBefore(cursor, rangeEnd)) {
    const dow: number = getDay(cursor);
    const hour: number = getHours(cursor);
    const validDay: boolean = !rule.validations?.day_of_week || rule.validations.day_of_week.includes(dow);
    const validHour: boolean = !rule.validations?.hour_of_day || rule.validations.hour_of_day.includes(hour);

    if (
      validDay &&
      validHour &&
      (isAfter(cursor, effectiveStart) || isEqual(cursor, effectiveStart))
    ) {
      occurrences.push(cursor);
    }
    cursor = addMinutes(cursor, safeInterval * 60);
  }

  return occurrences;
}

function expandDaily(
  rule: RecurrenceRule,
  schedule: ServiceSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): Date[] {
  const safeInterval: number = rule.interval > 0 ? rule.interval : 1;
  const occurrences: Date[] = [];
  const schedStart: TZDate = parseNaiveDatetime(schedule.start_time, timezone);
  const effectiveStart: Date = isAfter(rangeStart, schedStart) ? rangeStart : schedStart;

  let cursor: TZDate = new TZDate(effectiveStart, timezone);
  while (isBefore(cursor, rangeEnd)) {
    const dow: number = getDay(cursor);
    if (!rule.validations?.day_of_week || rule.validations.day_of_week.includes(dow)) {
      occurrences.push(cursor);
    }
    cursor = addDays(cursor, safeInterval);
  }

  return occurrences;
}

function expandWeekly(
  rule: RecurrenceRule,
  schedule: ServiceSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): Date[] {
  const safeInterval: number = rule.interval > 0 ? rule.interval : 1;
  const occurrences: Date[] = [];
  const schedStart: TZDate = parseNaiveDatetime(schedule.start_time, timezone);
  const effectiveStart = isAfter(rangeStart, schedStart) ? rangeStart : schedStart;

  // Extract the time-of-day from the schedule start so each occurrence fires
  // at the correct hour/minute, not midnight.
  const tzSched = new TZDate(schedStart, timezone);
  const schedHour = tzSched.getHours();
  const schedMinute = tzSched.getMinutes();

  // Determine which days of the week are active (0=Sun … 6=Sat).
  // If no day_of_week validation, treat every day as valid.
  const activeDays: number[] =
    rule.validations?.day_of_week && rule.validations.day_of_week.length > 0
      ? [...rule.validations.day_of_week].sort((a, b) => a - b)
      : [0, 1, 2, 3, 4, 5, 6];

  // Find the Sunday that starts the week containing effectiveStart (in tz).
  const tzEffective = new TZDate(effectiveStart, timezone);
  const dowEffective = getDay(tzEffective);
  // Rewind to Sunday of that week
  let weekSunday = new TZDate(
    tzEffective.getFullYear(),
    tzEffective.getMonth(),
    tzEffective.getDate() - dowEffective,
    0,
    0,
    0,
    0,
    timezone,
  );

  while (isBefore(weekSunday, rangeEnd)) {
    for (const dow of activeDays) {
      const candidate = new TZDate(
        weekSunday.getFullYear(),
        weekSunday.getMonth(),
        weekSunday.getDate() + dow,
        schedHour,
        schedMinute,
        0,
        0,
        timezone,
      );

      if (
        (isAfter(candidate, effectiveStart) || isEqual(candidate, effectiveStart)) &&
        isBefore(candidate, rangeEnd)
      ) {
        occurrences.push(candidate);
      }
    }
    // Advance by interval weeks
    weekSunday = addWeeks(weekSunday, safeInterval);
  }

  return occurrences.sort((a, b) => a.getTime() - b.getTime());
}

function expandMonthly(
  rule: RecurrenceRule,
  schedule: ServiceSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): Date[] {
  const safeInterval: number = rule.interval > 0 ? rule.interval : 1;
  const occurrences: Date[] = [];
  const schedStart: TZDate = parseNaiveDatetime(schedule.start_time, timezone);
  const effectiveStart: Date = isAfter(rangeStart, schedStart) ? rangeStart : schedStart;

  let cursor: TZDate = new TZDate(schedStart, timezone);
  while (isBefore(cursor, rangeEnd)) {
    if (isAfter(cursor, effectiveStart) || isEqual(cursor, effectiveStart)) {
      occurrences.push(cursor);
    }
    cursor = addMonths(cursor, safeInterval);
  }

  return occurrences;
}

function expandYearly(
  rule: RecurrenceRule,
  schedule: ServiceSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
): Date[] {
  const safeInterval: number = rule.interval > 0 ? rule.interval : 1;
  const occurrences: Date[] = [];
  const schedStart: TZDate = parseNaiveDatetime(schedule.start_time, timezone);
  const effectiveStart: Date = isAfter(rangeStart, schedStart) ? rangeStart : schedStart;

  let cursor: TZDate = new TZDate(schedStart, timezone);
  while (isBefore(cursor, rangeEnd)) {
    if (isAfter(cursor, effectiveStart) || isEqual(cursor, effectiveStart)) {
      occurrences.push(cursor);
    }
    cursor = addYears(cursor, safeInterval);
  }

  return occurrences;
}

export interface BusinessHoursBlock {
  day: number;
  startTime: string;
  endTime: string;
}

export function generateSlotsFromBusinessHours(
  businessHours: BusinessHoursBlock[],
  date: Date,
  intervalMinutes: number,
  timezone: string,
): Date[] {
  const safeInterval: number = intervalMinutes > 0 ? intervalMinutes : 15;
  const dow: number = getDay(new TZDate(date, timezone));
  const blocks: BusinessHoursBlock[] = businessHours.filter((b) => b.day === dow);
  const slots: Date[] = [];

  const tzDate: TZDate = new TZDate(date, timezone);
  const dayBase: Date = startOfDay(tzDate);

  for (const block of blocks) {
    const [startH, startM] = block.startTime.split(":").map(Number) as [number, number];
    const [endH, endM] = block.endTime.split(":").map(Number) as [number, number];

    let cursor: Date = addMinutes(dayBase, startH * 60 + startM);
    const blockEnd: Date = addMinutes(dayBase, endH * 60 + endM);

    while (isBefore(cursor, blockEnd)) {
      slots.push(cursor);
      cursor = addMinutes(cursor, safeInterval);
    }
  }

  return slots;
}

export function parseDurationMinutes(iso8601Duration: string): number {
  if (!iso8601Duration) return 0;
  if (iso8601Duration.startsWith("PT")) {
    const hourMatch: RegExpMatchArray | null = iso8601Duration.match(/(\d+)H/);
    const minuteMatch: RegExpMatchArray | null = iso8601Duration.match(/(\d+)M/);
    const secondMatch: RegExpMatchArray | null = iso8601Duration.match(/(\d+)S/);
    const hours: number = parseInt(hourMatch?.[1] ?? "0", 10);
    const minutes: number = parseInt(minuteMatch?.[1] ?? "0", 10);
    const seconds: number = parseInt(secondMatch?.[1] ?? "0", 10);
    return hours * 60 + minutes + Math.ceil(seconds / 60);
  }
  const numeric: number = parseInt(iso8601Duration, 10);
  if (!isNaN(numeric) && numeric > 0) return numeric;
  return 0;
}
