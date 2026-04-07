import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

import { askQuestionAITool, askQuestionInputSchema } from '../ask-question.js'

const createExecutionOptions = (appId?: string) => ({
  experimental_context: {
    metadata: appId ? { appId } : {}
  }
})

describe('ask-question', function askQuestionTests() {
  describe('#schema validation', function schemaTests() {
    it('should parse plain string suggestions into objects', function plainStrings() {
      const result = askQuestionInputSchema.parse({
        questions: [{
          question: "What's your business name?",
          suggestions: ['Haven', 'Bloom', 'Luxe']
        }]
      })

      expect(result.questions[0].suggestions).toEqual([
        { text: 'Haven' },
        { text: 'Bloom' },
        { text: 'Luxe' }
      ])
    })

    it('should pass through object suggestions unchanged', function objects() {
      const result = askQuestionInputSchema.parse({
        questions: [{
          question: "What's your business name?",
          suggestions: [
            { text: 'Haven' },
            { text: 'Bloom' },
            { text: 'Luxe' }
          ]
        }]
      })

      expect(result.questions[0].suggestions).toEqual([
        { text: 'Haven' },
        { text: 'Bloom' },
        { text: 'Luxe' }
      ])
    })

    it('should preserve value field in object suggestions', function valueField() {
      const result = askQuestionInputSchema.parse({
        questions: [{
          question: 'What price range?',
          suggestions: [
            { text: 'Budget-friendly (under $50)', value: 'budget' },
            { text: 'Premium ($200+)', value: 'premium' }
          ]
        }]
      })

      expect(result.questions[0].suggestions).toEqual([
        { text: 'Budget-friendly (under $50)', value: 'budget' },
        { text: 'Premium ($200+)', value: 'premium' }
      ])
    })

    it('should handle mixed string and object suggestions', function mixed() {
      const result = askQuestionInputSchema.parse({
        questions: [{
          question: "What's your main goal?",
          suggestions: [
            'Sell products online',
            { text: 'Showcase collections', value: 'showcase' },
            'Book appointments'
          ]
        }]
      })

      expect(result.questions[0].suggestions).toEqual([
        { text: 'Sell products online' },
        { text: 'Showcase collections', value: 'showcase' },
        { text: 'Book appointments' }
      ])
    })

    it('should apply default values for allowOther and multiSelect', function defaults() {
      const result = askQuestionInputSchema.parse({
        questions: [{
          question: "What's your name?",
          suggestions: ['A', 'B']
        }]
      })

      expect(result.questions[0].allowOther).toBe(true)
      expect(result.questions[0].multiSelect).toBe(false)
    })

    it('should reject empty suggestions array', function emptySuggestions() {
      expect(() => askQuestionInputSchema.parse({
        questions: [{
          question: "What's your name?",
          suggestions: []
        }]
      })).toThrow()
    })

    it('should reject empty questions array', function emptyQuestions() {
      expect(() => askQuestionInputSchema.parse({
        questions: []
      })).toThrow()
    })

    it('should reject non-string non-object suggestions', function invalidTypes() {
      expect(() => askQuestionInputSchema.parse({
        questions: [{
          question: "What's your name?",
          suggestions: [123]
        }]
      })).toThrow()
    })
  })

  describe('#execute', function executeTests() {
    it('should return widget data for multiple questions', async function multipleQuestions() {
      const result = await askQuestionAITool.execute(
        {
          questions: [
            {
              question: "What's your business name?",
              suggestions: [{ text: 'Haven' }, { text: 'Bloom' }],
              allowOther: true,
              multiSelect: false
            },
            {
              question: 'Where are you located?',
              suggestions: [{ text: 'New York' }, { text: 'Los Angeles' }],
              allowOther: true,
              multiSelect: false
            }
          ]
        },
        createExecutionOptions('test-app')
      ) as any

      expect(result.success).toBe(true)
      expect(result.widgetType).toBe('ask-question')
      expect(result.widgetData.questions).toHaveLength(2)
      expect(result.widgetData.currentQuestionIndex).toBe(0)
      expect(result.widgetData.answers).toEqual([])
      expect(result.message).toBe('Asked 2 questions')
    })

    it('should return singular message for one question', async function singleQuestion() {
      const result = await askQuestionAITool.execute(
        {
          questions: [{
            question: "What's your name?",
            suggestions: [{ text: 'Test' }],
            allowOther: true,
            multiSelect: false
          }]
        },
        createExecutionOptions('test-app')
      ) as any

      expect(result.message).toBe('Asked 1 question')
    })
  })
})
