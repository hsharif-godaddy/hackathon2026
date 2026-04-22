/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { renderWithProviders } from '@/tests/test-utils';
import CommerceToolRenderer from '../CommerceToolRenderer';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/toolNameMapping', () => ({
  getToolDisplayName: (name: string) => name,
}));

vi.mock('@/app/[market]/develop/components/tool-renderers/ToolHeader', () => ({
  default: ({ displayName, onOpenModal, toolStatus }: any) => (
    <div data-testid="tool-header" data-status={toolStatus}>
      <button data-testid="open-modal" onClick={onOpenModal}>{displayName}</button>
    </div>
  ),
}));

vi.mock('@/app/[market]/develop/components/tool-renderers/ToolModal', () => ({
  default: ({ isOpen, children, title }: any) =>
    isOpen ? <div data-testid="tool-modal" data-title={title}>{children}</div> : null,
}));

describe('CommerceToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseProps = {
    toolName: 'commerce__setup_store',
    toolId: 'tool-1',
    conversationId: 'conv-1',
    size: 'regular' as const,
  };

  describe('parseResult', () => {
    it('should show success for { success: true, data: {...} }', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CommerceToolRenderer
          {...baseProps}
          toolStatus="completed"
          result={{ success: true, data: { storeId: 'store-1' } }}
        />
      );

      await user.click(screen.getByTestId('open-modal'));
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('should show error for { success: false, error: "..." }', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CommerceToolRenderer
          {...baseProps}
          toolStatus="completed"
          result={{ success: false, error: 'Store creation failed' }}
        />
      );

      await user.click(screen.getByTestId('open-modal'));
      expect(screen.getByText('Store creation failed')).toBeInTheDocument();
    });

    it('should show auth state for { needsAuth: true }', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CommerceToolRenderer
          {...baseProps}
          toolStatus="completed"
          result={{ needsAuth: true, redirectUrl: 'https://auth.example.com', state: 'abc', scopes: [] }}
        />
      );

      await user.click(screen.getByTestId('open-modal'));
      expect(screen.getByText('Authentication required')).toBeInTheDocument();
    });

    it('should show info state for needsInfo wrapped in withCommerceAuth envelope', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CommerceToolRenderer
          {...baseProps}
          toolStatus="completed"
          result={{ success: true, data: { needsInfo: true, message: 'Please provide your name and email' } }}
        />
      );

      await user.click(screen.getByTestId('open-modal'));
      expect(screen.getByText('Please provide your name and email')).toBeInTheDocument();
    });

    it('should fallback to Completed for unknown result shape', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CommerceToolRenderer
          {...baseProps}
          toolStatus="completed"
          result={{ someUnknownField: true }}
        />
      );

      await user.click(screen.getByTestId('open-modal'));
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });
  });

  describe('arguments filtering', () => {
    it('should hide internal ID fields from arguments', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CommerceToolRenderer
          {...baseProps}
          toolStatus="completed"
          result={{ success: true, data: {} }}
          input={{ storeId: 'secret-id', storeName: 'My Store', action: 'createProduct' }}
        />
      );

      await user.click(screen.getByTestId('open-modal'));
      expect(screen.queryByText('secret-id')).not.toBeInTheDocument();
      expect(screen.getByText('My Store')).toBeInTheDocument();
      expect(screen.getByText('createProduct')).toBeInTheDocument();
    });

    it('should hide object/array values from arguments', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CommerceToolRenderer
          {...baseProps}
          toolStatus="completed"
          result={{ success: true, data: {} }}
          input={{ label: 'Product', attributes: [{ name: 'size' }], type: 'PHYSICAL' }}
        />
      );

      await user.click(screen.getByTestId('open-modal'));
      expect(screen.getByText('Product')).toBeInTheDocument();
      expect(screen.getByText('PHYSICAL')).toBeInTheDocument();
      // attributes is an array → should be hidden
      expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
    });
  });

  describe('AI SDK error', () => {
    it('should show error prop in red section', async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <CommerceToolRenderer
          {...baseProps}
          toolStatus="error"
          error="Maximum call stack size exceeded"
        />
      );

      await user.click(screen.getByTestId('open-modal'));
      expect(screen.getByText('Maximum call stack size exceeded')).toBeInTheDocument();
    });
  });
});
