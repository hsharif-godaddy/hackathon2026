import { describe, expect,it } from 'vitest'

import { completePartialJson } from './json-completion-utils'

describe('json-completion-utils', function packageTests() {
  describe('#completePartialJson', function completeTests() {
    it('should return null for empty input', function empty() {
      expect(completePartialJson('')).toBeNull()
      expect(completePartialJson('   ')).toBeNull()
    })

    it('should complete incomplete string', function incompleteString() {
      const input = '{"path": "src/pages/blog'
      const result = completePartialJson(input)
      expect(result).toBe('{"path": "src/pages/blog"}')
    })

    it('should complete incomplete string with escaped quotes', function escapedQuotes() {
      const input = '{"path": "src/pages/blog\\"test'
      const result = completePartialJson(input)
      expect(result).toBe('{"path": "src/pages/blog\\"test"}')
    })

    it('should complete incomplete array', function incompleteArray() {
      const input = '{"edits": [{"old": "line1"}'
      const result = completePartialJson(input)
      expect(result).toBe('{"edits": [{"old": "line1"}]}')
    })

    it('should complete incomplete object', function incompleteObject() {
      const input = '{"path": "test.tsx", "mode": "edit"'
      const result = completePartialJson(input)
      expect(result).toBe('{"path": "test.tsx", "mode": "edit"}')
    })

    it('should handle nested structures', function nested() {
      const input = '{"edits": [{"old": "line1", "new": "line2"'
      const result = completePartialJson(input)
      expect(result).toBe('{"edits": [{"old": "line1", "new": "line2"}]}')
    })

    it('should remove trailing commas', function trailingComma() {
      const input = '{"path": "test.tsx", "mode": "edit",'
      const result = completePartialJson(input)
      expect(result).toBe('{"path": "test.tsx", "mode": "edit"}')
    })

    it('should handle complex incomplete string with escaped characters', function complexString() {
      const input = '{"old": "      {/* Menu Section */}\\n      <section id=\\\"menu\\\" className=\\\"py-20 bg-muted/30\\\">\\n        <div className=\\\"container mx-auto px-4\\\">\\n          <h2 className=\\\"text-4xl font-bold text-center mb-12\\\">Our Menu</h2>\\n          <di'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()
      // Should close the string and object
      expect(result).toContain('"')
      expect(result?.endsWith('}')).toBe(true)
    })

    it('should handle incomplete edits array with partial old field', function partialOldField() {
      const input = '{"path": "src/pages/index.tsx", "mode": "edit", "edits": [{"old":"      {/* Menu Section */}\\n      <section id=\\\"menu\\\" className=\\\"py-20 bg-muted/30\\\">\\n        <div className=\\\"container mx-auto px-4\\\">\\n          <h2 className=\\\"text-4xl font-bold text-center mb-12\\\">Our Menu</h2>\\n          <di'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()
      // Should be parseable JSON
      expect(() => JSON.parse(result!)).not.toThrow()
    })

    it('should handle string with newlines and escaped characters', function newlinesEscaped() {
      const input = '{"old": "line1\\nline2\\nline3\\n      <div className=\\\"test\\\">'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()
      // Should close string and object properly
      expect(result?.match(/"/g)?.length).toBeGreaterThanOrEqual(4) // At least 2 pairs of quotes
    })

    it('should handle multiple incomplete strings', function multipleStrings() {
      const input = '{"edits": [{"old": "line1\\nline2", "new": "line1\\nline2\\nline3'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()
      // Should close both strings, the object, array, and outer object
      expect(() => JSON.parse(result!)).not.toThrow()
    })

    it('should handle incomplete content field', function incompleteContent() {
      const input = '{"path": "test.tsx", "mode": "create", "content": "line1\\nline2\\nline3'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()
      expect(result?.endsWith('}')).toBe(true)
    })

    it('should handle escaped backslashes in strings', function escapedBackslashes() {
      const input = '{"path": "C:\\\\Users\\\\test'
      const result = completePartialJson(input)
      expect(result).toBe('{"path": "C:\\\\Users\\\\test"}')
    })

    it('should handle mixed escaped and unescaped quotes', function mixedQuotes() {
      const input = '{"old": "text with \\"quotes\\" and more'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()
      expect(result?.endsWith('"}')).toBe(true)
    })

    it('should handle real-world failure case: incomplete old field with JSX', function realWorldFailure() {
      // This is the actual failure case from the error log
      const input = '{"path": "src/pages/index.tsx", "mode": "edit", "edits": [{"old":"      {/* Menu Section */}\\n      <section id=\\"menu\\" className=\\"py-20 bg-muted/30\\">\\n        <div className=\\"container mx-auto px-4\\">\\n          <h2 className=\\"text-4xl font-bold text-center mb-12\\">Our Menu</h2>\\n          <di'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()

      // Should be parseable JSON
      let parseError: Error | null = null
      try {
        JSON.parse(result!)
      } catch (error) {
        parseError = error as Error
      }

      expect(parseError).toBeNull()
      if (parseError) {
        console.log('Parse error:', parseError.message)
        console.log('Completed JSON:', result)
      }
    })

    it('should handle incomplete old field followed by new field', function incompleteOldThenNew() {
      const input = '{"edits": [{"old": "line1\\nline2\\nline3", "new": "line1\\nline2'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()

      // Should be parseable
      expect(() => JSON.parse(result!)).not.toThrow()
    })

    it('should handle case where string closes but object needs comma', function stringClosesNeedsComma() {
      // When we have {"old": "complete", we need to either add comma for "new" or close
      // This tests the "Expected ',' or '}'" error case
      const input = '{"edits": [{"old": "complete string value"'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()

      // Should be parseable - we should close the object properly
      expect(() => JSON.parse(result!)).not.toThrow()
    })

    it('should handle incomplete new field after complete old field', function incompleteNewAfterOld() {
      // Real-world case: old field is complete, new field is incomplete
      const input = '{"path": "src/pages/index.tsx", "mode": "edit", "edits": [{"old":"    {\\n      name: \'Loaded Nachos\',\\n      description: \'Crispy tortilla chips topped with cheese, guacamole, salsa, and sour cream\',\\n      price: \'$10.99\',\\n      image: \'https://media.gettyimages.com/id/1322160122/photo/mexican-dip-sauces-guacamole-cheedar-dip-tomato-salsa-and-pico-de-gallo-with-nacho-chips.jpg?b=1&s=2048x2048&w=0&k=20&c=BWGDa_s4UkRKVcmYue48S0fHWVL6i86CKfPiTLEmSSg=\',\\n    },\\n  ];\",\"new\":\"    {\\n      name: \'Lo'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()

      // Should be parseable
      let parseError: Error | null = null
      try {
        JSON.parse(result!)
      } catch (error) {
        parseError = error as Error
      }

      expect(parseError).toBeNull()
      if (parseError) {
        console.log('Parse error:', parseError.message)
        console.log('Completed JSON (last 200 chars):', result?.substring(Math.max(0, result.length - 200)))
      }
    })

    it('should handle string ending with escaped backslash', function stringEndingWithEscapedBackslash() {
      // When string ends with \\, we need to be careful about closing it
      const input = '{"old": "text ending with backslash\\\\'
      const result = completePartialJson(input)
      expect(result).not.toBeNull()

      // Should be parseable
      expect(() => JSON.parse(result!)).not.toThrow()
    })
  })
})
