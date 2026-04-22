import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * @vitest-environment jsdom
 */
import {
  generateClickEID,
  logActionEvent,
  logAiroHQEvent,
  logClickEvent,
  logImpressionEvent,
  parseEID,
  setInstrumentationAppId,
} from './instrumentation';

// Mock the logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { logger } from '@/lib/request-context';

/** Valid nanoid-style app IDs (see `INSTRUMENTATION_APP_ID_PATTERN` in instrumentation.ts). */
const VALID_APP_ID_1 = 'testap1234';
const VALID_APP_ID_2 = 'testap4567';
const VALID_APP_ID_3 = 'routap1234';
const VALID_APP_ID_4 = 'action7890';
const VALID_APP_ID_5 = 'mergeapp32';
const VALID_APP_ID_6 = 'impress999';
const VALID_APP_ID_7 = 'mergimpr11';
const VALID_APP_ID_8 = 'diffrent12';
const VALID_APP_ID_9 = 'persist123';
const VALID_APP_ID_10 = 'validap123';
const VALID_APP_ID_11 = 'currnt1234';
const VALID_APP_ID_12 = 'callr78901';
const VALID_APP_ID_13 = 'sameap1234';
const VALID_APP_ID_14 = 'server1234';

describe('instrumentation utilities', () => {
  let mockDataLayer: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDataLayer = [];
    global.window = {
      _expDataLayer: mockDataLayer,
    } as any;
    // Clear any stored appId between tests
    setInstrumentationAppId(null);
  });

  describe('parseEID', () => {
    it('should parse valid EID with three parts', () => {
      const result = parseEID('product.section.widget');
      expect(result).toEqual({
        product: 'product',
        section: 'section',
        widget: 'widget',
      });
    });

    it('should handle hyphens in parts', () => {
      const result = parseEID('my-product.my-section.my-widget');
      expect(result).toEqual({
        product: 'my-product',
        section: 'my-section',
        widget: 'my-widget',
      });
    });

    it('should return empty strings for missing EID', () => {
      const result = parseEID('');
      expect(result).toEqual({ product: '', section: '', widget: '' });
      expect(logger.warn).toHaveBeenCalledWith(
        'instrumentation.parseEID.failure',
        expect.objectContaining({
          message: expect.stringContaining('missing attributes'),
        })
      );
    });

    it('should return empty strings for invalid EID with too few dots', () => {
      const result = parseEID('product.section');
      expect(result).toEqual({ product: '', section: '', widget: '' });
      expect(logger.warn).toHaveBeenCalledWith(
        'instrumentation.parseEID.failure',
        expect.objectContaining({
          message: 'parseEID is invalid',
        })
      );
    });

    it('should return empty strings for invalid EID with too many dots', () => {
      const result = parseEID('product.section.widget.extra');
      expect(result).toEqual({ product: '', section: '', widget: '' });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle single dot', () => {
      const result = parseEID('product.section');
      expect(result).toEqual({ product: '', section: '', widget: '' });
    });
  });

  describe('generateClickEID', () => {
    it('should generate valid click EID', () => {
      const result = generateClickEID('product.section.widget');
      expect(result).toBe('appbuilder.product.section.widget.click');
    });

    it('should handle hyphens in EID parts', () => {
      const result = generateClickEID('my-product.my-section.my-widget');
      expect(result).toBe('appbuilder.my-product.my-section.my-widget.click');
    });

    it('should return empty string for invalid EID', () => {
      const result = generateClickEID('invalid');
      expect(result).toBe('');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should return empty string for empty EID', () => {
      const result = generateClickEID('');
      expect(result).toBe('');
    });

    it('should log warn for missing attributes', () => {
      generateClickEID('invalid.eid');
      expect(logger.warn).toHaveBeenCalledWith(
        'instrumentation.generateClickEID.failure',
        expect.objectContaining({
          message: 'generateClickEID is missing attributes',
        })
      );
    });
  });

  describe('logClickEvent', () => {
    it('should push click event to data layer', () => {
      const logClick = logClickEvent('product.section.widget');
      logClick();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0]).toEqual({
        schema: 'add_click',
        data: {
          element: {
            area: 'appbuilder',
            product: 'product',
            section: 'section',
            widget: 'widget',
          },
          traffic: {
            eid: 'appbuilder.product.section.widget.click',
            customProperties: {},
          },
        },
        targets: ['fullstory'],
      });
    });

    it('should include custom_properties when provided', () => {
      const logClick = logClickEvent('product.section.widget', { userId: 'test123' });
      logClick();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0]).toEqual({
        schema: 'add_click',
        data: {
          element: {
            area: 'appbuilder',
            product: 'product',
            section: 'section',
            widget: 'widget',
          },
          traffic: {
            eid: 'appbuilder.product.section.widget.click',
            customProperties: {
              userId: 'test123',
            },
          },
        },
        targets: ['fullstory'],
      });
    });

    it('should automatically add appId when appId is set', () => {
      setInstrumentationAppId(VALID_APP_ID_1);

      const logClick = logClickEvent('product.section.widget');
      logClick();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.traffic?.customProperties).toEqual({
        appId: VALID_APP_ID_1,
      });
    });

    it('should merge custom_properties with appId when appId is set', () => {
      setInstrumentationAppId(VALID_APP_ID_2);

      const logClick = logClickEvent('product.section.widget', { userId: 'user789' });
      logClick();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.traffic?.customProperties).toEqual({
        userId: 'user789',
        appId: VALID_APP_ID_2,
      });
    });

    it('should not include appId when appId is not set', () => {
      // appId is null by default (set in beforeEach)
      const logClick = logClickEvent('product.section.widget', { userId: 'user789' });
      logClick();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.traffic?.customProperties).toEqual({
        userId: 'user789',
      });
    });

    it('should include appId from custom_properties when module appId is unset', () => {
      const logClick = logClickEvent('product.section.widget', { appId: VALID_APP_ID_3 });
      logClick();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.traffic?.customProperties).toEqual({
        appId: VALID_APP_ID_3,
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should omit appId from custom_properties when id is too short for bounds', () => {
      const logClick = logClickEvent('product.section.widget', { appId: 'short' });
      logClick();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.traffic?.customProperties).toEqual({});
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should accept longer nanoid-style app IDs in custom_properties', () => {
      const id21 = 'V1StGXR8_Z5jdHi6B-my';
      const logClick = logClickEvent('product.section.widget', { appId: id21 });
      logClick();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.traffic?.customProperties).toEqual({ appId: id21 });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle hyphens in event ID', () => {
      const logClick = logClickEvent('my-product.my-section.my-widget');
      logClick();

      expect(mockDataLayer[0].data.element.product).toBe('my-product');
      expect(mockDataLayer[0].data.element.section).toBe('my-section');
      expect(mockDataLayer[0].data.element.widget).toBe('my-widget');
    });

    it('should not push event for invalid EID', () => {
      const logClick = logClickEvent('invalid');
      logClick();

      expect(mockDataLayer).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not push event for empty EID', () => {
      const logClick = logClickEvent('');
      logClick();

      expect(mockDataLayer).toHaveLength(0);
    });

    it('should return a function', () => {
      const logClick = logClickEvent('product.section.widget');
      expect(typeof logClick).toBe('function');
    });

    it('should handle missing data layer', () => {
      // Set up a proper window mock with location but no _expDataLayer
      global.window = {
        location: { pathname: '/apps' },
        _expDataLayer: undefined
      } as any;
      const logClick = logClickEvent('product.section.widget');
      logClick();
      // Should not throw error and should not log warnings for the click itself
      expect(logger.warn).not.toHaveBeenCalled();
    });

  });

  describe('logActionEvent', () => {
    it('should push hover action event to data layer', () => {
      const logAction = logActionEvent({ eid: 'product.section.widget', action: 'hover' });
      logAction();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0]).toEqual({
        schema: 'add_element_action',
        data: {
          element: {
            area: 'appbuilder',
            product: 'product',
            section: 'section',
            widget: 'widget',
            action: 'hover',
          },
          custom_properties: {},
        },
        targets: ['fullstory'],
      });
    });

    it('should include custom_properties when provided', () => {
      const logAction = logActionEvent({
        eid: 'product.section.widget',
        action: 'hover',
        customProperties: { sessionId: 'abc123' }
      });
      logAction();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0]).toEqual({
        schema: 'add_element_action',
        data: {
          element: {
            area: 'appbuilder',
            product: 'product',
            section: 'section',
            widget: 'widget',
            action: 'hover',
          },
          custom_properties: {
            sessionId: 'abc123',
          },
        },
        targets: ['fullstory'],
      });
    });

    it('should automatically add appId when appId is set', () => {
      setInstrumentationAppId(VALID_APP_ID_4);

      const logAction = logActionEvent({ eid: 'product.section.widget', action: 'focus' });
      logAction();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.custom_properties).toEqual({
        appId: VALID_APP_ID_4,
      });
    });

    it('should merge custom_properties with appId when appId is set', () => {
      setInstrumentationAppId(VALID_APP_ID_5);

      const logAction = logActionEvent({ 
        eid: 'product.section.widget', 
        action: 'scroll', 
        customProperties: { trackingId: 'track456' }
      });
      logAction();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.custom_properties).toEqual({
        trackingId: 'track456',
        appId: VALID_APP_ID_5,
      });
    });

    it('should handle focus action', () => {
      const logAction = logActionEvent({ eid: 'product.section.widget', action: 'focus' });
      logAction();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].schema).toBe('add_element_action');
    });

    it('should handle blur action', () => {
      const logAction = logActionEvent({ eid: 'product.section.widget', action: 'blur' });
      logAction();

      expect(mockDataLayer).toHaveLength(1);
    });

    it('should handle scroll action', () => {
      const logAction = logActionEvent({ eid: 'product.section.widget', action: 'scroll' });
      logAction();

      expect(mockDataLayer).toHaveLength(1);
    });

    it('should not push event without action', () => {
      const logAction = logActionEvent({ eid: 'product.section.widget' } as any);
      logAction();

      expect(mockDataLayer).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not push event for invalid EID', () => {
      const logAction = logActionEvent({ eid: 'invalid', action: 'hover' });
      logAction();

      expect(mockDataLayer).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not include appId when appId is not set', () => {
      // appId is null by default (set in beforeEach)
      const logAction = logActionEvent({ 
        eid: 'product.section.widget', 
        action: 'hover', 
        customProperties: { userId: 'user789' }
      });
      logAction();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.custom_properties).toEqual({
        userId: 'user789',
      });
    });

    it('should return a function', () => {
      const logAction = logActionEvent({ eid: 'product.section.widget', action: 'hover' });
      expect(typeof logAction).toBe('function');
    });
  });

  describe('logImpressionEvent', () => {
    it('should push impression event to data layer', () => {
      const logImpression = logImpressionEvent('product.section.widget');
      logImpression();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0]).toEqual({
        schema: 'add_impression',
        targets: ['fullstory'],
        version: 'v2',
        data: {
          eid: 'appbuilder.product.section.widget.impression',
          type: 'impression',
          custom_properties: {},
        },
      });
    });

    it('should handle hyphens in event ID', () => {
      const logImpression = logImpressionEvent('my-product.my-section.my-widget');
      logImpression();

      expect(mockDataLayer[0].data.eid).toBe('appbuilder.my-product.my-section.my-widget.impression');
    });

    it('should not push event for invalid EID', () => {
      const logImpression = logImpressionEvent('invalid');
      logImpression();

      expect(mockDataLayer).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not push event for empty EID', () => {
      const logImpression = logImpressionEvent('');
      logImpression();

      expect(mockDataLayer).toHaveLength(0);
    });

    it('should return a function', () => {
      const logImpression = logImpressionEvent('product.section.widget');
      expect(typeof logImpression).toBe('function');
    });

    it('should include custom_properties when provided', () => {
      const logImpression = logImpressionEvent('chat.budgetExceeded.view', {
        hasPublishedApp: true,
        hasCustomDomain: false,
      });
      logImpression();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.eid).toBe('appbuilder.chat.budgetExceeded.view.impression');
      expect(mockDataLayer[0].data.custom_properties).toEqual({
        hasPublishedApp: true,
        hasCustomDomain: false,
      });
    });

    it('should automatically add appId when appId is set', () => {
      setInstrumentationAppId(VALID_APP_ID_6);

      const logImpression = logImpressionEvent('chat.banner.view');
      logImpression();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.custom_properties).toEqual({
        appId: VALID_APP_ID_6,
      });
    });

    it('should merge custom_properties with appId when appId is set', () => {
      setInstrumentationAppId(VALID_APP_ID_7);

      const logImpression = logImpressionEvent('chat.modal.view', {
        modalType: 'upgrade',
        userTier: 'free',
      });
      logImpression();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.custom_properties).toEqual({
        modalType: 'upgrade',
        userTier: 'free',
        appId: VALID_APP_ID_7,
      });
    });

    it('should not include appId when appId is not set', () => {
      // appId is null by default (set in beforeEach)
      const logImpression = logImpressionEvent('apps.page.view', { pageNumber: 1 });
      logImpression();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.custom_properties).toEqual({
        pageNumber: 1,
      });
    });
  });

  describe('logAiroHQEvent', () => {
    it('should push Airo HQ click event to data layer', () => {
      const logEvent = logAiroHQEvent({
        category: 'click',
        ai_agent_id: 'test-agent',
        agent_conversation_id: 'conv-123',
        recommendation_id: 'rec-456',
        recommendation_task: 'test-task',
        recommendation_type: 'test-type',
        ventureID: 'venture-789',
      });
      logEvent();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0]).toEqual({
        schema: 'add_event',
        targets: ['fullstory'],
        version: 'v2',
        data: {
          eid: 'airohq.agent.page.component.click',
          type: 'click',
          custom_properties: {
            ai_agent_id: 'test-agent',
            agent_conversation_id: 'conv-123',
            recommendation_id: 'rec-456',
            recommendation_task: 'test-task',
            recommendation_type: 'test-type',
            ventureID: 'venture-789',
          },
        },
      });
    });

    it('should push Airo HQ impression event to data layer', () => {
      const logEvent = logAiroHQEvent({
        category: 'impression',
        recommendation_task: 'test-task',
      });
      logEvent();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].schema).toBe('add_impression');
      expect(mockDataLayer[0].data.type).toBe('impression');
      expect(mockDataLayer[0].data.eid).toBe('airohq.agent.page.component.impression');
    });

    it('should use default ai_agent_id when not provided', () => {
      const logEvent = logAiroHQEvent({
        category: 'click',
      });
      logEvent();

      expect(mockDataLayer[0].data.custom_properties.ai_agent_id).toBe('app-builder');
    });

    it('should handle completed task event', () => {
      const logEvent = logAiroHQEvent({
        category: 'click',
        completedTask: true,
      });
      logEvent();

      expect(mockDataLayer[0].data.eid).toBe('airohq.agent.page_completed.component.click');
    });

    it('should handle non-completed task event', () => {
      const logEvent = logAiroHQEvent({
        category: 'click',
        completedTask: false,
      });
      logEvent();

      expect(mockDataLayer[0].data.eid).toBe('airohq.agent.page.component.click');
    });

    it('should return a function', () => {
      const logEvent = logAiroHQEvent({
        category: 'click',
      });
      expect(typeof logEvent).toBe('function');
    });

    it('should handle undefined optional properties', () => {
      const logEvent = logAiroHQEvent({
        category: 'click',
      });
      logEvent();

      expect(mockDataLayer[0].data.custom_properties).toEqual({
        ai_agent_id: 'app-builder',
        agent_conversation_id: undefined,
        recommendation_id: undefined,
        recommendation_task: undefined,
        recommendation_type: undefined,
        ventureID: undefined,
      });
    });

    it('should handle empty strings for optional properties', () => {
      const logEvent = logAiroHQEvent({
        category: 'impression',
        ai_agent_id: '',
        agent_conversation_id: '',
        recommendation_id: '',
      });
      logEvent();

      expect(mockDataLayer[0].data.custom_properties.ai_agent_id).toBe('');
      expect(mockDataLayer[0].data.custom_properties.agent_conversation_id).toBe('');
      expect(mockDataLayer[0].data.custom_properties.recommendation_id).toBe('');
    });

    it('should handle server-side rendering gracefully', () => {
      global.window = undefined as any;

      const logEvent = logAiroHQEvent({
        category: 'impression',
        recommendation_task: 'ssr-task',
      });
      logEvent();

      // Should not push to data layer when window is undefined (same as other logging functions)
      expect(mockDataLayer).toHaveLength(0);
    });
  });

  describe('appId management', () => {
    it('should set and get appId correctly', () => {
      logClickEvent('test.section.widget')();
      expect(mockDataLayer[0].data.traffic?.customProperties?.appId).toBeUndefined();

      setInstrumentationAppId(VALID_APP_ID_1);
      logClickEvent('test.section.widget')();
      expect(mockDataLayer[1].data.traffic?.customProperties?.appId).toBe(VALID_APP_ID_1);

      setInstrumentationAppId(VALID_APP_ID_8);
      logClickEvent('test.section.widget')();
      expect(mockDataLayer[2].data.traffic?.customProperties?.appId).toBe(VALID_APP_ID_8);

      setInstrumentationAppId(null);
      logClickEvent('test.section.widget')();
      expect(mockDataLayer[3].data.traffic?.customProperties?.appId).toBeUndefined();
    });

    it('should omit UUID-style app IDs from instrumentation', () => {
      const uuidAppId = '550e8400-e29b-41d4-a716-446655440000';
      setInstrumentationAppId(uuidAppId);
      
      const logClick = logClickEvent('test.section.widget');
      logClick();

      expect(mockDataLayer[0].data.traffic?.customProperties?.appId).toBeUndefined();
    });

    it('should treat empty string appId as unset', () => {
      setInstrumentationAppId('');

      const logClick = logClickEvent('test.section.widget');
      logClick();

      expect(mockDataLayer[0].data.traffic?.customProperties?.appId).toBeUndefined();
    });

    it('should persist appId across multiple events', () => {
      setInstrumentationAppId(VALID_APP_ID_9);

      // Multiple different event types should all include the same appId
      logClickEvent('test.click.widget')();
      logActionEvent({ eid: 'test.action.widget', action: 'hover' })();
      logImpressionEvent('test.impression.widget')();

      expect(mockDataLayer).toHaveLength(3);
      expect(mockDataLayer[0].data.traffic?.customProperties?.appId).toBe(VALID_APP_ID_9);
      expect(mockDataLayer[1].data.custom_properties?.appId).toBe(VALID_APP_ID_9);
      expect(mockDataLayer[2].data.custom_properties?.appId).toBe(VALID_APP_ID_9);
    });

    it('should use module appId when customProperties appId is not exactly 10 chars', () => {
      setInstrumentationAppId(VALID_APP_ID_10);

      const uuidLike = '550e8400-e29b-41d4-a716-446655440000';
      logImpressionEvent('test.invalidCaller.widget', {
        appId: uuidLike,
        otherProp: 'kept',
      })();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.custom_properties).toEqual({
        otherProp: 'kept',
        appId: VALID_APP_ID_10,
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should warn when caller appId differs from currentAppId', () => {
      setInstrumentationAppId(VALID_APP_ID_11);

      logImpressionEvent('test.warning.widget', {
        userId: 'user456',
        appId: VALID_APP_ID_12,
      })();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.custom_properties).toEqual({
        userId: 'user456',
        appId: VALID_APP_ID_11,
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'instrumentation.mergeCustomProperties.conflict',
        expect.objectContaining({
          message: 'appId in customProperties differs from currentAppId; using currentAppId',
          callerAppId: VALID_APP_ID_12,
          currentAppId: VALID_APP_ID_11,
        })
      );
    });

    it('should not warn when caller appId matches currentAppId', () => {
      setInstrumentationAppId(VALID_APP_ID_13);

      logClickEvent('test.section.widget', { appId: VALID_APP_ID_13 })();

      expect(mockDataLayer).toHaveLength(1);
      expect(mockDataLayer[0].data.traffic?.customProperties).toEqual({ appId: VALID_APP_ID_13 });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle server-side calls gracefully', () => {
      // Mock server-side environment
      const originalWindow = global.window;
      delete (global as any).window;

      // Should not crash and should not set appId
      setInstrumentationAppId(VALID_APP_ID_14);

      // Should warn about server-side usage
      expect(logger.warn).toHaveBeenCalledWith(
        'instrumentation.setAppId.server-side',
        expect.objectContaining({
          message: 'setInstrumentationAppId called on server - this may cause cross-request state leakage',
          appId: VALID_APP_ID_14
        })
      );

      // Restore window
      global.window = originalWindow;
    });
  });

  describe('server-side rendering', () => {
    it('should handle undefined window in parseEID', () => {
      global.window = undefined as any;
      const result = parseEID('product.section.widget');
      expect(result).toEqual({
        product: 'product',
        section: 'section',
        widget: 'widget',
      });
    });

    it('should handle undefined window in logClickEvent', () => {
      global.window = undefined as any;
      const logClick = logClickEvent('product.section.widget');
      logClick();
      // Should not throw error and should not push to mockDataLayer (since window is undefined)
      expect(mockDataLayer).toHaveLength(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle undefined window in logClickEvent with custom properties', () => {
      global.window = undefined as any;
      const logClick = logClickEvent('product.section.widget', { userId: 'test' });
      logClick();
      // Should not throw error and should not push to mockDataLayer (since window is undefined)
      expect(mockDataLayer).toHaveLength(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle undefined window in logActionEvent', () => {
      global.window = undefined as any;
      const logAction = logActionEvent({ eid: 'product.section.widget', action: 'hover' });
      logAction();
      // Should not throw error and should not push to mockDataLayer (since window is undefined)
      expect(mockDataLayer).toHaveLength(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle undefined window in logActionEvent with custom properties', () => {
      global.window = undefined as any;
      const logAction = logActionEvent({ 
        eid: 'product.section.widget', 
        action: 'hover', 
        customProperties: { sessionId: 'test123' }
      });
      logAction();
      // Should not throw error and should not push to mockDataLayer (since window is undefined)
      expect(mockDataLayer).toHaveLength(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle undefined window in logImpressionEvent', () => {
      global.window = undefined as any;
      const logImpression = logImpressionEvent('product.section.widget');
      logImpression();
      // Should not throw error and should not push to mockDataLayer (since window is undefined)
      expect(mockDataLayer).toHaveLength(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle undefined window in logImpressionEvent with custom properties', () => {
      global.window = undefined as any;
      const logImpression = logImpressionEvent('product.section.widget', { feature: 'test' });
      logImpression();
      // Should not throw error and should not push to mockDataLayer (since window is undefined)
      expect(mockDataLayer).toHaveLength(0);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle undefined window in logAiroHQEvent', () => {
      global.window = undefined as any;
      const logEvent = logAiroHQEvent({ category: 'click' });
      logEvent();
      // Should not throw error
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
