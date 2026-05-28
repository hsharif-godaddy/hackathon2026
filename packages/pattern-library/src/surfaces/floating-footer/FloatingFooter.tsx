import Box from '@ux/box';
import classnames from 'classnames';
import { type ComponentProps, type Ref, forwardRef } from 'react';

/**
 * Props for `FloatingFooter`.
 *
 * Inherits `@ux/box` layout props (`gap`, `blockPadding`, `stretch`, …) except
 * `elevation`, which is fixed to **`raised`** so the sheet reads as lifted
 * chrome (softer than overlay) while still picking up theme background and
 * radius from UXCore2.
 */
export type FloatingFooterProps = Omit<ComponentProps<typeof Box>, 'elevation'>;

function FloatingFooterRoot(
  {
    className,
    children,
    displayType = 'flex',
    orientation = 'horizontal',
    blockPadding = 'sm',
    inlinePadding = 'sm',
    stretch = true,
    ...rest
  }: FloatingFooterProps,
  ref: Ref<HTMLDivElement>,
) {
  return (
    <Box
      ref={ref}
      elevation="raised"
      displayType={displayType}
      orientation={orientation}
      blockPadding={blockPadding}
      inlinePadding={inlinePadding}
      stretch={stretch}
      {...rest}
      className={classnames('airo-surfaces-floating-footer', className)}
    >
      {children}
    </Box>
  );
}

/**
 * `FloatingFooter` is a horizontal sheet for chrome pinned to the bottom of a
 * viewport region or drawer — prompt toolbars, composer actions, etc. It
 * composes `@ux/box` with **`elevation="raised"`** so background, corner radius,
 * and depth follow UXCore2 raised surfaces (filter drop-shadow from the
 * design system — intentionally lighter than overlay / modal chrome).
 *
 * **Styles** — import `@airo-ux/pattern-library/surfaces/floating-footer/styles`
 * wherever you render this component (including when wrapping a borderless
 * `PromptBox` in a floating capsule).
 *
 * @example
 * ```tsx
 * import Box from '@ux/box';
 * import Button from '@ux/button';
 * import { FloatingFooter } from '@airo-ux/pattern-library/surfaces/floating-footer';
 * import '@airo-ux/pattern-library/surfaces/floating-footer/styles';
 *
 * <FloatingFooter>
 *   <Box orientation="horizontal" stretch blockAlignChildren="center" gap="md">
 *     <Button design="tertiary" size="small" text="Left" type="button" />
 *     <div aria-hidden className="min-w-0 flex-1" />
 *     <Button design="primary" size="small" text="Right" type="button" />
 *   </Box>
 * </FloatingFooter>
 * ```
 */
export const FloatingFooter = forwardRef(FloatingFooterRoot);
