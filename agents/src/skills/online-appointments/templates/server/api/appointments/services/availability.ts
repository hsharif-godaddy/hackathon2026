import { addMinutes, addDays, isBefore, isAfter, isEqual } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { and, eq, gte, lte, isNull, ne } from "drizzle-orm";
import { db } from "../../../db/client.js";
import {
  service as serviceTable,
  bookedInstance,
  exceptionTime,
  businessSetting,
  staff,
  serviceStaff,
  staffSetting,
} from "../../../db/schema.js";
import {
  parseSchedule,
  expandOccurrences,
  generateSlotsFromBusinessHours,
  parseDurationMinutes,
  type BusinessHoursBlock,
} from "./recurrence";
import { isFeatureEnabled } from "../../../../lib/features";

const DEFAULT_BUSINESS_HOURS: BusinessHoursBlock[] = [
  { day: 1, startTime: "09:00", endTime: "17:00" },
  { day: 2, startTime: "09:00", endTime: "17:00" },
  { day: 3, startTime: "09:00", endTime: "17:00" },
  { day: 4, startTime: "09:00", endTime: "17:00" },
  { day: 5, startTime: "09:00", endTime: "17:00" },
];

export interface TimeSlot {
  start_time: string;
  end_time: string;
  available: boolean;
  remaining_capacity: number;
}

export interface AvailableDateResult {
  date: string;
  available: boolean;
}

interface ServiceData {
  id: string;
  duration: string | null;
  bufferTime: string;
  bookLeadTime: string;
  capacity: number | null;
  schedule: string | null;
  recurrenceType: string | null;
  startTime: Date | null;
  endTime: Date | null;
  recurrenceLimit: number | null;
}

export async function getTimezone(): Promise<string> {
  const [setting] = await db
    .select({ value: businessSetting.value })
    .from(businessSetting)
    .where(eq(businessSetting.key, "timezone"))
    .limit(1);
  return setting?.value ?? "UTC";
}

export async function getAvailableTimeInterval(): Promise<number> {
  const [setting] = await db
    .select({ value: businessSetting.value })
    .from(businessSetting)
    .where(eq(businessSetting.key, "available_time_interval"))
    .limit(1);
  if (setting?.value) {
    const parsed: number = parseDurationMinutes(setting.value);
    return parsed > 0 ? parsed : 15;
  }
  return 15;
}

async function getStaffBusinessHours(staffId: string): Promise<BusinessHoursBlock[]> {
  const [setting] = await db
    .select({ value: staffSetting.value })
    .from(staffSetting)
    .where(
      and(
        eq(staffSetting.staffId, staffId),
        eq(staffSetting.key, "availability"),
        isNull(staffSetting.deletedAt),
      ),
    )
    .limit(1);

  if (!setting?.value) return DEFAULT_BUSINESS_HOURS;

  try {
    const availability = JSON.parse(setting.value) as Record<
      string,
      { active?: boolean; timeBlocks?: Array<{ startTime: string; endTime: string }> }
    >;
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const blocks: BusinessHoursBlock[] = [];

    for (let day = 0; day < 7; day++) {
      const dayName = dayNames[day];
      if (!dayName) continue;
      const dayData = availability[dayName];
      if (!dayData?.active || !dayData.timeBlocks) continue;
      for (const block of dayData.timeBlocks) {
        blocks.push({ day, startTime: block.startTime, endTime: block.endTime });
      }
    }
    return blocks.length > 0 ? blocks : DEFAULT_BUSINESS_HOURS;
  } catch {
    return DEFAULT_BUSINESS_HOURS;
  }
}

async function getBusinessLevelHours(): Promise<BusinessHoursBlock[]> {
  const [setting] = await db
    .select({ value: businessSetting.value })
    .from(businessSetting)
    .where(eq(businessSetting.key, "business_hours"))
    .limit(1);

  if (setting?.value) {
    try {
      const availability = JSON.parse(setting.value) as Record<
        string,
        { active?: boolean; timeBlocks?: Array<{ startTime: string; endTime: string }> }
      >;
      const dayNames = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ] as const;
      const blocks: BusinessHoursBlock[] = [];
      for (let day = 0; day < 7; day++) {
        const dayName = dayNames[day];
        if (!dayName) continue;
        const dayData = availability[dayName];
        if (!dayData?.active || !dayData.timeBlocks) continue;
        for (const block of dayData.timeBlocks) {
          blocks.push({ day, startTime: block.startTime, endTime: block.endTime });
        }
      }
      return blocks;
    } catch {
      // fall through to default
    }
  }

  const blocks: BusinessHoursBlock[] = [];
  for (let day = 1; day <= 5; day++) {
    blocks.push({ day, startTime: "09:00", endTime: "17:00" });
  }
  return blocks;
}

async function getServiceStaffIds(serviceId: string): Promise<string[]> {
  // Check if service has a staffRole assigned
  const [svc] = await db
    .select({ staffRole: serviceTable.staffRole })
    .from(serviceTable)
    .where(eq(serviceTable.id, serviceId))
    .limit(1);

  if (svc?.staffRole) {
    const byRole = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.role, svc.staffRole), isNull(staff.deletedAt)));
    if (byRole.length > 0) return byRole.map((r) => r.id);
  }

  // Fall back to service_staff junction table
  const rows = await db
    .select({ staffId: serviceStaff.staffId })
    .from(serviceStaff)
    .innerJoin(staff, eq(serviceStaff.staffId, staff.id))
    .where(and(eq(serviceStaff.serviceId, serviceId), isNull(staff.deletedAt)));

  if (rows.length > 0) {
    return rows.map((row: { staffId: string }) => row.staffId);
  }

  // Last resort: all active staff
  const allStaff = await db.select({ id: staff.id }).from(staff).where(isNull(staff.deletedAt));
  return allStaff.map((row: { id: string }) => row.id);
}

async function getBookedInstancesInRange(
  serviceId: string,
  _resourceIds: string[],
  rangeStart: Date,
  rangeEnd: Date,
  ignoredBookingId?: string,
): Promise<
  Array<{ startTime: Date; endTime: Date; maxCapacity: number; remainingCapacity: number }>
> {
  const conditions = [
    eq(bookedInstance.serviceId, serviceId),
    gte(bookedInstance.startTime, rangeStart),
    lte(bookedInstance.startTime, rangeEnd),
  ];
  if (ignoredBookingId) {
    conditions.push(ne(bookedInstance.id, ignoredBookingId));
  }

  const results = await db
    .select({
      startTime: bookedInstance.startTime,
      endTime: bookedInstance.endTime,
      maxCapacity: bookedInstance.maxCapacity,
      remainingCapacity: bookedInstance.remainingCapacity,
    })
    .from(bookedInstance)
    .where(and(...conditions));

  return results.filter(
    (r: {
      startTime: Date | null;
      endTime: Date | null;
      maxCapacity: number;
      remainingCapacity: number;
    }): r is { startTime: Date; endTime: Date; maxCapacity: number; remainingCapacity: number } =>
      r.startTime !== null && r.endTime !== null,
  );
}

async function getExceptionTimesInRange(
  rangeStart: Date,
  rangeEnd: Date,
): Promise<Array<{ startTime: Date; endTime: Date }>> {
  const results = await db
    .select({
      startTime: exceptionTime.startTime,
      endTime: exceptionTime.endTime,
    })
    .from(exceptionTime)
    .where(and(lte(exceptionTime.startTime, rangeEnd), gte(exceptionTime.endTime, rangeStart)));

  return results.filter(
    (r: {
      startTime: Date | null;
      endTime: Date | null;
    }): r is { startTime: Date; endTime: Date } => r.startTime !== null && r.endTime !== null,
  );
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return isBefore(aStart, bEnd) && isAfter(aEnd, bStart);
}

export async function getAvailableTimeSlotsForDate(
  serviceId: string,
  date: string,
  quantity: number = 1,
  options?: { staffIds?: string[]; ignoredBookingId?: string; viewedBy?: "client" | "merchant" },
): Promise<TimeSlot[]> {
  const [svc] = await db
    .select({
      id: serviceTable.id,
      duration: serviceTable.duration,
      bufferTime: serviceTable.bufferTime,
      bookLeadTime: serviceTable.bookLeadTime,
      capacity: serviceTable.capacity,
      schedule: serviceTable.schedule,
      recurrenceType: serviceTable.recurrenceType,
      startTime: serviceTable.startTime,
      endTime: serviceTable.endTime,
      recurrenceLimit: serviceTable.recurrenceLimit,
    })
    .from(serviceTable)
    .where(and(eq(serviceTable.id, serviceId), isNull(serviceTable.deletedAt)))
    .limit(1);

  if (!svc) return [];

  const timezone = await getTimezone();
  const durationMinutes = parseDurationMinutes(svc.duration ?? "PT60M");
  const bufferMinutes = parseDurationMinutes(svc.bufferTime);
  const leadMinutes = parseDurationMinutes(svc.bookLeadTime);
  const capacity = svc.capacity ?? 1;

  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const dayStart = new TZDate(y, mo - 1, d, 0, 0, 0, timezone);
  const dayEnd = new TZDate(y, mo - 1, d + 1, 0, 0, 0, timezone);

  const staffIds = options?.staffIds?.length
    ? options.staffIds
    : isFeatureEnabled("admin.staff")
      ? await getServiceStaffIds(serviceId)
      : [];

  const candidateSlots = await generateCandidateSlots(svc, dayStart, dayEnd, timezone, staffIds);

  const bookedInstances = await getBookedInstancesInRange(
    serviceId,
    staffIds,
    dayStart,
    dayEnd,
    options?.ignoredBookingId,
  );

  const exceptions = await getExceptionTimesInRange(dayStart, dayEnd);

  const now = new Date();
  const leadTimeCutoff = options?.viewedBy === "merchant" ? now : addMinutes(now, leadMinutes);

  const slots: TimeSlot[] = [];

  for (const slotStart of candidateSlots) {
    const slotEnd = addMinutes(slotStart, durationMinutes);
    const slotEndWithBuffer = addMinutes(slotStart, durationMinutes + bufferMinutes);

    if (isBefore(slotStart, leadTimeCutoff)) {
      slots.push({
        start_time: slotStart.toISOString(),
        end_time: slotEnd.toISOString(),
        available: false,
        remaining_capacity: 0,
      });
      continue;
    }

    const isBlocked = exceptions.some((ex) =>
      rangesOverlap(slotStart, slotEndWithBuffer, ex.startTime, ex.endTime),
    );

    if (isBlocked) {
      slots.push({
        start_time: slotStart.toISOString(),
        end_time: slotEnd.toISOString(),
        available: false,
        remaining_capacity: 0,
      });
      continue;
    }

    let usedCapacity = 0;
    for (const bi of bookedInstances) {
      if (rangesOverlap(slotStart, slotEndWithBuffer, bi.startTime, bi.endTime)) {
        if (isEqual(slotStart, bi.startTime)) {
          usedCapacity += bi.maxCapacity - bi.remainingCapacity;
        } else {
          usedCapacity = capacity;
          break;
        }
      }
    }

    const remainingCapacity = Math.max(0, capacity - usedCapacity);
    const isAvailable = remainingCapacity >= quantity;

    slots.push({
      start_time: slotStart.toISOString(),
      end_time: slotEnd.toISOString(),
      available: isAvailable,
      remaining_capacity: remainingCapacity,
    });
  }

  return slots;
}

async function generateCandidateSlots(
  svc: ServiceData,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string,
  staffIds: string[],
): Promise<Date[]> {
  if (svc.recurrenceType === "business_hours") {
    const durationMinutes = parseDurationMinutes(svc.duration ?? "PT60M");
    const bufferMinutes = parseDurationMinutes(svc.bufferTime);
    const interval = durationMinutes + bufferMinutes;

    // Business hours is always the base
    const businessHours = await getBusinessLevelHours();
    const businessSlots = generateSlotsFromBusinessHours(
      businessHours,
      rangeStart,
      interval,
      timezone,
    );

    // If staff feature is ON and staff exist, intersect with staff availability
    if (isFeatureEnabled("admin.staff") && staffIds.length > 0) {
      const staffSlotSet: Set<number> = new Set();
      for (const staffId of staffIds) {
        const staffHours = await getStaffBusinessHours(staffId);
        if (staffHours.length > 0) {
          const slots = generateSlotsFromBusinessHours(staffHours, rangeStart, interval, timezone);
          for (const s of slots) {
            staffSlotSet.add(s.getTime());
          }
        }
      }
      // If staff have availability settings, intersect; otherwise just use business hours
      if (staffSlotSet.size > 0) {
        return businessSlots
          .filter((s) => staffSlotSet.has(s.getTime()))
          .sort((a, b) => a.getTime() - b.getTime());
      }
    }

    return businessSlots.sort((a, b) => a.getTime() - b.getTime());
  }

  const schedule = parseSchedule(svc.schedule);
  if (!schedule) {
    if (svc.startTime && isBefore(svc.startTime, rangeEnd) && isAfter(svc.startTime, rangeStart)) {
      return [svc.startTime];
    }
    return [];
  }

  return expandOccurrences(
    schedule,
    rangeStart,
    rangeEnd,
    timezone,
    svc.recurrenceLimit ?? undefined,
  );
}

export async function getAvailableDatesInRange(
  serviceId: string,
  startDate: string,
  endDate: string,
  quantity: number = 1,
  options?: { staffIds?: string[]; viewedBy?: "client" | "merchant" },
): Promise<AvailableDateResult[]> {
  const timezone = await getTimezone();
  const [sy, sm, sd] = startDate.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = endDate.split("-").map(Number) as [number, number, number];
  const rangeStart = new TZDate(sy, sm - 1, sd, 0, 0, 0, timezone);
  const rangeEnd = new TZDate(ey, em - 1, ed, 23, 59, 59, timezone);

  const maxDays = 32;
  const dates: string[] = [];
  let currentDay = rangeStart;

  while (isBefore(currentDay, rangeEnd) && dates.length < maxDays) {
    dates.push(
      `${currentDay.getFullYear()}-${String(currentDay.getMonth() + 1).padStart(2, "0")}-${String(currentDay.getDate()).padStart(2, "0")}`,
    );
    currentDay = addDays(currentDay, 1);
  }

  const results: AvailableDateResult[] = await Promise.all(
    dates.map(async (dateStr: string): Promise<AvailableDateResult> => {
      const slots = await getAvailableTimeSlotsForDate(serviceId, dateStr, quantity, {
        staffIds: options?.staffIds,
        viewedBy: options?.viewedBy,
      });
      return { date: dateStr, available: slots.some((s) => s.available) };
    }),
  );

  return results;
}
