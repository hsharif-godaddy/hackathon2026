/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { logger } from '@/lib/request-context';
import { fireConversionEvent } from './conversion-event';

describe('fireConversionEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window._signalsDataLayer = [];
  });

  it('pushes correct schema shape with all required fields', () => {
    fireConversionEvent();

    expect(window._signalsDataLayer).toHaveLength(1);
    const event = window._signalsDataLayer![0] as any;
    expect(event.schema).toBe('add_generic_conversion');
    expect(event.data.conversion).toEqual({
      area: 'airo-builder',
      revenue: 'freetrial',
      product: 'airo-builder-freemium',
      action: 'signup',
    });
    expect(event.data.eventCreationTimestamp).toBeDefined();
    expect(event.data.virtualOrderId).toBeUndefined();
  });

  it('includes virtualOrderId when orderId provided', () => {
    fireConversionEvent({ orderId: 'order-123' });

    const event = window._signalsDataLayer![0] as any;
    expect(event.data.virtualOrderId).toBe('order-123');
  });

  it('omits virtualOrderId when orderId not provided', () => {
    fireConversionEvent({});

    const event = window._signalsDataLayer![0] as any;
    expect(event.data).not.toHaveProperty('virtualOrderId');
  });

  it('initializes _signalsDataLayer if it does not exist', () => {
    delete (window as any)._signalsDataLayer;

    fireConversionEvent();

    expect(window._signalsDataLayer).toHaveLength(1);
  });

  it('handles SSR context (window undefined) without error', () => {
    const origWindow = globalThis.window;
    // @ts-expect-error -- simulate SSR
    delete globalThis.window;

    expect(() => fireConversionEvent()).not.toThrow();

    globalThis.window = origWindow;
  });

  it('logs error and does not throw when push fails', () => {
    const badArray = {
      push() { throw new Error('push failure'); },
    };
    window._signalsDataLayer = badArray as any;

    expect(() => fireConversionEvent()).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith('conversion.event.failure', expect.any(Object));
  });
});
