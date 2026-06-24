import Box from '@ux/box';
import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import TextLockup from '@ux/text-lockup';
import classnames from 'classnames';
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { ResponsiveMenu } from '../../input/responsive-menu';
import { MilestoneFeedback, type MilestoneFeedbackProps } from './MilestoneFeedback';

const DEFAULT_SHOW_DETAILS_LABEL = 'Show details';
const DEFAULT_MENU_LABEL = 'More actions';

/**
 * One actionable item shown alongside a `Milestone`. Actions render either
 * inline in the trailing row or inside the overflow menu, controlled by
 * `priority`.
 */
export interface MilestoneAction {
  /** Stable key — also used as the menu-item key. */
  id: string;
  /** Visible label in both inline and overflow forms. */
  label: string;
  /** Optional `@ux/icon` icon name, rendered via `<AsyncIcon />`. */
  icon?: string;
  /** Click / Enter / Space handler. */
  onSelect: () => void;
  /**
   * Where this action prefers to render.
   *
   * - `'always'` — always inline, never collapses into the menu.
   * - `'overflow'` — always inside the ellipsis menu.
   * - `'auto'` (default) — inline when room allows, otherwise menu.
   *
   * @default 'auto'
   */
  priority?: 'always' | 'overflow' | 'auto';
  /** Disables the action in both inline and menu forms. */
  disabled?: boolean;
}

/**
 * Props for the `Milestone` root component. See the component JSDoc for
 * usage and examples; per-prop docs live on each field below.
 */
export interface MilestoneProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Headline copy — e.g. "Saved your changes". */
  label: string;
  /** Optional reasoning / details panel content. */
  children?: ReactNode;
  /**
   * Optional reasoning preview rendered above `children` in the disclosure
   * panel. Pass a `<Thinker.Reasoning>` if you want the same collapsible
   * preview behaviour the in-progress Thinker uses.
   */
  reasoningBlock?: ReactNode;
  /**
   * Controlled disclosure state. Pair with `onOpenChange`. Ignored when
   * neither `children` nor `reasoningBlock` is present.
   * @see defaultOpen
   * @see onOpenChange
   */
  open?: boolean;
  /**
   * Initial disclosure state when uncontrolled.
   * @default false
   * @see open
   * @see onOpenChange
   */
  defaultOpen?: boolean;
  /**
   * Called when the disclosure toggles. Fires in controlled and uncontrolled
   * modes.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Declarative actions array. The component decides which actions render
   * inline vs. collapse into the ellipsis menu based on each action's
   * `priority` and the available row width.
   */
  actions?: MilestoneAction[];
  /**
   * Optional feedback affordance rendered in the trailing region. Same
   * surface as `<Milestone.Feedback>` but driven via props. Pass `undefined`
   * (the default) to hide feedback entirely.
   */
  feedback?: MilestoneFeedbackProps;
  /** Override the ellipsis menu trigger's `aria-label`. */
  menuLabel?: string;
}

function MilestoneRoot({
  label,
  children,
  reasoningBlock,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  actions,
  feedback,
  menuLabel,
  className,
  ...rest
}: MilestoneProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const isOpen = isControlled ? openProp : internalOpen;

  const hasPanelContent = Boolean(children) || Boolean(reasoningBlock);

  const panelId = useId();
  const menuId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const handleToggle = useCallback(() => {
    setOpen(!isOpen);
  }, [isOpen, setOpen]);

  const allActions = actions ?? [];
  const alwaysActions = allActions.filter((a) => (a.priority ?? 'auto') === 'always');
  const autoActions = allActions.filter((a) => (a.priority ?? 'auto') === 'auto');
  const overflowOnlyActions = allActions.filter((a) => a.priority === 'overflow');

  const { inlineAutoCount, actionsRowRef } = useOverflowMeasure(autoActions.length);

  const collapsedAutoActions = autoActions.slice(inlineAutoCount);
  const menuActions = [...collapsedAutoActions, ...overflowOnlyActions];
  const hasMenu = menuActions.length > 0;

  const trailingHasContent = allActions.length > 0 || feedback !== undefined;

  return (
    <div
      {...rest}
      className={classnames('airo-chat-milestone', className)}
      data-partial="componentAiro"
    >
      <Box orientation="vertical" gap="sm" data-partial="componentAiro">
        {hasPanelContent ? (
          <div id={panelId} className="airo-chat-milestone__panel" hidden={!isOpen}>
            <Box orientation="vertical" gap="sm" data-partial="componentAiro">
              {reasoningBlock ?? null}
              {children}
            </Box>
          </div>
        ) : null}

        <Box
          orientation="horizontal"
          gap="sm"
          className="airo-chat-milestone__header"
          data-partial="componentAiro"
        >
          {hasPanelContent ? (
            <Button
              design="inline"
              size="small"
              className="airo-chat-milestone__label-button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={handleToggle}
              text={label?.trim() || DEFAULT_SHOW_DETAILS_LABEL}
              icon={
                <AsyncIcon
                  icon="chevron-up"
                  className={classnames('airo-chat-milestone__caret', {
                    'airo-chat-milestone__caret--open': isOpen,
                  })}
                />
              }
            />
          ) : (
            <TextLockup className="airo-chat-milestone__label" size="sm">
              {label}
            </TextLockup>
          )}

          {trailingHasContent ? (
            <Box
              orientation="horizontal"
              gap="sm"
              className="airo-chat-milestone__trailing"
              data-partial="componentAiro"
            >
              {allActions.length > 0 ? (
                <div ref={actionsRowRef} className="airo-chat-milestone__actions">
                  {alwaysActions.map((action) => (
                    <InlineActionButton key={action.id} action={action} />
                  ))}
                  {autoActions.map((action, index) => (
                    <InlineActionButton
                      key={action.id}
                      action={action}
                      collapsed={index >= inlineAutoCount}
                    />
                  ))}
                </div>
              ) : null}

              {feedback ? <MilestoneFeedback {...feedback} /> : null}

              {hasMenu ? (
                <ResponsiveMenu
                  id={menuId}
                  trigger={{
                    design: 'inline',
                    size: 'small',
                    'aria-label': menuLabel ?? DEFAULT_MENU_LABEL,
                    icon: <AsyncIcon icon="ellipsis" />,
                  }}
                  sheetTitle={menuLabel ?? DEFAULT_MENU_LABEL}
                  items={menuActions.map((action) => ({
                    id: action.id,
                    label: action.label,
                    disabled: action.disabled,
                    onClick: () => action.onSelect(),
                  }))}
                />
              ) : null}
            </Box>
          ) : null}
        </Box>
      </Box>
    </div>
  );
}

interface InlineActionButtonProps {
  action: MilestoneAction;
  /** When true the action is rendered but visually + layout-collapsed. */
  collapsed?: boolean;
}

function InlineActionButton({ action, collapsed = false }: InlineActionButtonProps) {
  return (
    <Button
      design="inline"
      size="small"
      className={classnames('airo-chat-milestone__action', {
        'airo-chat-milestone__action--collapsed': collapsed,
      })}
      disabled={action.disabled}
      onClick={action.onSelect}
      text={action.label}
      icon={action.icon ? <AsyncIcon icon={action.icon} /> : undefined}
    />
  );
}

/**
 * Measures whether all `auto`-priority actions fit on the row and returns
 * how many of them should render inline. Falls back to "all inline" until
 * the first measurement completes; subsequent ResizeObserver ticks update
 * the count if the container's width changes.
 *
 * The current heuristic mirrors the canonical
 * `_vendor/segmented-controller` collapseInactive measurement: we track
 * scrollWidth vs clientWidth on the actions row and reduce the inline-auto
 * count one step at a time until the row no longer overflows.
 */
function useOverflowMeasure(autoCount: number) {
  const actionsRowRef = useRef<HTMLDivElement | null>(null);
  const [inlineAutoCount, setInlineAutoCount] = useState(autoCount);

  // Reset when the auto-count itself changes (e.g. consumer adds/removes
  // an action) — the next measurement pass will collapse as needed.
  useEffect(() => {
    setInlineAutoCount(autoCount);
  }, [autoCount]);

  // `inlineAutoCount` is in the effect deps on purpose: each time
  // `measure` steps the count down by one, we want the effect to re-run
  // so the next render's row width is re-measured. The convergence loop
  // ends when scrollWidth no longer exceeds clientWidth.
  // biome-ignore lint/correctness/useExhaustiveDependencies: convergence-loop dep
  useLayoutEffect(() => {
    const row = actionsRowRef.current;
    if (!row) return;

    const measure = () => {
      // Read the row's overflow state. scrollWidth > clientWidth means at
      // least one inline action is being clipped or wrapping; we step the
      // inline count down by one and let React re-render. The next measure
      // pass either confirms a fit or steps down again. This converges in
      // O(autoCount) renders in the worst case.
      if (row.scrollWidth > row.clientWidth + 1) {
        setInlineAutoCount((prev) => (prev > 0 ? prev - 1 : prev));
      }
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // On container resize, optimistically restore the original auto count
      // and let the convergence loop re-collapse as needed. Skip when the
      // container has no measurable width yet (e.g. during initial mount in
      // jsdom) to avoid thrashing inlineAutoCount on a meaningless reading.
      if (row.clientWidth > 0) {
        setInlineAutoCount(autoCount);
      }
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [autoCount, inlineAutoCount]);

  return { inlineAutoCount, actionsRowRef };
}

/**
 * `Milestone` is a chat-surface "agent finished" indicator. It mirrors the
 * resolved-state shape that `Thinker.complete` proves out (reasoning panel
 * above the label, label-as-disclosure trigger) while adding declarative
 * actions and an optional feedback affordance.
 *
 * Compound slots:
 * - `<Milestone.Feedback>` — standalone thumbs-up / thumbs-down toggle pair
 *   with optional reason-picker on `'down'`. Also accepted via the
 *   `feedback` prop on the root.
 *
 * @example
 * <Milestone label="Saved your changes" />
 *
 * @example
 * <Milestone
 *   label="Generated 3 ideas"
 *   reasoningBlock={<Thinker.Reasoning>I considered…</Thinker.Reasoning>}
 *   actions={[
 *     { id: 'see', label: 'See', onSelect: handleSee },
 *     { id: 'archive', label: 'Archive', onSelect: handleArchive },
 *   ]}
 *   feedback={{
 *     downReasons: [{ id: 'wrong', label: 'Incorrect' }],
 *     onChange: (value, reason) => console.log(value, reason),
 *   }}
 * />
 */
export const Milestone = Object.assign(MilestoneRoot, {
  Feedback: MilestoneFeedback,
});
