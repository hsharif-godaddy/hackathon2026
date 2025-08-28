/**
 * Serializes tool arguments to a string format for consistent display in components.
 * Handles both string and object types, converting objects to formatted JSON.
 * 
 * @param toolArgs - Tool arguments that can be string, object, or undefined
 * @returns Serialized string or undefined if input is undefined
 */
export function serializeToolArgs(toolArgs: string | object | undefined): string | undefined {
  if (toolArgs === undefined || toolArgs === null) {
    return undefined
  }
  
  if (typeof toolArgs === 'string') {
    return toolArgs
  }
  
  if (typeof toolArgs === 'object') {
    return JSON.stringify(toolArgs)
  }
  
  // For any other type, convert to string
  return String(toolArgs)
}