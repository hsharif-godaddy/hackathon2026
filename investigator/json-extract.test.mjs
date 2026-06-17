import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, balancedObjects } from './json-extract.mjs';

test('extractJson parses a bare object', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test('extractJson ignores prose before and after', () => {
  assert.deepEqual(extractJson('Here is the verdict:\n{"a":1}\nDone.'), { a: 1 });
});

test('extractJson reads a fenced ```json block', () => {
  assert.deepEqual(extractJson('```json\n{"a":1,"b":2}\n```'), { a: 1, b: 2 });
});

test('extractJson skips an echoed shape and returns the real object (the H1 bug)', () => {
  // Model restates the JSON shape (invalid JSON: `|` placeholders) then emits the real object.
  const text = [
    'The shape is:',
    '{ "verdict": "agent-bug" | "no-issue", "confidence": 0.0-1.0 }',
    'My answer:',
    '{"verdict":"agent-bug","confidence":0.9}',
  ].join('\n');
  assert.deepEqual(extractJson(text), { verdict: 'agent-bug', confidence: 0.9 });
});

test('extractJson is not fooled by braces inside string values', () => {
  assert.deepEqual(extractJson('{"msg":"use { and } here","n":2}'), { msg: 'use { and } here', n: 2 });
});

test('extractJson handles a closing brace inside a string before the real close', () => {
  assert.deepEqual(extractJson('{"a":"}}}}","b":1}'), { a: '}}}}', b: 1 });
});

test('extractJson throws when there is no JSON object', () => {
  assert.throws(() => extractJson('no json at all'), /no JSON object found/);
});

test('extractJson throws on a truncated (unbalanced) object', () => {
  assert.throws(() => extractJson('{"a":1, "b":'), /no JSON object found/);
});

test('balancedObjects yields each top-level object in order', () => {
  const blocks = [...balancedObjects('{"a":1} junk {"b":2}')];
  assert.deepEqual(blocks, ['{"a":1}', '{"b":2}']);
});
