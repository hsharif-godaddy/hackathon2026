export interface ScanResult {
  matched: boolean;
  pattern: string | null;
}

const PATTERNS: [string, RegExp][] = [
  ['error_type', /\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError)\b/],
  ['error_keyword', /\b(runtime error|unexpected token|cannot read propert|is not defined|is not a function)\b/i],
  ['import_failure', /\b(broken import|module not found|cannot find module|failed to resolve|cannot resolve)\b/i],
  ['build_crash', /\b(blank page|white screen|crash on load|build failed|compilation error|failed to compile)\b/i],
  ['user_debugging', /\b(fix this error|fix the error|getting an error|shows? an error|still broken|keeps crashing|console error)\b/i],
  ['stack_trace', /\.(js|ts|tsx|jsx):\d+:\d+/],
];

export const PATTERN_NAMES = PATTERNS.map(function name([n]) { return n; });

export function scan(message: string): ScanResult {
  for (const [name, regex] of PATTERNS) {
    if (regex.test(message)) return { matched: true, pattern: name };
  }
  return { matched: false, pattern: null };
}
