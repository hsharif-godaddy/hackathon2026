import { AI_COLOR, CONNECTOR_MUTED, CONNECTOR_PX, CONNECTOR_TRANSITION } from './progressTrackerConstants'

export type ConnectorState = 'full' | 'partial' | 'empty'

interface StageConnectorProps {
  /** full: solid purple · partial: muted with a left-anchored purple fill · empty: muted */
  state: ConnectorState
  /** Fill ratio (0–1) used only when state is 'partial'. */
  progress?: number
  /** Optional test id on the partial fill element (e.g. the trailing creep). */
  testId?: string
}

/**
 * One horizontal segment of the stepper line. Structural layout is Tailwind;
 * the exact 3px height, colors, and fill width stay inline (pixel/runtime values).
 */
export function StageConnector({ state, progress = 0, testId }: StageConnectorProps) {
  if (state === 'full') {
    return <div className="flex-1" style={{ height: CONNECTOR_PX, background: AI_COLOR, transition: 'background-color 500ms' }} />
  }

  if (state === 'partial') {
    return (
      <div className="relative flex-1 overflow-hidden" style={{ height: CONNECTOR_PX, background: CONNECTOR_MUTED, transition: CONNECTOR_TRANSITION }}>
        <div data-testid={testId} className="absolute inset-y-0 left-0" style={{ width: `${progress * 100}%`, background: AI_COLOR }} />
      </div>
    )
  }

  return <div className="flex-1" style={{ height: CONNECTOR_PX, background: CONNECTOR_MUTED, transition: CONNECTOR_TRANSITION }} />
}
