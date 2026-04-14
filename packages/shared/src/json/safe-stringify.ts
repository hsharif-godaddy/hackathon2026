/**
 * JSON.stringify wrapper that handles circular references instead of throwing
 * "Maximum call stack size exceeded". Circular references are replaced with
 * the string "[Circular]". Shared (non-circular) references serialize normally.
 */
export function safeStringify(value: unknown, space?: string | number): string {
  const ancestors: object[] = []
  return JSON.stringify(
    value,
    function (this: unknown, _key: string, val: unknown) {
      if (val !== null && typeof val === 'object') {
        // Pop ancestors that are no longer in the current traversal path.
        // `this` is the parent object holding the current key.
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
          ancestors.pop()
        }
        if (ancestors.includes(val as object)) return '[Circular]'
        ancestors.push(val as object)
      }
      return val
    },
    space,
  )
}
