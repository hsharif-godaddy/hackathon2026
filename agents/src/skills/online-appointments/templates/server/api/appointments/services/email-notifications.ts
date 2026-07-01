import { sendEmail } from "../../../email";
import { generateICS } from "./ics-generator";
import { db } from "../../../db/client";
import { businessSetting } from "../../../db/schema";
import { eq } from "drizzle-orm";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";

interface BookingInfo {
  id: string;
  start_time: string;
  end_time: string;
  service_id: string;
}

interface ServiceInfo {
  name: string | null;
  duration: string | null;
  locationType: string | null;
  customLocationText: string | null;
}

interface ClientInfo {
  first_name: string;
  last_name: string;
  email: string;
}

async function getTimezone(): Promise<string> {
  const [row] = await db
    .select({ value: businessSetting.value })
    .from(businessSetting)
    .where(eq(businessSetting.key, "timezone"))
    .limit(1);
  return row?.value ?? "UTC";
}

async function getBusinessName(): Promise<string> {
  const [row] = await db
    .select({ value: businessSetting.value })
    .from(businessSetting)
    .where(eq(businessSetting.key, "business_name"))
    .limit(1);
  return row?.value ?? "Our Business";
}

function formatDateTime(isoString: string, timezone: string): string {
  const date = new TZDate(isoString, timezone);
  return format(date, "EEEE, MMMM d, yyyy 'at' h:mm a");
}

function getLocationText(service: ServiceInfo): string {
  if (service.locationType === "custom" && service.customLocationText) {
    return service.customLocationText;
  }
  if (service.locationType === "online") {
    return "Online";
  }
  return "";
}

export async function sendBookingConfirmation(
  booking: BookingInfo,
  service: ServiceInfo,
  clientInfo: ClientInfo,
): Promise<void> {
  try {
    const timezone = await getTimezone();
    const businessName = await getBusinessName();
    const dateStr = formatDateTime(booking.start_time, timezone);
    const location = getLocationText(service);
    const serviceName = service.name ?? "Appointment";

    const icsContent = generateICS({
      uid: `${booking.id}@appointments`,
      summary: `${serviceName} - ${businessName}`,
      start: new Date(booking.start_time),
      end: new Date(booking.end_time),
      location: location || undefined,
      description: `Your ${serviceName} appointment with ${businessName}`,
    });

    const locationLine = location ? `<p><strong>Location:</strong> ${location}</p>` : "";

    await sendEmail({
      to: clientInfo.email,
      subject: `Booking Confirmed: ${serviceName}`,
      html: `
				<h2>Your appointment is confirmed!</h2>
				<p>Hi ${clientInfo.first_name},</p>
				<p>Your booking has been confirmed with the following details:</p>
				<p><strong>Service:</strong> ${serviceName}</p>
				<p><strong>Date & Time:</strong> ${dateStr}</p>
				${locationLine}
				<p><strong>Booking ID:</strong> ${booking.id}</p>
				<br>
				<p>See you then!</p>
				<p>${businessName}</p>
			`.trim(),
      text: `Your appointment is confirmed!\n\nService: ${serviceName}\nDate & Time: ${dateStr}\n${location ? `Location: ${location}\n` : ""}Booking ID: ${booking.id}\n\n${businessName}`,
      attachments: [
        {
          filename: "appointment.ics",
          content: Buffer.from(icsContent, "utf-8"),
          contentType: "text/calendar; charset=utf-8; method=REQUEST",
        },
      ],
    });
  } catch (error) {
    console.error("email.booking_confirmation.failed", {
      bookingId: booking.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendBookingCancellation(
  booking: BookingInfo,
  service: ServiceInfo,
  clientInfo: ClientInfo,
): Promise<void> {
  try {
    const timezone = await getTimezone();
    const businessName = await getBusinessName();
    const dateStr = formatDateTime(booking.start_time, timezone);
    const serviceName = service.name ?? "Appointment";

    await sendEmail({
      to: clientInfo.email,
      subject: `Booking Cancelled: ${serviceName}`,
      html: `
				<h2>Your appointment has been cancelled</h2>
				<p>Hi ${clientInfo.first_name},</p>
				<p>Your booking for <strong>${serviceName}</strong> on <strong>${dateStr}</strong> has been cancelled.</p>
				<p><strong>Booking ID:</strong> ${booking.id}</p>
				<br>
				<p>If you'd like to rebook, please visit our scheduling page.</p>
				<p>${businessName}</p>
			`.trim(),
      text: `Your appointment has been cancelled.\n\nService: ${serviceName}\nOriginal Date: ${dateStr}\nBooking ID: ${booking.id}\n\nIf you'd like to rebook, please visit our scheduling page.\n\n${businessName}`,
    });
  } catch (error) {
    console.error("email.booking_cancellation.failed", {
      bookingId: booking.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendBookingReschedule(
  booking: BookingInfo,
  service: ServiceInfo,
  clientInfo: ClientInfo,
  oldStartTime: string,
): Promise<void> {
  try {
    const timezone = await getTimezone();
    const businessName = await getBusinessName();
    const oldDateStr = formatDateTime(oldStartTime, timezone);
    const newDateStr = formatDateTime(booking.start_time, timezone);
    const location = getLocationText(service);
    const serviceName = service.name ?? "Appointment";

    const icsContent = generateICS({
      uid: `${booking.id}@appointments`,
      summary: `${serviceName} - ${businessName}`,
      start: new Date(booking.start_time),
      end: new Date(booking.end_time),
      location: location || undefined,
      description: `Your rescheduled ${serviceName} appointment with ${businessName}`,
    });

    await sendEmail({
      to: clientInfo.email,
      subject: `Booking Rescheduled: ${serviceName}`,
      html: `
				<h2>Your appointment has been rescheduled</h2>
				<p>Hi ${clientInfo.first_name},</p>
				<p>Your booking for <strong>${serviceName}</strong> has been moved:</p>
				<p><s>Original: ${oldDateStr}</s></p>
				<p><strong>New Date & Time: ${newDateStr}</strong></p>
				<p><strong>Booking ID:</strong> ${booking.id}</p>
				<br>
				<p>An updated calendar invite is attached.</p>
				<p>${businessName}</p>
			`.trim(),
      text: `Your appointment has been rescheduled.\n\nService: ${serviceName}\nOriginal: ${oldDateStr}\nNew Date & Time: ${newDateStr}\nBooking ID: ${booking.id}\n\n${businessName}`,
      attachments: [
        {
          filename: "appointment.ics",
          content: Buffer.from(icsContent, "utf-8"),
          contentType: "text/calendar; charset=utf-8; method=REQUEST",
        },
      ],
    });
  } catch (error) {
    console.error("email.booking_reschedule.failed", {
      bookingId: booking.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendBookingReminder(
  booking: BookingInfo,
  service: ServiceInfo,
  clientInfo: ClientInfo,
): Promise<void> {
  try {
    const timezone = await getTimezone();
    const businessName = await getBusinessName();
    const dateStr = formatDateTime(booking.start_time, timezone);
    const location = getLocationText(service);
    const serviceName = service.name ?? "Appointment";
    const locationLine = location ? `<p><strong>Location:</strong> ${location}</p>` : "";

    await sendEmail({
      to: clientInfo.email,
      subject: `Reminder: ${serviceName} tomorrow`,
      html: `
				<h2>Appointment Reminder</h2>
				<p>Hi ${clientInfo.first_name},</p>
				<p>This is a reminder about your upcoming appointment:</p>
				<p><strong>Service:</strong> ${serviceName}</p>
				<p><strong>Date & Time:</strong> ${dateStr}</p>
				${locationLine}
				<p><strong>Booking ID:</strong> ${booking.id}</p>
				<br>
				<p>See you soon!</p>
				<p>${businessName}</p>
			`.trim(),
      text: `Appointment Reminder\n\nService: ${serviceName}\nDate & Time: ${dateStr}\n${location ? `Location: ${location}\n` : ""}Booking ID: ${booking.id}\n\nSee you soon!\n${businessName}`,
    });
  } catch (error) {
    console.error("email.booking_reminder.failed", {
      bookingId: booking.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
