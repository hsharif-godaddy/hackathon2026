import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react';

import { addRumLabels, startRumTransaction, useRumAppContext } from './useRumAppContext';

describe('useRumAppContext', function rumAppContextTests() {
  const mockAddLabels = vi.fn();
  const mockSetCustomContext = vi.fn();
  const mockStartTransaction = vi.fn();
  const mockEnd = vi.fn();

  beforeEach(function setup() {
    vi.clearAllMocks();

    // Mock the global window.__apmInstance
    (window as any).__apmInstance = {
      addLabels: mockAddLabels,
      setCustomContext: mockSetCustomContext,
      startTransaction: mockStartTransaction,
      isActive: () => true,
    };
  });

  afterEach(function cleanup() {
    delete (window as any).__apmInstance;
  });

  describe('#useRumAppContext', function hookTests() {
    it('should add labels when appId is provided', function addLabelsWithAppId() {
      renderHook(() => useRumAppContext({ appId: 'test-app-123' }));

      expect(mockAddLabels).toHaveBeenCalledWith({ appId: 'test-app-123' });
      expect(mockSetCustomContext).toHaveBeenCalledWith({ appId: 'test-app-123' });
    });

    it('should add labels when customerId is provided', function addLabelsWithCustomerId() {
      renderHook(() => useRumAppContext({ customerId: 'customer-456' }));

      expect(mockAddLabels).toHaveBeenCalledWith({ customerId: 'customer-456' });
      expect(mockSetCustomContext).toHaveBeenCalledWith({ customerId: 'customer-456' });
    });

    it('should add both labels when appId and customerId are provided', function addBothLabels() {
      renderHook(() => useRumAppContext({
        appId: 'test-app-123',
        customerId: 'customer-456',
      }));

      expect(mockAddLabels).toHaveBeenCalledWith({
        appId: 'test-app-123',
        customerId: 'customer-456',
      });
      expect(mockSetCustomContext).toHaveBeenCalledWith({
        appId: 'test-app-123',
        customerId: 'customer-456',
      });
    });

    it('should not add labels when both values are null', function noLabelsWhenNull() {
      renderHook(() => useRumAppContext({ appId: null, customerId: null }));

      expect(mockAddLabels).not.toHaveBeenCalled();
      expect(mockSetCustomContext).not.toHaveBeenCalled();
    });

    it('should not add labels when both values are undefined', function noLabelsWhenUndefined() {
      renderHook(() => useRumAppContext({}));

      expect(mockAddLabels).not.toHaveBeenCalled();
      expect(mockSetCustomContext).not.toHaveBeenCalled();
    });

    it('should handle missing APM instance gracefully', function noApmInstance() {
      delete (window as any).__apmInstance;

      // Should not throw
      expect(() => {
        renderHook(() => useRumAppContext({ appId: 'test-app' }));
      }).not.toThrow();

      expect(mockAddLabels).not.toHaveBeenCalled();
    });

    it('should update labels when values change', function updateLabels() {
      const { rerender } = renderHook(
        ({ appId, customerId }) => useRumAppContext({ appId, customerId }),
        { initialProps: { appId: 'app-1', customerId: 'customer-1' } }
      );

      expect(mockAddLabels).toHaveBeenCalledTimes(1);
      expect(mockAddLabels).toHaveBeenLastCalledWith({
        appId: 'app-1',
        customerId: 'customer-1',
      });

      // Update with new values
      rerender({ appId: 'app-2', customerId: 'customer-2' });

      expect(mockAddLabels).toHaveBeenCalledTimes(2);
      expect(mockAddLabels).toHaveBeenLastCalledWith({
        appId: 'app-2',
        customerId: 'customer-2',
      });
    });

    it('should not re-run effect when values are the same', function noRerenderSameValues() {
      const { rerender } = renderHook(
        ({ appId }) => useRumAppContext({ appId }),
        { initialProps: { appId: 'same-app' } }
      );

      expect(mockAddLabels).toHaveBeenCalledTimes(1);

      // Rerender with same value
      rerender({ appId: 'same-app' });

      // Effect should not run again
      expect(mockAddLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe('#addRumLabels', function addLabelsTests() {
    it('should add labels to current transaction', function addLabels() {
      addRumLabels({ action: 'save', count: 5, enabled: true });

      expect(mockAddLabels).toHaveBeenCalledWith({
        action: 'save',
        count: 5,
        enabled: true,
      });
    });

    it('should handle missing APM instance gracefully', function noApmInstance() {
      delete (window as any).__apmInstance;

      // Should not throw
      expect(() => addRumLabels({ action: 'test' })).not.toThrow();
      expect(mockAddLabels).not.toHaveBeenCalled();
    });
  });

  describe('#startRumTransaction', function transactionTests() {
    beforeEach(function setupTransaction() {
      mockStartTransaction.mockReturnValue({
        name: 'test-transaction',
        type: 'custom',
        end: mockEnd,
        addLabels: mockAddLabels,
      });
    });

    it('should start a transaction with name and type', function startTransaction() {
      const transaction = startRumTransaction('checkout-flow', 'user-interaction');

      expect(mockStartTransaction).toHaveBeenCalledWith('checkout-flow', 'user-interaction');
      expect(transaction).not.toBeNull();
      expect(transaction?.name).toBe('test-transaction');
    });

    it('should return transaction with working methods', function transactionMethods() {
      const transaction = startRumTransaction('test', 'custom');

      transaction?.addLabels({ step: 1 });
      transaction?.end();

      expect(mockAddLabels).toHaveBeenCalledWith({ step: 1 });
      expect(mockEnd).toHaveBeenCalled();
    });

    it('should return null when APM instance is unavailable', function noApmInstance() {
      delete (window as any).__apmInstance;

      const transaction = startRumTransaction('test', 'custom');

      expect(transaction).toBeNull();
      expect(mockStartTransaction).not.toHaveBeenCalled();
    });
  });
});
