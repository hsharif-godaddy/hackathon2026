const INFINITY_SENTINEL = '__Infinity__';
const NEG_INFINITY_SENTINEL = '__-Infinity__';

/**
 * JSON.stringify replacer that encodes Infinity/-Infinity as sentinel strings.
 * Without this, JSON.stringify silently converts Infinity to null.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (value === Infinity) return INFINITY_SENTINEL;
  if (value === -Infinity) return NEG_INFINITY_SENTINEL;
  return value;
}

/**
 * JSON.parse reviver that decodes sentinel strings back to Infinity/-Infinity.
 */
export function jsonReviver(_key: string, value: unknown): unknown {
  if (value === INFINITY_SENTINEL) return Infinity;
  if (value === NEG_INFINITY_SENTINEL) return -Infinity;
  return value;
}
