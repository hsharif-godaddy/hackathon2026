/**
 * Shared Slack Webhook Utility
 *
 * Provides reusable functions for sending messages to Slack webhooks.
 * Used by API routes that need to send Slack notifications.
 */

import { logger } from '@/lib/request-context';

/**
 * Slack Block Kit types
 */
interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface SlackField {
  label?: string; // Optional label - if not provided, value is displayed without label
  value: string;
}

export interface SlackLink {
  url: string;
  text: string;
}

/**
 * Two-column section with left and right fields
 */
export interface SlackTwoColumnSection {
  leftFields: Array<{ label: string; value: string }>;
  rightFields: Array<{ label?: string; value: string }>;
}

/**
 * Full-width section
 */
export interface SlackSingleSection {
  label?: string;
  value: string;
}

export interface SlackBlockMessage {
  title?: string; // Optional title
  fields?: SlackField[]; // Legacy: simple fields
  twoColumnSection?: SlackTwoColumnSection; // Two-column layout
  singleColumnSections?: SlackSingleSection[]; // Full-width sections
  links?: SlackLink[];
  includeDebugInfo?: boolean;
}

/**
 * Format message for Slack using Block Kit with divider
 */
function formatSlackBlockMessage(data: SlackBlockMessage): Record<string, unknown> {
  const blocks: SlackBlock[] = [];

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

  // Two-column section with fields (left and right)
  if (data.twoColumnSection) {
    const fields: Array<{ type: string; text: string }> = [];
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

  // Single-column sections (full-width)
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

  // Add links as context block
  if (data.links && data.links.length > 0) {
    const linkElements = data.links.map((link) => ({
      type: 'mrkdwn',
      text: `<${link.url}|${link.text}>`,
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

/**
 * Legacy format message for Slack with basic formatting
 */
function formatSlackMessage(title: string, message: string): Record<string, unknown> {
  return {
    text: title,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${title}*\n\n${message}`,
        },
      },
      {
        type: 'divider',
      },
    ],
  };
}

/**
 * Result of sending a message to Slack
 */
export interface SlackSendResult {
  success: boolean;
  error?: string;
  status?: number;
}

/**
 * Send a Block Kit message to a Slack webhook URL
 *
 * @param webhookUrl - The Slack webhook URL to send the message to
 * @param data - Block message data with title, fields, and links
 * @returns Result object indicating success or failure
 */
export async function sendSlackBlockMessage(
  webhookUrl: string,
  data: SlackBlockMessage
): Promise<SlackSendResult> {
  try {
    // Validate webhook URL format
    if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
      logger.warn('slack.webhook.invalid_url', {
        message: 'Invalid Slack webhook URL format',
      });
      return {
        success: false,
        error: 'Invalid Slack webhook URL',
        status: 400,
      };
    }

    logger.info('slack.webhook.sending_blocks', {
      title: data.title,
      fieldCount: data.fields?.length || 0,
      linkCount: data.links?.length || 0,
    });

    const slackMessage = formatSlackBlockMessage(data);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(slackMessage),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error('slack.webhook.send_failed', {
        title: data.title,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: 'Failed to send message to Slack',
        status: response.status,
      };
    }

    logger.info('slack.webhook.sent', {
      title: data.title,
      success: true,
    });

    return { success: true };
  } catch (error) {
    logger.error('slack.webhook.error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      success: false,
      error: 'Internal error sending message to Slack',
      status: 500,
    };
  }
}

/**
 * Send a message to a Slack webhook URL (legacy format)
 *
 * @param webhookUrl - The Slack webhook URL to send the message to
 * @param title - The title of the message
 * @param message - The message content
 * @returns Result object indicating success or failure
 */
export async function sendSlackMessage(
  webhookUrl: string,
  title: string,
  message: string
): Promise<SlackSendResult> {
  try {
    // Validate webhook URL format
    if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
      logger.warn('slack.webhook.invalid_url', {
        message: 'Invalid Slack webhook URL format',
      });
      return {
        success: false,
        error: 'Invalid Slack webhook URL',
        status: 400,
      };
    }

    logger.info('slack.webhook.sending', {
      title,
      messageLength: message.length,
    });

    const slackMessage = formatSlackMessage(title, message);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(slackMessage),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error('slack.webhook.send_failed', {
        title,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: 'Failed to send message to Slack',
        status: response.status,
      };
    }

    logger.info('slack.webhook.sent', {
      title,
      success: true,
    });

    return { success: true };
  } catch (error) {
    logger.error('slack.webhook.error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      success: false,
      error: 'Internal error sending message to Slack',
      status: 500,
    };
  }
}
