export function formatCost(cost: string | null, currency = "USD"): string {
  if (!cost) return "Free";
  const n = parseFloat(cost);
  if (isNaN(n) || n === 0) return "Free";
  // cost is stored as a decimal major-unit value (e.g. 650.00 = ₹650) — format directly
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
}

export function formatDuration(duration: string | number | null): string {
  if (!duration) return "";
  if (typeof duration === "number") {
    if (duration < 60) return `${duration} min`;
    const h = Math.floor(duration / 60);
    const m = duration % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const h = duration.match(/(\d+)H/);
  const m = duration.match(/(\d+)M/);
  const hours = h ? parseInt(h[1] ?? "0") : 0;
  const mins = m ? parseInt(m[1] ?? "0") : 0;
  if (!hours && !mins) return "";
  if (!hours) return `${mins} min`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
