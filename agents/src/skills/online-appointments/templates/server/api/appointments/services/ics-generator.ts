/**
 * RFC 5545 .ics calendar invite generator.
 * Produces a VCALENDAR with a single VEVENT for appointment confirmations.
 */

interface ICSOptions {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
  location?: string;
  description?: string;
  organizerEmail?: string;
}

function formatDateUTC(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function generateICS(opts: ICSOptions): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Airo//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${formatDateUTC(new Date())}`,
    `DTSTART:${formatDateUTC(opts.start)}`,
    `DTEND:${formatDateUTC(opts.end)}`,
    `SUMMARY:${escapeText(opts.summary)}`,
  ];

  if (opts.description) {
    lines.push(`DESCRIPTION:${escapeText(opts.description)}`);
  }
  if (opts.location) {
    lines.push(`LOCATION:${escapeText(opts.location)}`);
  }
  if (opts.organizerEmail) {
    lines.push(`ORGANIZER:mailto:${opts.organizerEmail}`);
  }

  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n") + "\r\n";
}
