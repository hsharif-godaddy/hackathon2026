/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import {
  createPostPublishPreLaunchAssistantMessage,
  prelaunchKindForUserMessage,
} from '@/lib/post-publish-prelaunch-ask-question';

describe('post-publish-prelaunch-ask-question', () => {
  it('creates assistant message with completed askQuestion tool and metadata', function createMessage() {
    const msg = createPostPublishPreLaunchAssistantMessage({ appId: 'app-xyz', nonce: 3 });
    expect(msg.role).toBe('assistant');
    expect(msg.segments?.length).toBe(1);
    expect(msg.toolCalls?.length).toBe(1);
    const tc = msg.toolCalls![0];
    expect(tc.name).toBe('askQuestion');
    expect(tc.status).toBe('completed');
    const res = tc.result as {
      metadata?: { postPublishAnalyticsAppId?: string };
      widgetData?: { questions: { question: string }[] };
    };
    expect(res.metadata?.postPublishAnalyticsAppId).toBe('app-xyz');
    expect(res.widgetData?.questions.length).toBe(1);
    expect(res.widgetData?.questions[0].question.length).toBeGreaterThan(20);
  });

  it('maps SEO action message to kind', function mapSeo() {
    expect(
      prelaunchKindForUserMessage(
        'Run an SEO check on my site and suggest improvements to help me rank better in search results.',
      ),
    ).toBe('seo');
  });

  it('maps QA action message to kind', function mapQa() {
    expect(
      prelaunchKindForUserMessage(
        'Run a quality assurance analysis on my site: verify that links work, content displays correctly, and the site is easy to use. Report findings and suggest fixes.',
      ),
    ).toBe('qa');
  });

  it('maps security action message to kind', function mapSecurity() {
    expect(
      prelaunchKindForUserMessage(
        'Run a security scan on my site to identify potential security risks before launch. Report vulnerabilities and recommend fixes.',
      ),
    ).toBe('security');
  });

  it('maps run-all action message to kind', function mapAll() {
    expect(
      prelaunchKindForUserMessage(
        'Run a full pre-launch check on my site: (1) an SEO check for search ranking, (2) a quality assurance analysis for links, content display, and usability, and (3) a security scan for vulnerabilities. Then apply any auto-fixable issues, summarize what you fixed and what still needs manual attention, and remind me to publish my site again to deploy the changes.',
      ),
    ).toBe('all');
  });

  it('returns null for unrelated messages', function mapUnrelated() {
    expect(prelaunchKindForUserMessage('not a prelaunch action')).toBe(null);
  });
});
