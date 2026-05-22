import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildJiraIssueBody } from './jira-mapping.mjs';

const PROJECT_KEY = 'AABSP';

const BASE_ROW = {
  customer_id: 'cust-1',
  app_id: 'app-1',
  feedback_id: 'sub-1',
  feedback_origin_name: 'first-publish-banner',
  feedback_category: 'issue',
  rating: null,
  feedback_text: 'broken thing',
  feedback_topic_list: '["topic-a"]',
  consent_flag: true,
};

await test('issue category → Bug', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY);
  assert.equal(body.fields.issuetype.name, 'Bug');
  assert.equal(body.fields.project.key, 'AABSP');
});

await test('support category → Task', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_category: 'support' }, PROJECT_KEY);
  assert.equal(body.fields.issuetype.name, 'Task');
});

await test('feedback category → Task', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_category: 'feedback', rating: 3 }, PROJECT_KEY);
  assert.equal(body.fields.issuetype.name, 'Task');
});

await test('summary truncated to 80 chars with ellipsis when too long', () => {
  const longText = 'x'.repeat(200);
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_text: longText }, PROJECT_KEY);
  assert.equal(body.fields.summary.length, 80);
  assert.ok(body.fields.summary.endsWith('…'));
});

await test('summary kept verbatim when ≤80 chars', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_text: 'short text' }, PROJECT_KEY);
  assert.equal(body.fields.summary, 'short text');
});

await test('empty feedback_text → fallback summary', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_text: '' }, PROJECT_KEY);
  assert.equal(body.fields.summary, '[issue] feedback from cust-1');
});

await test('null/missing feedback_text → fallback summary', () => {
  const row = { ...BASE_ROW };
  delete row.feedback_text;
  const body = buildJiraIssueBody(row, PROJECT_KEY);
  assert.equal(body.fields.summary, '[issue] feedback from cust-1');
});

await test('labels always include user-feedback + feedback-type-X + app-X + feedback-id-X', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY);
  assert.ok(body.fields.labels.includes('user-feedback'));
  assert.ok(body.fields.labels.includes('feedback-type-issue'));
  assert.ok(body.fields.labels.includes('app-app-1'));
  assert.ok(body.fields.labels.includes('feedback-id-sub-1'));
});

await test('labels do NOT include customer-id (PII; lives only in description body)', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY);
  assert.ok(!body.fields.labels.some((l) => l.startsWith('customer-')));
});

await test('feedback category includes rating-N label when rating != null', () => {
  const body = buildJiraIssueBody({
    ...BASE_ROW,
    feedback_category: 'feedback',
    rating: 3,
  }, PROJECT_KEY);
  assert.ok(body.fields.labels.includes('rating-3'));
});

await test('feedback category omits rating label when rating == null', () => {
  const body = buildJiraIssueBody({
    ...BASE_ROW,
    feedback_category: 'feedback',
    rating: null,
  }, PROJECT_KEY);
  assert.ok(!body.fields.labels.some((l) => l.startsWith('rating-')));
});

await test('issue category does NOT include rating label even when rating present', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_category: 'issue', rating: 2 }, PROJECT_KEY);
  assert.ok(!body.fields.labels.some((l) => l.startsWith('rating-')));
});

await test('description is ADF doc with version=1', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY);
  assert.equal(body.fields.description.type, 'doc');
  assert.equal(body.fields.description.version, 1);
  assert.ok(Array.isArray(body.fields.description.content));
});

await test('description includes feedback text inside codeBlock', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, feedback_text: 'multi\nline\nfeedback' }, PROJECT_KEY);
  const codeBlocks = body.fields.description.content.filter((n) => n.type === 'codeBlock');
  assert.equal(codeBlocks.length, 1);
  assert.equal(codeBlocks[0].content[0].text, 'multi\nline\nfeedback');
});

await test('description carries customer_id paragraph (kept in body, not labels)', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY);
  const texts = body.fields.description.content
    .filter((n) => n.type === 'paragraph')
    .map((n) => n.content[0].text);
  assert.ok(texts.some((t) => t === 'Customer: cust-1'));
});

await test('feedback category surfaces Rating: line in description', () => {
  const body = buildJiraIssueBody({
    ...BASE_ROW,
    feedback_category: 'feedback',
    rating: 3,
  }, PROJECT_KEY);
  const texts = body.fields.description.content
    .filter((n) => n.type === 'paragraph')
    .map((n) => n.content[0].text);
  assert.ok(texts.some((t) => t === 'Rating: 3'));
});

await test('null preview_url → no Preview URL paragraph', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW, preview_url: null }, PROJECT_KEY);
  const texts = body.fields.description.content
    .filter((n) => n.type === 'paragraph')
    .map((n) => n.content[0].text);
  assert.ok(!texts.some((t) => t.startsWith('Preview URL')));
});

await test('present preview_url → Preview URL paragraph included', () => {
  const body = buildJiraIssueBody({
    ...BASE_ROW,
    preview_url: 'https://preview.example.com/?t=abc',
  }, PROJECT_KEY);
  const texts = body.fields.description.content
    .filter((n) => n.type === 'paragraph')
    .map((n) => n.content[0].text);
  assert.ok(texts.some((t) => t === 'Preview URL: https://preview.example.com/?t=abc'));
});

await test('present full_story_url + published_url_full → both paragraphs included', () => {
  const body = buildJiraIssueBody({
    ...BASE_ROW,
    full_story_url: 'https://app.fullstory.com/ui/123/session/abc',
    published_url_full: 'https://customer.app.example.com',
  }, PROJECT_KEY);
  const texts = body.fields.description.content
    .filter((n) => n.type === 'paragraph')
    .map((n) => n.content[0].text);
  assert.ok(texts.some((t) => t.startsWith('Published URL: https://customer.app.example.com')));
  assert.ok(texts.some((t) => t.startsWith('FullStory URL: https://app.fullstory.com')));
});

await test('topics joined into single paragraph', () => {
  const body = buildJiraIssueBody({
    ...BASE_ROW,
    feedback_topic_list: '["a","b","c"]',
  }, PROJECT_KEY);
  const texts = body.fields.description.content
    .filter((n) => n.type === 'paragraph')
    .map((n) => n.content[0].text);
  assert.ok(texts.some((t) => t === 'Topics: a, b, c'));
});

await test('priority and reporter NOT set', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, PROJECT_KEY);
  assert.equal(body.fields.priority, undefined);
  assert.equal(body.fields.reporter, undefined);
});

await test('project.key uses caller-supplied value (override-able)', () => {
  const body = buildJiraIssueBody({ ...BASE_ROW }, 'OTHER');
  assert.equal(body.fields.project.key, 'OTHER');
});
