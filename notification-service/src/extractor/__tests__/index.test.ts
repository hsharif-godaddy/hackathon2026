import { describe, expect, it } from 'vitest';

import { extract } from '../index.js';

const VALID = {
  detail: {
    global: { context: { customerId: 'cust-1' } },
    event: {
      data: {
        traffic: {
          eid: 'app.published',
          customProperties: { appId: 'app-1' },
        },
      },
    },
  },
};

describe('notification-service', () => {
  describe('#extract', () => {
    it('returns extracted fields for a complete payload', () => {
      expect(extract(VALID)).toEqual({ eid: 'app.published', customerId: 'cust-1', appId: 'app-1' });
    });

    it('returns null for null', () => {
      expect(extract(null)).toBeNull();
    });

    it('returns null for a primitive', () => {
      expect(extract('string')).toBeNull();
      expect(extract(42)).toBeNull();
    });

    it('returns null when detail is missing', () => {
      expect(extract({})).toBeNull();
    });

    it('returns null when eid is missing', () => {
      const payload = structuredClone(VALID);
      delete (payload.detail.event.data.traffic as Record<string, unknown>).eid;
      expect(extract(payload)).toBeNull();
    });

    it('returns null when customerId is missing', () => {
      const payload = structuredClone(VALID);
      delete (payload.detail.global.context as Record<string, unknown>).customerId;
      expect(extract(payload)).toBeNull();
    });

    it('returns null when appId is missing', () => {
      const payload = structuredClone(VALID);
      delete (payload.detail.event.data.traffic.customProperties as Record<string, unknown>).appId;
      expect(extract(payload)).toBeNull();
    });
  });
});
