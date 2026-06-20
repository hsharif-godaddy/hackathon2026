import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ContentListContext } from '../ContentListContext';

describe('ContentListContext', () => {
  it('wraps children in a div with data-dev-content-list when field is provided', () => {
    const { container } = render(
      <ContentListContext field="products">
        <span>a</span>
        <span>b</span>
      </ContentListContext>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.tagName).toBe('DIV');
    expect(wrapper?.getAttribute('data-dev-content-list')).toBe('products');
  });

  it('uses display:contents on the wrapper to avoid layout impact', () => {
    const { container } = render(
      <ContentListContext field="products">
        <span>a</span>
      </ContentListContext>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.display).toBe('contents');
  });

  it('tags each direct child with its iteration index', () => {
    const { container } = render(
      <ContentListContext field="products">
        <span>a</span>
        <span>b</span>
        <span>c</span>
      </ContentListContext>,
    );
    const children = Array.from(container.firstElementChild!.children);
    expect(children.map((c) => c.getAttribute('data-dev-content-list-index'))).toEqual(['0', '1', '2']);
  });

  it('preserves an existing explicit data-dev-content-list-index on a child', () => {
    const { container } = render(
      <ContentListContext field="products">
        <span data-dev-content-list-index="42">a</span>
      </ContentListContext>,
    );
    const child = container.firstElementChild!.firstElementChild;
    expect(child?.getAttribute('data-dev-content-list-index')).toBe('42');
  });

  it('is a pass-through (no wrapper) when field is undefined', () => {
    const { container } = render(
      <ContentListContext>
        <span data-testid="only">a</span>
      </ContentListContext>,
    );
    expect(container.firstElementChild?.tagName).toBe('SPAN');
    expect(container.firstElementChild?.hasAttribute('data-dev-content-list')).toBe(false);
    expect(container.firstElementChild?.hasAttribute('data-dev-content-list-index')).toBe(false);
  });

  it('supports nesting: inner list has its own index space', () => {
    const { container } = render(
      <ContentListContext field="outer">
        <div>
          <ContentListContext field="inner">
            <em>x</em>
            <em>y</em>
          </ContentListContext>
        </div>
      </ContentListContext>,
    );
    const outerList = container.querySelector('[data-dev-content-list="outer"]');
    const innerList = container.querySelector('[data-dev-content-list="inner"]');
    expect(outerList).toBeTruthy();
    expect(innerList).toBeTruthy();
    const innerItems = Array.from(innerList!.children);
    expect(innerItems.map((c) => c.getAttribute('data-dev-content-list-index'))).toEqual(['0', '1']);
  });
});

describe('ContentListContext — single-wrapper drill-down (prevents aliased indices)', () => {
  it('drills through a single grid wrapper to tag the real list items', () => {
    // This is the bug we hit: agent wrapped .map() in a grid div. Without
    // drill-down, only the grid got tagged (index=0) and every card-level
    // click resolved to products[0], aliasing all edits to one entry.
    const { container } = render(
      <ContentListContext field="products">
        <div className="grid grid-cols-4 gap-6">
          <div>Card 1</div>
          <div>Card 2</div>
          <div>Card 3</div>
          <div>Card 4</div>
        </div>
      </ContentListContext>,
    );
    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid).toBeTruthy();
    // Grid itself should NOT carry the per-item index — its children do.
    expect(grid.hasAttribute('data-dev-content-list-index')).toBe(false);
    const cards = Array.from(grid.children);
    expect(cards.map((c) => c.getAttribute('data-dev-content-list-index'))).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
  });

  it('does not drill when the single wrapper contains only one child (list-of-one)', () => {
    // A single-item list is a legitimate edge case — tag the wrapper with
    // index 0 so the inner element resolves correctly. No drill needed.
    const { container } = render(
      <ContentListContext field="products">
        <div className="grid">
          <div>Only card</div>
        </div>
      </ContentListContext>,
    );
    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid.getAttribute('data-dev-content-list-index')).toBe('0');
  });

  it('does not drill when children are multiple at top level (direct .map() pattern)', () => {
    const { container } = render(
      <ContentListContext field="products">
        <div>A</div>
        <div>B</div>
      </ContentListContext>,
    );
    const wrapper = container.firstElementChild!;
    const kids = Array.from(wrapper.children);
    expect(kids.map((c) => c.getAttribute('data-dev-content-list-index'))).toEqual(['0', '1']);
  });
});

describe('ContentListContext — className (be-the-grid pattern)', () => {
  it('when className is provided, wrapper IS the layout container (no display:contents)', () => {
    const { container } = render(
      <ContentListContext field="products" className="grid grid-cols-4 gap-6">
        <div>A</div>
        <div>B</div>
      </ContentListContext>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toBe('grid grid-cols-4 gap-6');
    expect(wrapper.style.display).toBe(''); // NOT 'contents'
    expect(wrapper.getAttribute('data-dev-content-list')).toBe('products');
  });

  it('tags direct children correctly under the className pattern', () => {
    const { container } = render(
      <ContentListContext field="products" className="grid">
        <div>A</div>
        <div>B</div>
        <div>C</div>
      </ContentListContext>,
    );
    const kids = Array.from(container.firstElementChild!.children);
    expect(kids.map((c) => c.getAttribute('data-dev-content-list-index'))).toEqual(['0', '1', '2']);
  });

  it('pass-through mode with className still renders a div with the className', () => {
    const { container } = render(
      <ContentListContext className="grid">
        <div>A</div>
      </ContentListContext>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.className).toBe('grid');
    expect(wrapper.hasAttribute('data-dev-content-list')).toBe(false);
  });
});
