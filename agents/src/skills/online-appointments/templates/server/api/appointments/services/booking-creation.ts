import { eq, and, isNull, inArray } from "drizzle-orm";
import { db } from "../../../db/client.js";
import {
  booking,
  bookedInstance,
  client,
  contactDetail,
  serviceSnapshot,
  answeredQuestion,
  service as serviceTable,
  serviceStaff,
  staff as staffTable,
  reminder,
  businessSetting,
  bookingAddon,
  addon,
  serviceAddon,
} from "../../../db/schema";
import { generateId, generateConfirmationCode } from "../../../db/uuid";
import { getAvailableTimeSlotsForDate } from "./availability";
import { parseDurationMinutes } from "./recurrence";
import { sendBookingConfirmation } from "./email-notifications";

interface ClientInput {
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string;
  notes?: string;
}

interface AnswerInput {
  question_id: string;
  body: string;
}

interface CreateBookingInput {
  service_id: string;
  availability_time: string;
  quantity: number;
  staff_ids?: string[];
  addon_ids?: string[];
  client: ClientInput;
  answers?: AnswerInput[];
  marketing_consent?: boolean;
  coupon_code?: string;
  // discount_amount removed - discount is calculated server-side at checkout
}

interface BookingResult {
  id: string;
  confirmation_code: string;
  status: string;
  start_time: string;
  end_time: string;
  quantity: number;
  service_id: string;
}

export async function createBooking(input: CreateBookingInput): Promise<BookingResult> {
  const [svc] = await db
    .select()
    .from(serviceTable)
    .where(
      and(
        eq(serviceTable.id, input.service_id),
        isNull(serviceTable.deletedAt),
        eq(serviceTable.visible, true),
      ),
    )
    .limit(1);

  if (!svc) {
    throw new BookingError("Service not found", 404);
  }

  const startTime = new Date(input.availability_time);
  if (isNaN(startTime.getTime())) {
    throw new BookingError("Invalid availability_time", 400);
  }

  const dateStr = startTime.toISOString().slice(0, 10);
  const slots = await getAvailableTimeSlotsForDate(input.service_id, dateStr, input.quantity, {
    staffIds: input.staff_ids,
    viewedBy: "client",
  });

  const startMs = startTime.getTime();
  const matchingSlot = slots.find(
    (s) => new Date(s.start_time).getTime() === startMs && s.available,
  );

  if (!matchingSlot) {
    throw new BookingError("Selected time is unavailable", 422);
  }

  const durationMinutes = parseDurationMinutes(svc.duration ?? "PT60M");
  const bufferMinutes = parseDurationMinutes(svc.bufferTime);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
  const endTimeWithBuffer = new Date(
    startTime.getTime() + (durationMinutes + bufferMinutes) * 60000,
  );

  let resolvedStaffId: string | null = input.staff_ids?.[0] ?? null;

  if (!resolvedStaffId) {
    const [sr] = await db
      .select({ staffId: serviceStaff.staffId })
      .from(serviceStaff)
      .where(eq(serviceStaff.serviceId, svc.id))
      .limit(1);
    resolvedStaffId = sr?.staffId ?? null;
  }
  if (!resolvedStaffId && svc.staffRole) {
    const [s] = await db
      .select({ id: staffTable.id })
      .from(staffTable)
      .where(and(eq(staffTable.role, svc.staffRole), isNull(staffTable.deletedAt)))
      .limit(1);
    resolvedStaffId = s?.id ?? null;
  }
  if (!resolvedStaffId) {
    const [s] = await db
      .select({ id: staffTable.id })
      .from(staffTable)
      .where(isNull(staffTable.deletedAt))
      .limit(1);
    resolvedStaffId = s?.id ?? null;
  }

  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const clientRecord = await findOrCreateClient(tx, input.client);

    const snapshotId = generateId();
    await tx.insert(serviceSnapshot).values({
      id: snapshotId,
      serviceId: svc.id,
      name: svc.name,
      slug: svc.slug,
      description: svc.description,
      locationType: svc.locationType,
      customLocationText: svc.customLocationText,
      locationUrl: svc.locationUrl,
      locationUrlNotes: svc.locationUrlNotes,
      teleconferenceProvider: svc.teleconferenceProvider,
      costType: svc.costType,
      cost: svc.cost,
      salesPrice: svc.salesPrice,
      paymentOption: svc.paymentOption,
      depositAmount: svc.depositAmount,
      customCostText: svc.customCostText,
      startTime: svc.startTime,
      endTime: svc.endTime,
      duration: svc.duration,
      bufferTime: svc.bufferTime,
      bookLeadTime: svc.bookLeadTime,
      cancelLeadTime: svc.cancelLeadTime,
      schedule: svc.schedule,
      recurrenceType: svc.recurrenceType,
      capacity: svc.capacity,
      imageUrl: svc.imageUrl,
      c2CanReschedule: svc.c2CanReschedule,
      visible: svc.visible,
      createdAt: now,
      updatedAt: now,
    });

    const staffCondition = resolvedStaffId
      ? eq(bookedInstance.staffId, resolvedStaffId)
      : isNull(bookedInstance.staffId);

    const existingInstance = await tx
      .select({ id: bookedInstance.id, remainingCapacity: bookedInstance.remainingCapacity })
      .from(bookedInstance)
      .where(
        and(
          eq(bookedInstance.serviceId, svc.id),
          staffCondition,
          eq(bookedInstance.startTime, startTime),
        ),
      )
      .limit(1);

    let instanceId: string;
    const inst = existingInstance[0];
    if (inst) {
      instanceId = inst.id;
      await tx
        .update(bookedInstance)
        .set({
          remainingCapacity: inst.remainingCapacity - input.quantity,
          updatedAt: now,
        })
        .where(eq(bookedInstance.id, instanceId));
    } else {
      instanceId = generateId();
      await tx.insert(bookedInstance).values({
        id: instanceId,
        serviceId: svc.id,
        staffId: resolvedStaffId,
        startTime,
        endTime: endTimeWithBuffer,
        endTimeDisplay: endTime,
        maxCapacity: svc.capacity ?? 1,
        remainingCapacity: (svc.capacity ?? 1) - input.quantity,
        createdAt: now,
        updatedAt: now,
      });
    }

    const bookingId = generateId();
    const confirmationCode = generateConfirmationCode();
    await tx.insert(booking).values({
      id: bookingId,
      bookableId: svc.id,
      bookableType: "Service",
      bookerId: clientRecord.id,
      bookerType: "Client",
      bookedBy: "client",
      serviceSnapshotId: snapshotId,
      bookedInstanceId: instanceId,
      quantity: input.quantity,
      startTime,
      endTime,
      endTimeDisplay: endTime,
      status: "unpaid",
      couponCode: input.coupon_code ?? null,
      discountAmount: "0.00", // Discount will be calculated and stored at checkout time
      confirmationCode,
      createdAt: now,
      updatedAt: now,
    });

    if (input.answers && input.answers.length > 0) {
      await tx.insert(answeredQuestion).values(
        input.answers.map((a) => ({
          id: generateId(),
          bookingId,
          questionId: a.question_id,
          body: a.body,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    // Insert selected addons
    if (input.addon_ids && input.addon_ids.length > 0) {
      // Deduplicate addon IDs to prevent charging the same addon multiple times
      const uniqueAddonIds: string[] = [...new Set(input.addon_ids)];

      // SECURITY: Validate that addons are linked to this service via serviceAddon junction table
      // and that they are active and not deleted. This prevents clients from attaching
      // arbitrary addons from other services.
      const selectedAddons = await tx
        .select({
          id: addon.id,
          title: addon.title,
          price: addon.price,
          duration: addon.duration,
        })
        .from(addon)
        .innerJoin(serviceAddon, eq(serviceAddon.addonId, addon.id))
        .where(
          and(
            inArray(addon.id, uniqueAddonIds),
            eq(serviceAddon.serviceId, svc.id),
            eq(addon.active, true),
            isNull(addon.deletedAt),
          ),
        );

      const addonMap = new Map(selectedAddons.map((a) => [a.id, a]));
      const addonsToInsert = uniqueAddonIds
        .map((addonId) => {
          const addonData = addonMap.get(addonId);
          if (!addonData) return null;
          return {
            id: generateId(),
            bookingId,
            addonId,
            title: addonData.title,
            price: addonData.price,
            duration: addonData.duration,
            createdAt: now,
            updatedAt: now,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);

      if (addonsToInsert.length > 0) {
        await tx.insert(bookingAddon).values(addonsToInsert);
      }
    }

    // Insert reminder for email notification
    const reminderHours = await getReminderHoursSetting();
    if (reminderHours > 0) {
      const performAt = new Date(startTime.getTime() - reminderHours * 3600000);
      if (performAt > now) {
        await tx.insert(reminder).values({
          id: generateId(),
          bookingId,
          deliveryMethod: "email",
          status: "pending",
          performAt,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return {
      id: bookingId,
      confirmation_code: confirmationCode,
      status: "unpaid",
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      quantity: input.quantity,
      service_id: svc.id,
    };
  });

  // Fire-and-forget confirmation email
  sendBookingConfirmation(
    result,
    {
      name: svc.name,
      duration: svc.duration,
      locationType: svc.locationType,
      customLocationText: svc.customLocationText,
    },
    input.client,
  ).catch((err) =>
    console.error("email.booking_confirmation.failed", {
      bookingId: result.id,
      error: err instanceof Error ? err.message : String(err),
    }),
  );

  return result;
}

async function findOrCreateClient(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: ClientInput,
): Promise<{ id: string }> {
  const existingContacts = await tx
    .select({ contactableId: contactDetail.contactableId })
    .from(contactDetail)
    .where(
      and(
        eq(contactDetail.email, input.email),
        eq(contactDetail.contactableType, "Client"),
        isNull(contactDetail.deletedAt),
      ),
    )
    .limit(1);

  const existingContact = existingContacts[0];
  if (existingContact?.contactableId) {
    return { id: existingContact.contactableId };
  }

  const now = new Date();
  const clientId = generateId();
  await tx.insert(client).values({
    id: clientId,
    firstName: input.first_name,
    lastName: input.last_name,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await tx.insert(contactDetail).values({
    id: generateId(),
    contactableId: clientId,
    contactableType: "Client",
    email: input.email,
    phoneNumber: input.phone_number ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return { id: clientId };
}

export class BookingError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function getReminderHoursSetting(): Promise<number> {
  const [row] = await db
    .select({ value: businessSetting.value })
    .from(businessSetting)
    .where(eq(businessSetting.key, "reminder_hours_before"))
    .limit(1);
  const hours = parseInt(row?.value ?? "0", 10);
  return isNaN(hours) ? 0 : hours;
}
