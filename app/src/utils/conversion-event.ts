import { logger } from '@/lib/request-context';

declare global {
  interface Window {
    _signalsDataLayer?: unknown[];
  }
}

interface ConversionEventParams {
  orderId?: string;
}

export const fireConversionEvent = ({ orderId }: ConversionEventParams = {}): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (!window._signalsDataLayer) {
      window._signalsDataLayer = [];
    }

    const eventData: Record<string, unknown> = {
      schema: 'add_generic_conversion',
      data: {
        eventCreationTimestamp: new Date().toISOString(),
        conversion: {
          area: 'airo-builder',
          revenue: 'freetrial',
          product: 'airo-builder-freemium',
          action: 'signup',
        },
        ...(orderId ? { virtualOrderId: orderId } : {}),
      },
    };

    window._signalsDataLayer.push(eventData);
  } catch (e) {
    logger.error('conversion.event.failure', { error: e instanceof Error ? e.message : String(e) });
  }
};
