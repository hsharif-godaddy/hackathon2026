const UNSAFE_UNICODE_RE = /[\u{E0000}-\u{E007F}\u{F0000}-\u{FFFFF}\u{100000}-\u{10FFFF}\uE000-\uF8FF\uFFF0-\uFFFF]+/gu;

export function sanitize(text: string): string {
  const cleaned = text.replace(UNSAFE_UNICODE_RE, '');
  let result = '';
  for (const ch of cleaned) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xD800 && code <= 0xDFFF) continue;
    result += ch;
  }
  return result;
}
