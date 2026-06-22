import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatSlackBlockMessage } from './slack-format.mjs';

/**
 * Block Kit JSON shape tests for `formatSlackBlockMessage` (the canonical
 * formatter since the UI's slack-webhook.ts was removed). Hand-written
 * expected shapes catch drift.
 */

await test('formatSlackBlockMessage: title-only message', () => {
  const result = formatSlackBlockMessage({ title: 'Hello' });
  assert.deepEqual(result, {
    text: 'Hello',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Hello*' } },
      { type: 'divider' },
    ],
  });
});

await test('formatSlackBlockMessage: missing title falls back to "Feedback notification"', () => {
  const result = formatSlackBlockMessage({});
  assert.equal(result.text, 'Feedback notification');
  // Only the divider block when nothing else provided
  assert.deepEqual(result.blocks, [{ type: 'divider' }]);
});

await test('formatSlackBlockMessage: twoColumnSection interleaves left/right', () => {
  const result = formatSlackBlockMessage({
    twoColumnSection: {
      leftFields: [
        { label: 'A', value: '1' },
        { label: 'B', value: '2' },
      ],
      rightFields: [
        { label: 'X', value: '9' },
      ],
    },
  });
  // Block order: section(fields=[L0,R0,L1,R1-placeholder]) + divider
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0].type, 'section');
  assert.deepEqual(result.blocks[0].fields, [
    { type: 'mrkdwn', text: '*A*\n1' },
    { type: 'mrkdwn', text: '*X*\n9' },
    { type: 'mrkdwn', text: '*B*\n2' },
    { type: 'mrkdwn', text: ' ' }, // placeholder for missing right
  ]);
});

await test('formatSlackBlockMessage: rightField without label uses value directly', () => {
  const result = formatSlackBlockMessage({
    twoColumnSection: {
      leftFields: [{ label: 'L', value: 'lv' }],
      rightFields: [{ value: '7/7 - Extremely positive\n:star-struck:' }],
    },
  });
  assert.deepEqual(result.blocks[0].fields, [
    { type: 'mrkdwn', text: '*L*\nlv' },
    { type: 'mrkdwn', text: '7/7 - Extremely positive\n:star-struck:' },
  ]);
});

await test('formatSlackBlockMessage: singleColumnSections w/ and w/o label', () => {
  const result = formatSlackBlockMessage({
    singleColumnSections: [
      { label: 'Description', value: 'broken' },
      { value: '_canned line_' },
    ],
  });
  assert.deepEqual(result.blocks, [
    { type: 'section', text: { type: 'mrkdwn', text: '*Description*\nbroken' } },
    { type: 'section', text: { type: 'mrkdwn', text: '_canned line_' } },
    { type: 'divider' },
  ]);
});

await test('formatSlackBlockMessage: legacy fields render as section blocks', () => {
  const result = formatSlackBlockMessage({
    fields: [
      { label: 'L1', value: 'V1' },
      { value: 'no-label' },
    ],
  });
  assert.deepEqual(result.blocks, [
    { type: 'section', text: { type: 'mrkdwn', text: '*L1*\nV1' } },
    { type: 'section', text: { type: 'mrkdwn', text: 'no-label' } },
    { type: 'divider' },
  ]);
});

await test('formatSlackBlockMessage: links render as context block with <url|text>', () => {
  const result = formatSlackBlockMessage({
    links: [
      { url: 'https://a', text: 'A' },
      { url: 'https://b', text: 'B' },
    ],
  });
  assert.deepEqual(result.blocks[0], {
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: '<https://a|A>' },
      { type: 'mrkdwn', text: '<https://b|B>' },
    ],
  });
});

await test('formatSlackBlockMessage: link without url renders as plain mrkdwn text', () => {
  const result = formatSlackBlockMessage({
    links: [
      { text: 'app-123' },
      { url: 'https://a', text: 'A' },
    ],
  });
  assert.deepEqual(result.blocks[0], {
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: 'app-123' },
      { type: 'mrkdwn', text: '<https://a|A>' },
    ],
  });
});

await test('formatSlackBlockMessage: divider always present at end', () => {
  const result = formatSlackBlockMessage({
    title: 'T',
    links: [{ url: 'https://a', text: 'A' }],
  });
  assert.equal(result.blocks[result.blocks.length - 1].type, 'divider');
});

await test('formatSlackBlockMessage: full feedback message end-to-end', () => {
  const result = formatSlackBlockMessage({
    title: ':bug: Bug Report',
    twoColumnSection: {
      leftFields: [{ label: 'App ID', value: 'app-2' }],
      rightFields: [{ label: 'Origin', value: 'develop' }],
    },
    singleColumnSections: [{ label: 'What Happened', value: 'crash' }],
    links: [{ url: 'https://nexus', text: 'Nexus' }],
  });
  assert.deepEqual(result, {
    text: ':bug: Bug Report',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*:bug: Bug Report*' } },
      { type: 'section', text: { type: 'mrkdwn', text: '*What Happened*\ncrash' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '*App ID*\napp-2' },
          { type: 'mrkdwn', text: '*Origin*\ndevelop' },
        ],
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: '<https://nexus|Nexus>' }] },
      { type: 'divider' },
    ],
  });
});
