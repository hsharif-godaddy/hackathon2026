export type CompleterFn = (line: string) => [string[], string];

/**
 * Returns a readline completer function bound to the given
 * candidates list.
 *
 * Behaviour:
 *  - empty input  → return all candidates
 *  - partial input → return prefix-matching candidates
 *  - no match     → return empty array
 */
export function createCompleter(
  candidates: string[],
): CompleterFn {
  return (line: string): [string[], string] => {
    if (!line) return [candidates, line];
    const hits = candidates.filter((c) => c.startsWith(line));
    return [hits, line];
  };
}
