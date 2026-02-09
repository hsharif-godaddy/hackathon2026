import assume from 'assume';
import { describe, it } from 'node:test';

import { parseJsonResponse } from './anthropic-client.js';

describe('anthropic-client', function packageTests() {
  describe('#parseJsonResponse', function parseJsonResponseTests() {
    it('should parse raw JSON string', function rawJson() {
      const result = parseJsonResponse<{ score: number }>('{"score": 85}');
      assume(result.score).equals(85);
    });

    it('should parse JSON from markdown code block', function markdownBlock() {
      const response = '```json\n{"score": 90, "feedback": "Good design"}\n```';
      const result = parseJsonResponse<{ score: number; feedback: string }>(response);
      assume(result.score).equals(90);
      assume(result.feedback).equals('Good design');
    });

    it('should parse JSON from code block without language tag', function codeBlockNoLang() {
      const response = '```\n{"items": ["a", "b", "c"]}\n```';
      const result = parseJsonResponse<{ items: string[] }>(response);
      assume(result.items).has.length(3);
      assume(result.items[0]).equals('a');
    });

    it('should extract JSON object from mixed text', function mixedText() {
      const response = 'Here is the analysis:\n\n{"score": 75, "issues": []}\n\nHope this helps!';
      const result = parseJsonResponse<{ score: number; issues: string[] }>(response);
      assume(result.score).equals(75);
      assume(result.issues).has.length(0);
    });

    it('should handle nested JSON objects', function nestedJson() {
      const response = '{"outer": {"inner": 42}, "list": [1, 2, 3]}';
      const result = parseJsonResponse<{ outer: { inner: number }; list: number[] }>(response);
      assume(result.outer.inner).equals(42);
      assume(result.list).has.length(3);
    });

    it('should handle JSON with whitespace in code block', function whitespace() {
      const response = '```json\n  {\n    "aestheticScore": 8,\n    "feedback": "Clean layout"\n  }\n```';
      const result = parseJsonResponse<{ aestheticScore: number; feedback: string }>(response);
      assume(result.aestheticScore).equals(8);
      assume(result.feedback).equals('Clean layout');
    });

    it('should throw on completely invalid response', function invalidResponse() {
      let threw = false;
      try {
        parseJsonResponse('This is not JSON at all and has no braces');
      } catch (error) {
        threw = true;
        assume(error).is.instanceOf(Error);
        assume((error as Error).message).includes('Failed to parse JSON');
      }
      assume(threw).is.true();
    });

    it('should throw on malformed JSON', function malformedJson() {
      let threw = false;
      try {
        parseJsonResponse('{score: 85}');
      } catch (error) {
        threw = true;
        assume(error).is.instanceOf(Error);
      }
      assume(threw).is.true();
    });

    it('should handle JSON with surrounding text and code block', function surroundingText() {
      const response = `Based on my analysis:

\`\`\`json
{
  "scores": {"design": 8, "content": 7},
  "missingElements": ["footer"],
  "presentElements": ["header", "nav"]
}
\`\`\`

Let me know if you need more details.`;

      const result = parseJsonResponse<{
        scores: Record<string, number>;
        missingElements: string[];
        presentElements: string[];
      }>(response);

      assume(result.scores.design).equals(8);
      assume(result.scores.content).equals(7);
      assume(result.missingElements).has.length(1);
      assume(result.presentElements).has.length(2);
    });

    it('should handle boolean and null values', function booleanNull() {
      const response = '{"active": true, "deleted": false, "meta": null}';
      const result = parseJsonResponse<{ active: boolean; deleted: boolean; meta: null }>(response);
      assume(result.active).is.true();
      assume(result.deleted).is.false();
      assume(result.meta).equals(null);
    });

    it('should prefer code block over raw JSON', function preferCodeBlock() {
      const response = '{"wrong": true}\n\n```json\n{"correct": true}\n```';
      const result = parseJsonResponse<{ correct?: boolean; wrong?: boolean }>(response);
      assume(result.correct).is.true();
      assume(result.wrong).equals(undefined);
    });
  });
});
