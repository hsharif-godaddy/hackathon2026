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

    it('should preserve trackingId field in object suggestions', function trackingIdField() {
      const result = askQuestionInputSchema.parse({
        questions: [{
          question: 'What would you like to do next?',
          suggestions: [
            'Edit or refine this logo',
            { text: 'Build a website with this logo', trackingId: 'logo_designer_build_website' }
          ]
        }]
      })

      expect(result.questions[0].suggestions).toEqual([
        { text: 'Edit or refine this logo' },
        { text: 'Build a website with this logo', trackingId: 'logo_designer_build_website' }
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

    it('should accept optional subtitle', function subtitle() {
      const result = askQuestionInputSchema.parse({
        questions: [{
          question: 'Location?',
          subtitle: "If you have one in mind. Otherwise I'll invent.",
          suggestions: ['A']
        }]
      })
      expect(result.questions[0].subtitle).toBe("If you have one in mind. Otherwise I'll invent.")
    })

    it('should accept type: chips_single', function chipsSingle() {
      const result = askQuestionInputSchema.parse({
        questions: [{
          question: 'Vibe?',
          type: 'chips_single',
          suggestions: ['Cozy', 'Bold', 'Decide for me']
        }]
      })
      expect(result.questions[0].type).toBe('chips_single')
    })

    it('should accept type: chips_multi', function chipsMulti() {
      const result = askQuestionInputSchema.parse({
        questions: [{
          question: 'Palette?',
          type: 'chips_multi',
          suggestions: ['Warm earth', 'Decide for me']
        }]
      })
      expect(result.questions[0].type).toBe('chips_multi')
    })

    it('should accept type: text with empty suggestions', function textEmpty() {
      const result = askQuestionInputSchema.parse({
        questions: [{
          question: 'Naming?',
          type: 'text',
          placeholder: 'Your answer...',
          suggestions: []
        }]
      })
      expect(result.questions[0].type).toBe('text')
      expect(result.questions[0].placeholder).toBe('Your answer...')
      expect(result.questions[0].suggestions).toEqual([])
    })

    it('should reject invalid type values', function invalidType() {
      expect(() => askQuestionInputSchema.parse({
        questions: [{
          question: 'Vibe?',
          type: 'chips_dropdown',
          suggestions: ['A']
        }]
      })).toThrow()
    })

    it('should still require suggestions when type is omitted', function suggestionsRequired() {
      expect(() => askQuestionInputSchema.parse({
        questions: [{
          question: 'Vibe?',
          suggestions: []
        }]
      })).toThrow()
    })

    it('should still require suggestions for chips_single', function chipsSingleRequires() {
      expect(() => askQuestionInputSchema.parse({
        questions: [{
          question: 'Vibe?',
          type: 'chips_single',
          suggestions: []
        }]
      })).toThrow()
    })

    it('should still require suggestions for chips_multi', function chipsMultiRequires() {
      expect(() => askQuestionInputSchema.parse({
        questions: [{
          question: 'Palette?',
          type: 'chips_multi',
          suggestions: []
        }]
      })).toThrow()
    })

    it('should reject an unanswerable text step (no suggestions AND allowOther=false)', function unanswerableText() {
      expect(() => askQuestionInputSchema.parse({
        questions: [{
          question: 'Your answer?',
          type: 'text',
          suggestions: [],
          allowOther: false
        }]
      })).toThrow(/allowOther=true/)
    })

    it('should reject an unanswerable chip step (suggestions=[] AND allowOther=false, type omitted)', function unanswerableChip() {
      // The existing "suggestions must have at least 1 entry" rule fires first
      // for chip-type questions, but the new allowOther invariant still kicks
      // in for legacy callers that omit `type` — verify we get BOTH issues
      // reported, not silent acceptance.
      const result = askQuestionInputSchema.safeParse({
        questions: [{
          question: 'Pick one',
          suggestions: [],
          allowOther: false
        }]
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        const messages = result.error.issues.map(i => i.message).join('\n')
        expect(messages).toMatch(/allowOther=true/)
      }
    })

    it('should reject contradictory type chips_single with multiSelect=true', function chipsSingleMultiFalse() {
      expect(() => askQuestionInputSchema.parse({
        questions: [{
          question: 'Pick',
          type: 'chips_single',
          multiSelect: true,
          suggestions: [{ text: 'A' }, { text: 'B' }]
        }]
      })).toThrow(/chips_multi/)
    })

    it('should reject contradictory type text with multiSelect=true', function textMultiFalse() {
      expect(() => askQuestionInputSchema.parse({
        questions: [{
          question: 'Text',
          type: 'text',
          multiSelect: true,
          suggestions: []
        }]
      })).toThrow(/text.*incompatible.*multiSelect/)
    })

    it('should reject a multi-question call with mixed allowOther values', function mixedAllowOther() {
      expect(() => askQuestionInputSchema.parse({
        questions: [
          { question: 'Q1', suggestions: [{ text: 'A' }], allowOther: false },
          { question: 'Q2', suggestions: [{ text: 'B' }], allowOther: true },
        ]
      })).toThrow(/mixed values/)
    })

    it('should accept a multi-question call with uniform allowOther values', function uniformAllowOther() {
      const result = askQuestionInputSchema.parse({
        questions: [
          { question: 'Q1', suggestions: [{ text: 'A' }], allowOther: true },
          { question: 'Q2', suggestions: [{ text: 'B' }], allowOther: true },
        ]
      })
      expect(result.questions).toHaveLength(2)
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
