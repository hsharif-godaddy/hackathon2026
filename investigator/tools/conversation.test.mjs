import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationTools } from './conversation.mjs';

const SAMPLE = JSON.stringify([
  { id: 'c1', messages: [{ role: 'user', content: 'build me a schedule page' }] },
  { id: 'c2', messages: [{ role: 'assistant', content: 'added /schedule route' }] },
]);

test('readConversation returns transcript text + conversation count', async () => {
  const tools = createConversationTools({
    conversationsPath: '/tmp/conversations.json',
    readFileImpl: async () => SAMPLE,
  });
  const r = await tools.readConversation.execute({ offset: 0, maxChars: 40000 });
  assert.equal(r.ok, true);
  assert.equal(r.totalConversations, 2);
  assert.match(r.text, /schedule page/);
  assert.equal(r.truncated, false);
});

test('readConversation pages with offset and reports truncation', async () => {
  const tools = createConversationTools({
    conversationsPath: '/tmp/c.json',
    readFileImpl: async () => SAMPLE,
  });
  const r = await tools.readConversation.execute({ offset: 0, maxChars: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.text.length, 20);
  assert.equal(r.truncated, true);
  assert.equal(r.totalChars, SAMPLE.length);
});

test('readConversation returns ok:false when no transcript path configured', async () => {
  const tools = createConversationTools({ conversationsPath: '' });
  const r = await tools.readConversation.execute({ offset: 0, maxChars: 100 });
  assert.equal(r.ok, false);
  assert.match(r.error, /no conversation transcript/i);
});

test('readConversation soft-fails (ok:false) when the file read throws', async () => {
  const tools = createConversationTools({
    conversationsPath: '/tmp/missing.json',
    readFileImpl: async () => { throw new Error('ENOENT'); },
  });
  const r = await tools.readConversation.execute({ offset: 0, maxChars: 100 });
  assert.equal(r.ok, false);
  assert.match(r.error, /ENOENT/);
});

test('readConversation tolerates non-array transcript JSON', async () => {
  const tools = createConversationTools({
    conversationsPath: '/tmp/c.json',
    readFileImpl: async () => 'not json at all',
  });
  const r = await tools.readConversation.execute({ offset: 0, maxChars: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.totalConversations, null);
  assert.match(r.text, /not json/);
});
