/**
 * Pure mapping: parquet feedback row → Atlassian REST v3 create-issue body.
 *
 * No custom fields exist on AABSP, so everything goes into description (ADF)
 * + labels. The `feedback-id-<id>` label is the idempotency key — see
 * `findIssueByFeedbackId` in jira-client.mjs.
 *
 * Rules:
 *   - issuetype: issue→Bug, support→Task, feedback→Task
 *   - summary: first 80 chars of feedback_text (ellipsis if truncated),
 *     fallback "[<category>] feedback from <customer_id>" when text empty
 *   - description: ADF doc with paragraphs + codeBlock for full text
 *   - labels: user-feedback, feedback-type-<cat>, app-<id>, feedback-id-<id>
 *     (idempotency); feedback category adds rating-<n> when rating != null.
 *     customer_id intentionally NOT in labels — Jira labels are project-wide
 *     searchable and not redactable per-issue, so customer/shopper IDs stay
 *     in the description body only (where they can be cleaned per-issue).
 *   - project.key: caller-supplied (avoids env coupling in pure mapper)
 *   - DOES NOT set priority, reporter, or any custom fields.
 */

const SUMMARY_MAX = 80;

function issueTypeName(category) {
  if (category === 'issue') return 'Bug';
  return 'Task'; // support + feedback both map to Task
}

function buildSummary(row) {
  const text = (row.feedback_text ?? '').trim();
  if (!text) {
    return `[${row.feedback_category ?? 'unknown'}] feedback from ${row.customer_id ?? 'unknown'}`;
  }
  if (text.length <= SUMMARY_MAX) return text;
  return text.slice(0, SUMMARY_MAX - 1) + '…'; // single-char ellipsis
}

function paragraph(text) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function codeBlock(text) {
  return {
    type: 'codeBlock',
    attrs: { language: '' },
    content: [{ type: 'text', text }],
  };
}

function parseTopics(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildDescriptionAdf(row) {
  const content = [];

  content.push(paragraph(`Customer: ${row.customer_id ?? 'unknown'}`));
  content.push(paragraph(`App: ${row.app_id ?? 'unknown'}`));
  content.push(paragraph(`Submission ID: ${row.feedback_id ?? 'unknown'}`));

  content.push(paragraph(`Category: ${row.feedback_category ?? 'unknown'}`));
  if (row.feedback_origin_name) {
    content.push(paragraph(`Origin: ${row.feedback_origin_name}`));
  }
  if (row.feedback_category === 'feedback' && row.rating != null) {
    content.push(paragraph(`Rating: ${row.rating}`));
  }

  const topics = parseTopics(row.feedback_topic_list);
  if (topics.length > 0) {
    content.push(paragraph(`Topics: ${topics.join(', ')}`));
  }

  const text = (row.feedback_text ?? '').trim();
  if (text) {
    content.push(paragraph('Feedback:'));
    content.push(codeBlock(text));
  }

  if (row.preview_url) {
    content.push(paragraph(`Preview URL: ${row.preview_url}`));
  }
  if (row.published_url_full) {
    content.push(paragraph(`Published URL: ${row.published_url_full}`));
  }
  if (row.full_story_url) {
    content.push(paragraph(`FullStory URL: ${row.full_story_url}`));
  }

  if (row.subscription_info) {
    content.push(paragraph(`Subscription: ${row.subscription_info}`));
  }
  if (row.subscription_id) {
    content.push(paragraph(`Subscription ID: ${row.subscription_id}`));
  }
  if (row.subscription_status) {
    content.push(paragraph(`Subscription Status: ${row.subscription_status}`));
  }

  return { type: 'doc', version: 1, content };
}

function buildLabels(row) {
  const labels = ['user-feedback'];
  if (row.feedback_category) labels.push(`feedback-type-${row.feedback_category}`);
  if (row.app_id) labels.push(`app-${row.app_id}`);
  if (row.feedback_id) labels.push(`feedback-id-${row.feedback_id}`);
  if (row.feedback_category === 'feedback' && row.rating != null) {
    labels.push(`rating-${row.rating}`);
  }
  return labels;
}

/**
 * @param {object} row - parquet feedback row
 * @param {string} projectKey - AABSP or other Atlassian project key
 */
export function buildJiraIssueBody(row, projectKey) {
  return {
    fields: {
      project: { key: projectKey },
      issuetype: { name: issueTypeName(row.feedback_category) },
      summary: buildSummary(row),
      description: buildDescriptionAdf(row),
      labels: buildLabels(row),
    },
  };
}
