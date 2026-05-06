/** formatUtcTs output and ISO strings → UTC Date for Parquet TIMESTAMP_MILLIS. */
export function parseFeedbackUtcStringToDate(s: string): Date {
  const t = s.trim();
  if (!t) {
    throw new Error('empty timestamp string');
  }
  if (t.includes('T')) {
    const iso = t.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t}Z`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`invalid timestamp: ${s}`);
    }
    return d;
  }
  const d = new Date(`${t.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid timestamp: ${s}`);
  }
  return d;
}
