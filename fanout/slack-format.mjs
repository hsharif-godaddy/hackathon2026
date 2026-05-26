/**
 * Format a SlackBlockMessage as a Slack Block Kit payload.
 *
 * VERBATIM PORT of `formatSlackBlockMessage` from
 * `app/src/lib/slack-webhook.ts`. The UI source is the canonical version;
 * this module exists only so the fanout Lambda produces byte-identical
 * Block Kit JSON. If you change either side, change BOTH and the
 * ditto-parity tests in slack-format.test.mjs will catch drift.
 */

export function formatSlackBlockMessage(data) {
  const blocks = [];

  // Title as bold markdown section (optional)
  if (data.title) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${data.title}*`,
      },
    });
  }

  // Single-column sections (full-width) — rendered BEFORE the two-column
  // metadata block so the long-form content (comment / description) leads.
  if (data.singleColumnSections && data.singleColumnSections.length > 0) {
    for (const section of data.singleColumnSections) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: section.label ? `*${section.label}*\n${section.value}` : section.value,
        },
      });
    }
  }

  // Two-column section with fields (left and right)
  if (data.twoColumnSection) {
    const fields = [];
    const { leftFields, rightFields } = data.twoColumnSection;

    // Interleave left and right fields for 2-column layout
    // Slack arranges fields array as: [0]=left, [1]=right, [2]=left, [3]=right, etc.
    const maxRows = Math.max(leftFields.length, rightFields.length);
    for (let i = 0; i < maxRows; i++) {
      // Add left field
      if (i < leftFields.length) {
        const left = leftFields[i];
        fields.push({
          type: 'mrkdwn',
          text: `*${left.label}*\n${left.value}`,
        });
      } else {
        // Empty placeholder to maintain layout
        fields.push({
          type: 'mrkdwn',
          text: ' ',
        });
      }

      // Add right field
      if (i < rightFields.length) {
        const right = rightFields[i];
        fields.push({
          type: 'mrkdwn',
          text: right.label ? `*${right.label}*\n${right.value}` : right.value,
        });
      } else {
        // Empty placeholder to maintain layout
        fields.push({
          type: 'mrkdwn',
          text: ' ',
        });
      }
    }

    blocks.push({
      type: 'section',
      fields,
    });
  }

  // Legacy: Add simple fields as individual section blocks
  if (data.fields && data.fields.length > 0) {
    for (const field of data.fields) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          // If label is provided, show "**Label**\nValue", otherwise just show value
          text: field.label ? `*${field.label}*\n${field.value}` : field.value,
        },
      });
    }
  }

  // Add links as context block. Entries without a `url` render as plain
  // text — used to label the row (e.g. with the app ID before the links).
  if (data.links && data.links.length > 0) {
    const linkElements = data.links.map((link) => ({
      type: 'mrkdwn',
      text: link.url ? `<${link.url}|${link.text}>` : link.text,
    }));

    blocks.push({
      type: 'context',
      elements: linkElements,
    });
  }

  // Add divider at the end
  blocks.push({
    type: 'divider',
  });

  return {
    text: data.title || 'Feedback notification', // Fallback text for notifications
    blocks,
  };
}
