export function formatSlotTime(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

export function getHourInTimezone(iso: string, timezone?: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: timezone,
  }).formatToParts(new Date(iso));
  return parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
}

export function formatFullDate(date: Date): string {
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
