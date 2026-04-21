/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFullStory } = vi.hoisted(() => ({
  mockFullStory: vi.fn(),
}));

vi.mock('@fullstory/browser', () => ({
  FullStory: mockFullStory,
}));

import { JourneyTracker } from '@/lib/journeyTracker';

let nowValue = 1000;

function trackEventCalls(): Array<{ name: string; properties: Record<string, unknown> }> {
  return mockFullStory.mock.calls
    .filter(([op]: [string]) => op === 'trackEvent')
    .map(([, opts]: [string, { name: string; properties: Record<string, unknown> }]) => opts);
}

function eventsByName(name: string) {
  return trackEventCalls().filter((e) => e.name === name);
}

describe('JourneyTracker', function trackerTests() {
  beforeEach(function setup() {
    nowValue = 1000;
    vi.useFakeTimers({
      shouldAdvanceTime: false,
      toFake: ['setTimeout', 'clearTimeout', 'Date'],
    });
    vi.spyOn(performance, 'now').mockImplementation(() => nowValue);
  });

  afterEach(function teardown() {
    JourneyTracker.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
    mockFullStory.mockClear();
  });

  describe('#start and #stop', function lifecycleTests() {
    it('should create a singleton instance', function createSingleton() {
      JourneyTracker.start({});
      expect(JourneyTracker.current()).not.toBeNull();
    });

    it('should destroy on stop and clear singleton', function destroyOnStop() {
      JourneyTracker.start({});
      JourneyTracker.stop();
      expect(JourneyTracker.current()).toBeNull();
    });

    it('should replace previous instance on repeated start', function replaceInstance() {
      JourneyTracker.start({});
      const first = JourneyTracker.current();
      JourneyTracker.start({});
      expect(JourneyTracker.current()).not.toBe(first);
    });
  });

  describe('#idle detection', function idleTests() {
    it('should fire Page Engagement with active time while user is active', function activeTime() {
      JourneyTracker.start({});
      JourneyTracker.current()!.setPage('/develop/123');
      nowValue = 6000;
      JourneyTracker.stop();

      const events = eventsByName('Page Engagement');
      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1].properties.activeTimeMs).toBeGreaterThan(0);
    });

    it('should track idle time after 30s threshold expires', function idleTime() {
      JourneyTracker.start({});
      JourneyTracker.current()!.setPage('/');
      nowValue = 2000;
      vi.advanceTimersByTime(30_000);

      nowValue = 35_000;
      JourneyTracker.stop();

      const events = eventsByName('Page Engagement');
      expect(events[events.length - 1].properties.idleTimeMs).toBeGreaterThan(0);
    });

    it('should resume active on user activity after idle', function resumeActive() {
      JourneyTracker.start({});
      JourneyTracker.current()!.setPage('/develop/123');

      nowValue = 2000;
      vi.advanceTimersByTime(30_000);

      nowValue = 33_000;
      document.dispatchEvent(new Event('mousedown'));

      nowValue = 35_000;
      JourneyTracker.stop();

      const events = eventsByName('Page Engagement');
      const last = events[events.length - 1].properties;
      expect(last.activeTimeMs).toBeGreaterThan(0);
      expect(last.idleTimeMs).toBeGreaterThan(0);
    });
  });

  describe('#page tracking', function pageTests() {
    it('should fire Page Engagement when switching pages', function switchPage() {
      JourneyTracker.start({});
      JourneyTracker.current()!.setPage('/');
      nowValue = 3000;
      JourneyTracker.current()!.setPage('/develop/123');

      const events = eventsByName('Page Engagement');
      expect(events.length).toBe(1);
      expect(events[0].properties.page).toBe('/');
    });

    it('should not fire on duplicate page set', function noDuplicate() {
      JourneyTracker.start({});
      JourneyTracker.current()!.setPage('/');
      mockFullStory.mockClear();

      JourneyTracker.current()!.setPage('/');
      expect(eventsByName('Page Engagement').length).toBe(0);
    });

    it('should include scrollDepthPercent and interactionCount', function pageMetrics() {
      JourneyTracker.start({});
      JourneyTracker.current()!.setPage('/');
      nowValue = 3000;
      JourneyTracker.stop();

      const events = eventsByName('Page Engagement');
      expect(events[0].properties).toHaveProperty('scrollDepthPercent', 0);
      expect(events[0].properties).toHaveProperty('interactionCount', 0);
    });

    it('should reset page counters after page switch', function resetCounters() {
      JourneyTracker.start({});
      JourneyTracker.current()!.setPage('/');
      nowValue = 5000;
      JourneyTracker.current()!.setPage('/develop/123');
      nowValue = 7000;
      JourneyTracker.stop();

      const events = eventsByName('Page Engagement');
      const homeEvent = events.find((e) => e.properties.page === '/');
      const developEvent = events.find((e) => e.properties.page === '/develop/123');
      expect(homeEvent!.properties.activeTimeMs).toBeCloseTo(4000, -1);
      expect(developEvent!.properties.activeTimeMs).toBeCloseTo(2000, -1);
    });
  });

  describe('#prompt tracking', function promptTests() {
    it('should fire Prompt Started with promptId and length', function promptStarted() {
      JourneyTracker.start({});
      JourneyTracker.current()!.setPage('/develop/123');
      JourneyTracker.current()!.trackPromptStarted('p1', 'hello world');

      const events = eventsByName('Prompt Started');
      expect(events.length).toBe(1);
      expect(events[0].properties.promptId).toBe('p1');
      expect(events[0].properties.promptLength).toBe(11);
      expect(events[0].properties.page).toBe('/develop/123');
    });

    it('should fire First Prompt Submitted only once', function firstPromptOnce() {
      JourneyTracker.start({});
      nowValue = 3000;
      JourneyTracker.current()!.trackPromptStarted('p1', 'first');
      JourneyTracker.current()!.trackPromptStarted('p2', 'second');

      const events = eventsByName('First Prompt Submitted');
      expect(events.length).toBe(1);
      expect(events[0].properties.timeToFirstPromptMs).toBe(2000);
      expect(events[0].properties.promptLength).toBe(5);
    });

    it('should fire Agent Response Received on completion', function promptCompleted() {
      JourneyTracker.start({});
      nowValue = 2000;
      JourneyTracker.current()!.trackPromptStarted('p1', 'test');
      nowValue = 5000;
      JourneyTracker.current()!.trackPromptCompleted('p1', { success: true });

      const events = eventsByName('Agent Response Received');
      expect(events.length).toBe(1);
      expect(events[0].properties.promptId).toBe('p1');
      expect(events[0].properties.waitTimeMs).toBe(3000);
      expect(events[0].properties.success).toBe(true);
    });

    it('should fire First Agent Response Received once on first successful completion', function firstResponse() {
      JourneyTracker.start({});
      JourneyTracker.current()!.setPage('/develop/123');
      nowValue = 2000;
      JourneyTracker.current()!.trackPromptStarted('p1', 'test');
      nowValue = 5000;
      JourneyTracker.current()!.trackPromptCompleted('p1', { success: true });

      nowValue = 6000;
      JourneyTracker.current()!.trackPromptStarted('p2', 'second');
      nowValue = 8000;
      JourneyTracker.current()!.trackPromptCompleted('p2', { success: true });

      const events = eventsByName('First Agent Response Received');
      expect(events.length).toBe(1);
      expect(events[0].properties.timeToFirstResponseMs).toBe(4000);
      expect(events[0].properties.waitTimeMs).toBe(3000);
      expect(events[0].properties.page).toBe('/develop/123');
    });

    it('should not fire First Agent Response Received on failed completion', function noFirstOnFailure() {
      JourneyTracker.start({});
      nowValue = 2000;
      JourneyTracker.current()!.trackPromptStarted('p1', 'test');
      nowValue = 4000;
      JourneyTracker.current()!.trackPromptCompleted('p1', { success: false, errorType: 'BUDGET_EXCEEDED' });

      expect(eventsByName('First Agent Response Received').length).toBe(0);
    });

    it('should fire Slow Agent Response for responses over 15s', function slowResponse() {
      JourneyTracker.start({});
      JourneyTracker.current()!.setPage('/develop/123');
      nowValue = 2000;
      JourneyTracker.current()!.trackPromptStarted('p1', 'test');
      nowValue = 18000;
      JourneyTracker.current()!.trackPromptCompleted('p1', { success: true });

      const events = eventsByName('Slow Agent Response');
      expect(events.length).toBe(1);
      expect(events[0].properties.promptId).toBe('p1');
      expect(events[0].properties.waitTimeMs).toBe(16000);
      expect(events[0].properties.page).toBe('/develop/123');
    });

    it('should not fire Slow Agent Response for fast responses', function fastResponse() {
      JourneyTracker.start({});
      nowValue = 2000;
      JourneyTracker.current()!.trackPromptStarted('p1', 'test');
      nowValue = 4000;
      JourneyTracker.current()!.trackPromptCompleted('p1', { success: true });

      expect(eventsByName('Slow Agent Response').length).toBe(0);
    });

    it('should include error metadata on failed completion', function failedPrompt() {
      JourneyTracker.start({});
      nowValue = 2000;
      JourneyTracker.current()!.trackPromptStarted('p1', 'test');
      nowValue = 4000;
      JourneyTracker.current()!.trackPromptCompleted('p1', {
        success: false,
        errorType: 'BUDGET_EXCEEDED',
      });

      const events = eventsByName('Agent Response Received');
      expect(events[0].properties.success).toBe(false);
      expect(events[0].properties.errorType).toBe('BUDGET_EXCEEDED');
    });

    it('should not fire when completing unknown promptId', function unknownPrompt() {
      JourneyTracker.start({});
      JourneyTracker.current()!.trackPromptCompleted('nonexistent', { success: true });
      expect(eventsByName('Agent Response Received').length).toBe(0);
    });
  });

  describe('#completeActivePrompt', function activePromptTests() {
    it('should complete the most recently started prompt', function completeActive() {
      JourneyTracker.start({});
      nowValue = 2000;
      JourneyTracker.current()!.trackPromptStarted('p1', 'test');
      nowValue = 4000;
      JourneyTracker.current()!.completeActivePrompt({ success: true });

      const events = eventsByName('Agent Response Received');
      expect(events.length).toBe(1);
      expect(events[0].properties.promptId).toBe('p1');
      expect(events[0].properties.waitTimeMs).toBe(2000);
    });

    it('should do nothing when no prompt is active', function noActivePrompt() {
      JourneyTracker.start({});
      JourneyTracker.current()!.completeActivePrompt({ success: true });
      expect(eventsByName('Agent Response Received').length).toBe(0);
    });
  });

  describe('#milestone tracking', function milestoneTests() {
    it('should fire Journey Milestone with timing from session start', function milestone() {
      JourneyTracker.start({});
      nowValue = 3000;
      JourneyTracker.current()!.trackMilestone('onboarding_started', { appId: 'app-1' });

      const events = eventsByName('Journey Milestone');
      expect(events.length).toBe(1);
      expect(events[0].properties.milestone).toBe('onboarding_started');
      expect(events[0].properties.timeFromSessionStartMs).toBe(2000);
      expect(events[0].properties.appId).toBe('app-1');
    });

    it('should track time between consecutive milestones', function betweenMilestones() {
      JourneyTracker.start({});
      nowValue = 3000;
      JourneyTracker.current()!.trackMilestone('first');
      nowValue = 8000;
      JourneyTracker.current()!.trackMilestone('second');

      const events = eventsByName('Journey Milestone');
      expect(events[0].properties.timeFromLastMilestoneMs).toBe(2000);
      expect(events[1].properties.timeFromLastMilestoneMs).toBe(5000);
    });
  });

  describe('#custom timers', function timerTests() {
    it('should track duration of timed operations', function timedOp() {
      JourneyTracker.start({});
      nowValue = 2000;
      JourneyTracker.current()!.startTimer('load');
      nowValue = 5000;
      JourneyTracker.current()!.endTimer('load', 'Data Loaded', { source: 'api' });

      const events = trackEventCalls().filter((e) => e.name === 'Data Loaded');
      expect(events.length).toBe(1);
      expect(events[0].properties.durationMs).toBe(3000);
      expect(events[0].properties.source).toBe('api');
    });

    it('should ignore endTimer without matching start', function noStart() {
      JourneyTracker.start({});
      JourneyTracker.current()!.endTimer('unknown', 'Never Started');
      expect(trackEventCalls().filter((e) => e.name === 'Never Started').length).toBe(0);
    });
  });

  describe('#metadata', function metadataTests() {
    it('should not throw when setting metadata without instance', function noThrow() {
      expect(() => JourneyTracker.setCustomerId('cust-1')).not.toThrow();
      expect(() => JourneyTracker.setAppId('app-1')).not.toThrow();
    });
  });

  describe('#error resilience', function resilienceTests() {
    it('should not throw when FullStory is not initialized', function noThrowFS() {
      mockFullStory.mockImplementation(() => { throw new Error('not initialized'); });
      JourneyTracker.start({});
      expect(() => JourneyTracker.current()!.trackPromptStarted('p1', 'test')).not.toThrow();
      expect(() => JourneyTracker.current()!.trackMilestone('test')).not.toThrow();
      expect(() => JourneyTracker.current()!.startTimer('t1')).not.toThrow();
      expect(() => JourneyTracker.current()!.endTimer('t1', 'Test')).not.toThrow();
    });
  });
});
