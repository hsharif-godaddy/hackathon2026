import clsx from 'clsx'

import { Glyph } from './Glyph'
import { AI_COLOR, PENDING_ICON } from './progressTrackerConstants'
import { type ConnectorState, StageConnector } from './StageConnector'

interface StageProps {
  id: string
  glyph: string
  isActive: boolean
  isCompleted: boolean
  isLast: boolean
  /** Sub-progress (0–1) of the active stage; drives the left connector fill. */
  subProgress: number
  /** Trailing creep (0–1) shown on the final stage's right connector once passed. */
  trailingProgress: number
}

/**
 * A single stepper node: the left connector (fills toward this circle while
 * active), the circle with its glyph, and the right connector. On the final
 * stage the right connector shows the slow trailing creep instead.
 */
export function Stage({ id, glyph, isActive, isCompleted, isLast, subProgress, trailingProgress }: StageProps) {
  return (
    <div className="flex flex-1 items-center">
      <StageConnector
        state={
          // The three predicates are mutually exclusive, so clsx returns exactly
          // one key — always a valid ConnectorState.
          clsx({
            full: isCompleted,
            partial: !isCompleted && isActive,
            empty: !isCompleted && !isActive,
          }) as ConnectorState
        }
        progress={subProgress}
      />

      <div
        data-testid={`progress-stage-${id}`}
        aria-current={isActive ? 'step' : undefined}
        className={clsx(
          'flex h-[44px] w-[44px] flex-none items-center justify-center rounded-full transition-colors duration-500',
          !isCompleted && !isActive && 'border-[1.5px] border-[rgba(20,20,40,0.14)] bg-[#ffffff]',
        )}
        style={isCompleted || isActive ? { background: AI_COLOR } : undefined}
      >
        {isCompleted ? (
          <Glyph name="check" color="#ffffff" />
        ) : (
          <Glyph name={glyph} color={isActive ? '#ffffff' : PENDING_ICON} />
        )}
      </div>

      {isLast ? (
        <StageConnector state="partial" progress={trailingProgress} testId="progress-trailing-fill" />
      ) : (
        <StageConnector state={isCompleted ? 'full' : 'empty'} />
      )}
    </div>
  )
}
