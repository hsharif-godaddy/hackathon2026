import classnames from 'classnames';
import type { HTMLAttributes, JSX } from 'react';

/** Props for {@link DragHandle}. */
export interface DragHandleProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * `'horizontal'` renders the familiar wide pill used in panel headers.
   * `'vertical'` renders a tall narrow grip used on resizable edges.
   *
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';
  /** Optional additional class on the root element. */
  className?: string;
}

/**
 * A purely decorative affordance pill that indicates a draggable or
 * resizable surface. Always `aria-hidden`; interactive labels and event
 * handlers belong on the wrapping container.
 *
 * Opacity is 0.4 at rest and transitions to 1.0 when the parent element
 * is hovered. The parent must carry the
 * `airo-primitives-drag-handle__parent` class (or its own `:hover` rule)
 * to trigger the opacity change.
 *
 * Standard HTML attributes (`id`, `data-*`, `style`, etc.) forward to
 * the root `<div>`.
 *
 * @example
 * ```tsx
 * import { DragHandle } from '@airo-ux/pattern-library/primitives/drag-handle';
 * import '@airo-ux/pattern-library/primitives/drag-handle/styles';
 *
 * // Wrap the handle in a real interactive element. A `<button>` gets
 * // keyboard activation, focus styles, and the right semantics for
 * // free; `<div role="button" tabIndex={0}>` is a poorer substitute
 * // that has to re-implement Space/Enter handling and is what the
 * // accessibility skill warns against.
 * <button
 *   type="button"
 *   className="airo-primitives-drag-handle__parent"
 *   onPointerDown={handlePointerDown}
 *   aria-label="Drag to reposition"
 * >
 *   <DragHandle orientation="horizontal" />
 * </button>
 * ```
 */
export function DragHandle({
  orientation = 'horizontal',
  className,
  ...rest
}: DragHandleProps): JSX.Element {
  return (
    <div
      {...rest}
      // `aria-hidden` lives AFTER `...rest` so the decorative-only contract
      // documented at the top of this file can't be quietly broken by a
      // consumer-passed `aria-hidden={false}`.
      aria-hidden="true"
      className={classnames(
        'airo-primitives-drag-handle',
        {
          'airo-primitives-drag-handle--horizontal': orientation === 'horizontal',
          'airo-primitives-drag-handle--vertical': orientation === 'vertical',
        },
        className,
      )}
    />
  );
}
