import { z } from 'zod'

/**
 * Minimal JSON-Schema → TypeScript-type renderer used to give the model a typed
 * surface for the code-mode API. We go through zod v4's official `z.toJSONSchema`
 * (rather than poking zod internals) and walk the resulting JSON Schema.
 *
 * This only needs to cover the constructs the three subset schemas use
 * (object/array/string/number/boolean/enum/optional). Anything unrecognized
 * degrades to `unknown` so generation never throws.
 */

interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  description?: string
  additionalProperties?: boolean | JsonSchema
}

function render(schema: JsonSchema | undefined, indent: number): string {
  if (!schema || typeof schema !== 'object') return 'unknown'

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map(v => JSON.stringify(v)).join(' | ')
  }

  const variants = schema.anyOf ?? schema.oneOf
  if (variants && variants.length > 0) {
    return variants.map(v => render(v, indent)).join(' | ')
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  switch (type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return `Array<${render(schema.items, indent)}>`
    case 'object': {
      const props = schema.properties ?? {}
      const keys = Object.keys(props)
      if (keys.length === 0) {
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          return `Record<string, ${render(schema.additionalProperties, indent)}>`
        }
        return 'Record<string, unknown>'
      }
      const required = new Set(schema.required ?? [])
      const pad = '  '.repeat(indent + 1)
      const closePad = '  '.repeat(indent)
      const lines = keys.map(key => {
        const child = props[key]!
        const optional = required.has(key) ? '' : '?'
        const doc = child.description ? `${pad}/** ${child.description} */\n` : ''
        const safeKey = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
        return `${doc}${pad}${safeKey}${optional}: ${render(child, indent + 1)}`
      })
      return `{\n${lines.join('\n')}\n${closePad}}`
    }
    default:
      return 'unknown'
  }
}

function inputType(schema: z.ZodType): string {
  try {
    return render(z.toJSONSchema(schema) as JsonSchema, 1)
  } catch {
    return 'Record<string, unknown>'
  }
}

/**
 * Generate a `declare const turnscript: { ... }` block from the subset tool schemas.
 * Returned tool results are plain text, so every method resolves to `string`.
 */
export function generateTurnscriptTypes(tools: Record<string, z.ZodType>): string {
  const methods = Object.entries(tools).map(([name, schema]) =>
    `  ${name}(input: ${inputType(schema)}): Promise<string>;`,
  )
  return `declare const turnscript: {\n${methods.join('\n')}\n};`
}
