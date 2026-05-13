/**
 * Parse a Go-style duration string into seconds. Returns 0 when the input is
 * empty or does not wholly match a recognised duration syntax — callers use
 * this for observability fields where a zero is preferable to a crash.
 *
 * Accepts (must match fully, trailing noise is rejected):
 *   - plain numbers (interpreted as seconds)
 *   - simple units: "300s", "5m", "1h"
 *   - compound: "5m0s", "1h30m45s", "90m"
 *   - fractional: "1.5s"
 *   - sub-second units: "250ms", "100us", "5ns"
 */
// Non-global: no backtracking over a quantified group (avoids ReDoS on the
// shape check). Walk the string linearly with this pattern and verify that
// the matches cover the entire input before trusting the sum.
const DURATION_COMPONENT = /^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/;

export function parseDurationToSeconds(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  let rest = trimmed;
  let total = 0;
  let matched = false;
  while (rest.length > 0) {
    const m = DURATION_COMPONENT.exec(rest);
    if (!m) break;
    matched = true;
    const n = Number(m[1]);
    switch (m[2]) {
      case 'ns':
        total += n / 1e9;
        break;
      case 'us':
      case 'µs':
        total += n / 1e6;
        break;
      case 'ms':
        total += n / 1000;
        break;
      case 's':
        total += n;
        break;
      case 'm':
        total += n * 60;
        break;
      case 'h':
        total += n * 3600;
        break;
    }
    rest = rest.slice(m[0].length);
  }
  if (matched && rest.length === 0) return total;
  const plain = Number(trimmed);
  return Number.isFinite(plain) ? plain : 0;
}
