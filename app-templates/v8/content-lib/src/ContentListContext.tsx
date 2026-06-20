import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

interface ContentListContextProps {
  /**
   * Dotted path to the content-layer array backing this list (e.g. `"products"`
   * or `"site.nav"`). Omit to render as a pass-through (non-CMS data source).
   */
  field?: string;
  /**
   * Optional className for the wrapper. When provided, the wrapper itself
   * becomes the layout container (e.g. a grid) and is NOT `display: contents`.
   * Use this pattern when the list needs its own grid/flex styling — it
   * keeps the `.map()` output as direct children so each item is indexed
   * correctly.
   */
  className?: string;
  children: ReactNode;
}

/**
 * Marks an iteration over a content-layer array so edit mode can resolve
 * click targets back to a specific content entry. Tags each mapped item
 * with its iteration index so the iframe can compute the concrete content
 * key (e.g. `products[3].name`) when the user clicks.
 *
 * Handles three wrapping patterns:
 *
 *   1. `.map()` is a direct child (classic):
 *        <ContentListContext field="products">
 *          {products.map(p => <Card key={p.id}>...</Card>)}
 *        </ContentListContext>
 *
 *   2. `.map()` wrapped in a single layout element (e.g. a grid) — common
 *      because grid/flex styling often needs its own container. This case
 *      is auto-detected and the wrapper is drilled through so the REAL
 *      items get indexed, not the grid itself.
 *        <ContentListContext field="products">
 *          <div className="grid">
 *            {products.map(p => <Card key={p.id}>...</Card>)}
 *          </div>
 *        </ContentListContext>
 *
 *   3. Explicit `className` — preferred for grids; ContentListContext IS the
 *      grid, no inner wrapper needed.
 *        <ContentListContext field="products" className="grid grid-cols-3 gap-4">
 *          {products.map(p => <Card key={p.id}>...</Card>)}
 *        </ContentListContext>
 *
 * Pass-through when `field` is undefined — use for the same component shape
 * backed by an external (non-CMS) data source.
 */
export function ContentListContext({ field, className, children }: ContentListContextProps) {
  if (!field) {
    return className ? <div className={className}>{children}</div> : children;
  }

  const direct = Children.toArray(children);

  // Pattern 2: single element wrapper (e.g. a grid div) around the mapped
  // items. Drill one level so index tags land on the real items, not the
  // wrapper. Only drill when the inner has multiple children — a single-
  // element inner is probably an intentional single-card layout, not a
  // list-in-wrapper.
  if (direct.length === 1 && isValidElement(direct[0])) {
    const wrapper = direct[0] as ReactElement<{ children?: ReactNode }>;
    const inner = Children.toArray(wrapper.props.children);
    if (inner.length > 1) {
      const tagged = inner.map((c, i) => tagChild(c, i));
      return (
        <div
          data-dev-content-list={field}
          className={className}
          style={className ? undefined : { display: 'contents' }}
        >
          {cloneElement(wrapper, {}, tagged)}
        </div>
      );
    }
  }

  const items = direct.map((c, i) => tagChild(c, i));

  return (
    <div
      data-dev-content-list={field}
      className={className}
      style={className ? undefined : { display: 'contents' }}
    >
      {items}
    </div>
  );
}

function tagChild(child: ReactNode, index: number): ReactNode {
  if (!isValidElement(child)) return child;
  const existing = (child.props as Record<string, unknown>)['data-dev-content-list-index'];
  return cloneElement(child, {
    'data-dev-content-list-index': existing ?? index,
  } as Record<string, unknown>);
}

export default ContentListContext;
