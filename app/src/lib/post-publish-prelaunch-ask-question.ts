import type { ChatMessage, StreamSegment, ToolCall } from '@/stores/useStreamingConversationStore'

export type PrelaunchKind = 'seo' | 'qa' | 'security' | 'all'

const SEO_CHECK_ACTION_USER_MESSAGE =
  'Run an SEO check on my site and suggest improvements to help me rank better in search results.';

const QA_CHECK_ACTION_USER_MESSAGE =
  'Run a quality assurance analysis on my site: verify that links work, content displays correctly, and the site is easy to use. Report findings and suggest fixes.';

const SECURITY_CHECK_ACTION_USER_MESSAGE =
  'Run a security scan on my site to identify potential security risks before launch. Report vulnerabilities and recommend fixes.';

const RUN_AND_FIX_ALL_ACTION_USER_MESSAGE =
  'Run a full pre-launch check on my site: (1) an SEO check for search ranking, (2) a quality assurance analysis for links, content display, and usability, and (3) a security scan for vulnerabilities. Then apply any auto-fixable issues, summarize what you fixed and what still needs manual attention, and remind me to publish my site again to deploy the changes.';

const SEO_CHECK_OPTION_LABEL = 'SEO Check';
const QA_CHECK_OPTION_LABEL = 'Quality Assurance Analysis';
const SECURITY_CHECK_OPTION_LABEL = 'Security Scan';
const RUN_AND_FIX_ALL_OPTION_LABEL = 'Run All Checks';

const PRELAUNCH_QUESTION =
  "Choose a check to run before you launch. Credit usage is based on your site's size.";

const PRELAUNCH_QUESTIONS = [
  {
    question: PRELAUNCH_QUESTION,
    suggestions: [
      {
        text: SEO_CHECK_OPTION_LABEL,
        value: SEO_CHECK_ACTION_USER_MESSAGE,
        testId: 'post-publish-prelaunch-seo-run-button',
      },
      {
        text: QA_CHECK_OPTION_LABEL,
        value: QA_CHECK_ACTION_USER_MESSAGE,
        testId: 'post-publish-prelaunch-qa-run-button',
      },
      {
        text: SECURITY_CHECK_OPTION_LABEL,
        value: SECURITY_CHECK_ACTION_USER_MESSAGE,
        testId: 'post-publish-prelaunch-security-run-button',
      },
      {
        text: RUN_AND_FIX_ALL_OPTION_LABEL,
        value: RUN_AND_FIX_ALL_ACTION_USER_MESSAGE,
        testId: 'post-publish-prelaunch-all-run-button',
      },
    ],
    allowOther: false,
  },
] as const

export function prelaunchKindForUserMessage(message: string): PrelaunchKind | null {
  switch (message) {
    case SEO_CHECK_ACTION_USER_MESSAGE:
      return 'seo';
    case QA_CHECK_ACTION_USER_MESSAGE:
      return 'qa';
    case SECURITY_CHECK_ACTION_USER_MESSAGE:
      return 'security';
    case RUN_AND_FIX_ALL_ACTION_USER_MESSAGE:
      return 'all';
    default:
      return null;
  }
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Assistant message + askQuestion tool payload matching the develop agent tool output
 * so {@link AskQuestionToolRenderer} renders in the transcript.
 */
export function createPostPublishPreLaunchAssistantMessage(params: {
  appId: string
  nonce: number
}): ChatMessage {
  const messageId = generateId();
  const toolId = `prelaunch_ask_${params.nonce}_${generateId()}`;
  const questions = PRELAUNCH_QUESTIONS.map((q) => ({
    question: q.question,
    allowOther: q.allowOther,
    suggestions: [...q.suggestions],
  }));

  const toolResult = {
    success: true,
    widgetType: 'ask-question',
    widgetData: {
      questions,
      currentQuestionIndex: 0,
      answers: [],
    },
    metadata: {
      postPublishAnalyticsAppId: params.appId,
    },
  };

  const toolCall: ToolCall = {
    id: toolId,
    name: 'askQuestion',
    status: 'completed',
    input: { questions },
    result: toolResult,
  };

  const segment: StreamSegment = {
    id: `${toolId}_segment`,
    type: 'tool_call',
    content: 'Ask Question',
    timestamp: new Date(),
    toolCall,
  };

  return {
    id: messageId,
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    toolCalls: [toolCall],
    segments: [segment],
  };
}
