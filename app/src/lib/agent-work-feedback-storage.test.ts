/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  agentWorkFeedbackStorageKey,
  hasShownAgentWorkFeedback,
  markAgentWorkFeedbackShown,
} from './agent-work-feedback-storage';

describe('agent-work-feedback-storage', function storageTests() {
  beforeEach(function clearStorage() {
    window.localStorage.clear();
  });

  it('builds a dedupe key per agent, app, and milestone', function key() {
    expect(agentWorkFeedbackStorageKey('InitialAgent', 'app-1', 'firstFileEdit')).toBe(
      'InitialAgent-app-1-firstFileEdit'
    );
  });

  it('marks and reads feedback shown state', function markRead() {
    const dedupeKey = agentWorkFeedbackStorageKey('InitialAgent', 'app-1', 'firstFileEdit');
    expect(hasShownAgentWorkFeedback(dedupeKey)).toBe(false);
    markAgentWorkFeedbackShown(dedupeKey);
    expect(hasShownAgentWorkFeedback(dedupeKey)).toBe(true);
    expect(
      window.localStorage.getItem(`appbuilder-agent-work-feedback-shown:${dedupeKey}`)
    ).toBe('true');
  });
});
