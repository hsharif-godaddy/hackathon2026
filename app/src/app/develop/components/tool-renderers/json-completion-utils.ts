/**
 * Utility functions for completing partial JSON strings
 * 
 * Used to parse incomplete JSON that arrives as streaming deltas,
 * allowing us to extract values before the JSON is fully complete.
 */

/**
 * Attempts to complete a partial JSON string by adding closing characters
 * 
 * Handles:
 * - Incomplete strings (closes them)
 * - Incomplete arrays (closes with ])
 * - Incomplete objects (closes with })
 * - Escaped characters in strings
 * 
 * @param partialJson - The incomplete JSON string to complete
 * @returns The completed JSON string, or null if completion is not possible
 */
export function completePartialJson(partialJson: string): string | null {
  if (!partialJson || partialJson.trim().length === 0) {
    return null
  }

  let completed = partialJson.trim()
  
  // Remove trailing commas that might break parsing
  completed = completed.replace(/,\s*$/, '')
  
  // Better string detection: walk through the string and track if we're inside a string
  // This handles escaped quotes correctly
  // We may need to close multiple strings if we have incomplete strings in sequence
  const maxIterations = 10 // Prevent infinite loops
  let iteration = 0
  
  while (iteration < maxIterations) {
    iteration++
    let inString = false
    let escapeNext = false
    
    for (let i = 0; i < completed.length; i++) {
      const char = completed[i]
      if (escapeNext) {
        escapeNext = false
        continue
      }
      if (char === '\\') {
        escapeNext = true
        continue
      }
      if (char === '"') {
        inString = !inString
      }
    }
    
    // If we're not in a string, we're done closing strings
    if (!inString || completed.endsWith('"')) {
      break
    }
    
    // We're in a string, close it
    // But be careful - if the last character is a backslash, we might be escaping something
    // Check if we're ending with an escape sequence
    let trailingBackslashes = 0
    for (let i = completed.length - 1; i >= 0; i--) {
      if (completed[i] === '\\') {
        trailingBackslashes++
      } else {
        break
      }
    }
    // If odd number of backslashes, the last one is escaping the quote we're about to add
    // In that case, we need to add an extra backslash
    if (trailingBackslashes % 2 === 1) {
      completed += '\\"'
    } else {
      completed += '"'
    }
  }
  
  // Count open/close braces and brackets (only when not in a string)
  // Track nesting structure to determine closing order
  let openBraces = 0
  let closeBraces = 0
  let openBrackets = 0
  let closeBrackets = 0
  let inString = false
  let escapeNext = false
  
  // Track the nesting structure: what's the innermost open structure?
  const structureStack: Array<'{' | '['> = []
  
  for (let i = 0; i < completed.length; i++) {
    const char = completed[i]
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (char === '\\') {
      escapeNext = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (!inString) {
      if (char === '{') {
        openBraces++
        structureStack.push('{')
      }
      if (char === '}') {
        closeBraces++
        structureStack.pop()
      }
      if (char === '[') {
        openBrackets++
        structureStack.push('[')
      }
      if (char === ']') {
        closeBrackets++
        structureStack.pop()
      }
    }
  }
  
  // Close structures in reverse order of opening (LIFO - Last In First Out)
  // This ensures we close inner structures before outer ones
  while (structureStack.length > 0) {
    const lastOpened = structureStack.pop()
    if (lastOpened === '[') {
      completed += ']'
      closeBrackets++
    } else if (lastOpened === '{') {
      completed += '}'
      closeBraces++
    }
  }
  
  // Also close any remaining unmatched structures (fallback)
  for (let i = closeBrackets; i < openBrackets; i++) {
    completed += ']'
  }
  for (let i = closeBraces; i < openBraces; i++) {
    completed += '}'
  }

  return completed
}

