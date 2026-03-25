import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CollapsibleCardBody } from './CollapsibleCardBody';

describe('CollapsibleCardBody', function collapsibleCardBodyTests() {
  describe('expanded state', function expandedTests() {
    it('should apply 1fr grid-template-rows when expanded', function gridRowExpanded() {
      const { container } = render(
        <CollapsibleCardBody isExpanded={true}>
          <p>Content</p>
        </CollapsibleCardBody>
      );
      const outer = container.firstChild as HTMLElement;
      expect(outer.className).toContain('[grid-template-rows:1fr]');
      expect(outer.className).not.toContain('[grid-template-rows:0fr]');
    });

    it('should not set aria-hidden when expanded', function noAriaHiddenExpanded() {
      render(
        <CollapsibleCardBody isExpanded={true}>
          <p>Content</p>
        </CollapsibleCardBody>
      );
      const inner = screen.getByText('Content').parentElement?.parentElement;
      expect(inner).not.toHaveAttribute('aria-hidden');
    });

    it('should not set inert when expanded', function noInertExpanded() {
      render(
        <CollapsibleCardBody isExpanded={true}>
          <p>Content</p>
        </CollapsibleCardBody>
      );
      const inner = screen.getByText('Content').parentElement?.parentElement;
      expect(inner).not.toHaveAttribute('inert');
    });

    it('should apply opacity-100 when expanded', function opacityExpanded() {
      render(
        <CollapsibleCardBody isExpanded={true}>
          <p>Content</p>
        </CollapsibleCardBody>
      );
      const opacityDiv = screen.getByText('Content').parentElement as HTMLElement;
      expect(opacityDiv.className).toContain('opacity-100');
      expect(opacityDiv.className).not.toContain('opacity-0');
    });
  });

  describe('collapsed state', function collapsedTests() {
    it('should apply 0fr grid-template-rows when collapsed', function gridRowCollapsed() {
      const { container } = render(
        <CollapsibleCardBody isExpanded={false}>
          <p>Content</p>
        </CollapsibleCardBody>
      );
      const outer = container.firstChild as HTMLElement;
      expect(outer.className).toContain('[grid-template-rows:0fr]');
      expect(outer.className).not.toContain('[grid-template-rows:1fr]');
    });

    it('should set aria-hidden when collapsed', function ariaHiddenCollapsed() {
      render(
        <CollapsibleCardBody isExpanded={false}>
          <p>Content</p>
        </CollapsibleCardBody>
      );
      const inner = screen.getByText('Content').parentElement?.parentElement;
      expect(inner).toHaveAttribute('aria-hidden', 'true');
    });

    it('should set inert when collapsed', function inertCollapsed() {
      render(
        <CollapsibleCardBody isExpanded={false}>
          <p>Content</p>
        </CollapsibleCardBody>
      );
      const inner = screen.getByText('Content').parentElement?.parentElement;
      expect(inner).toHaveAttribute('inert');
    });

    it('should apply opacity-0 when collapsed', function opacityCollapsed() {
      render(
        <CollapsibleCardBody isExpanded={false}>
          <p>Content</p>
        </CollapsibleCardBody>
      );
      const opacityDiv = screen.getByText('Content').parentElement as HTMLElement;
      expect(opacityDiv.className).toContain('opacity-0');
      expect(opacityDiv.className).not.toContain('opacity-100');
    });
  });

  it('should render children', function rendersChildren() {
    render(
      <CollapsibleCardBody isExpanded={true}>
        <p>Test content</p>
      </CollapsibleCardBody>
    );
    expect(screen.getByText('Test content')).toBeInTheDocument();
  });
});
