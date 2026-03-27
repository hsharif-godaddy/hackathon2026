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
} from './instrumentation';

// Mock the logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { logger } from '@/lib/request-context';

describe('instrumentation utilities', () => {
  let mockDataLayer: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDataLayer = [];
    global.window = {
      _expDataLayer: mockDataLayer,
    } as any;
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
        },
        targets: ['fullstory'],
      });
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
      global.window._expDataLayer = undefined as any;
      const logClick = logClickEvent('product.section.widget');
      logClick();
      // Should not throw error
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
          },
        },
        targets: ['fullstory'],
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
      // Should not throw error
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle undefined window in logActionEvent', () => {
      global.window = undefined as any;
      const logAction = logActionEvent({ eid: 'product.section.widget', action: 'hover' });
      logAction();
      // Should not throw error
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle undefined window in logImpressionEvent', () => {
      global.window = undefined as any;
      const logImpression = logImpressionEvent('product.section.widget');
      logImpression();
      // Should not throw error
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
