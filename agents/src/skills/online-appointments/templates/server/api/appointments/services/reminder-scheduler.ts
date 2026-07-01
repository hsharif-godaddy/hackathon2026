import { db } from "../../../db/client";
import { reminder, booking, contactDetail, service as serviceTable } from "../../../db/schema";
import { eq, and, lte, isNull, inArray, lt } from "drizzle-orm";
import { sendBookingReminder } from "./email-notifications";

const POLL_INTERVAL_MS = 60_000; // Check every 60 seconds
const BATCH_SIZE = 20;
const CLEANUP_INTERVAL_MS = 3_600_000; // Run cleanup every hour
const STALE_DAYS = 30; // Delete terminal reminders older than 30 days

let timer: ReturnType<typeof setInterval> | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startReminderScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void processReminders(), POLL_INTERVAL_MS);
  timer.unref(); // Don't prevent graceful shutdown

  cleanupTimer = setInterval(() => void cleanupStaleReminders(), CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  console.warn("reminder.scheduler.started", { intervalMs: POLL_INTERVAL_MS });
}

export function stopReminderScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

async function processReminders(): Promise<void> {
  try {
    const now = new Date();

    const pendingReminders = await db
      .select()
      .from(reminder)
      .where(
        and(
          eq(reminder.status, "pending"),
          eq(reminder.deliveryMethod, "email"),
          lte(reminder.performAt, now),
        ),
      )
      .limit(BATCH_SIZE);

    if (pendingReminders.length === 0) return;

    for (const rem of pendingReminders) {
      try {
        const [bk] = await db
          .select()
          .from(booking)
          .where(and(eq(booking.id, rem.bookingId), isNull(booking.deletedAt)))
          .limit(1);

        if (!bk || bk.status === "cancelled") {
          // Booking was cancelled — mark reminder as cancelled
          await db
            .update(reminder)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(reminder.id, rem.id));
          continue;
        }

        // Get client email
        const [contact] = await db
          .select({ email: contactDetail.email })
          .from(contactDetail)
          .where(
            and(
              eq(contactDetail.contactableId, bk.bookerId ?? ""),
              eq(contactDetail.contactableType, "Client"),
              isNull(contactDetail.deletedAt),
            ),
          )
          .limit(1);

        if (!contact?.email) {
          await db
            .update(reminder)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(reminder.id, rem.id));
          continue;
        }

        // Get service info
        const [svc] = await db
          .select({
            name: serviceTable.name,
            duration: serviceTable.duration,
            locationType: serviceTable.locationType,
            customLocationText: serviceTable.customLocationText,
          })
          .from(serviceTable)
          .where(eq(serviceTable.id, bk.bookableId ?? ""))
          .limit(1);

        if (!svc) {
          await db
            .update(reminder)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(reminder.id, rem.id));
          continue;
        }

        await sendBookingReminder(
          {
            id: bk.id,
            start_time: bk.startTime?.toISOString() ?? "",
            end_time: bk.endTime?.toISOString() ?? "",
            service_id: bk.bookableId ?? "",
          },
          svc,
          { first_name: "Customer", last_name: "", email: contact.email },
        );

        await db
          .update(reminder)
          .set({ status: "sent", updatedAt: new Date() })
          .where(eq(reminder.id, rem.id));
      } catch (err) {
        console.error("reminder.process.single_failed", {
          reminderId: rem.id,
          error: err instanceof Error ? err.message : String(err),
        });
        await db
          .update(reminder)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(reminder.id, rem.id));
      }
    }
  } catch (err) {
    console.error("reminder.scheduler.poll_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function cleanupStaleReminders(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

    // 1. Delete terminal reminders older than 30 days
    const deleted = await db
      .delete(reminder)
      .where(
        and(
          inArray(reminder.status, ["sent", "failed", "cancelled"]),
          lt(reminder.updatedAt, cutoff),
        ),
      );
    const deletedCount = (deleted as unknown as { affectedRows?: number }).affectedRows ?? 0;

    // 2. Cancel orphaned pending reminders whose booking already ended
    const now = new Date();
    const orphaned = await db
      .select({ id: reminder.id })
      .from(reminder)
      .innerJoin(booking, eq(booking.id, reminder.bookingId))
      .where(and(eq(reminder.status, "pending"), lte(booking.endTime, now)))
      .limit(BATCH_SIZE);

    for (const row of orphaned) {
      await db
        .update(reminder)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(reminder.id, row.id));
    }
    const cancelledCount = orphaned.length;

    if (deletedCount > 0 || cancelledCount > 0) {
      console.warn("reminder.cleanup.completed", { deletedCount, cancelledCount });
    }
  } catch (err) {
    console.error("reminder.cleanup.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
