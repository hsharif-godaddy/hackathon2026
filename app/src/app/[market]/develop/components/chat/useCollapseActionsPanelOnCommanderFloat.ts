import { useEffect, useRef } from 'react'

import { useCommanderLayout } from '@/app/[market]/commander/components/CommanderLayoutContext'
import { CommanderPosition } from '@/app/[market]/commander/types'
import { useEffectiveCommanderPosition } from '@/stores/useCommanderStore'

interface CollapseActionsPanelOnCommanderFloatOptions {
  isAskQuestionActive: boolean
  isProcessing: boolean
  continueBuildingExpanded: boolean
  setContinueBuildingExpanded: (expanded: boolean) => void
  setFullPlanExpanded: (expanded: boolean) => void
  clearAutoExpanded?: () => void
}

/**
 * When the commander moves between sidebar and floating, sync the actions panel:
 * - Sidebar → Floating: collapse Continue Building / Thinking (not askQuestion)
 * - Floating → Sidebar: expand Continue Building again
 */
export function useCollapseActionsPanelOnCommanderFloat({
  isAskQuestionActive,
  isProcessing,
  continueBuildingExpanded,
  setContinueBuildingExpanded,
  setFullPlanExpanded,
  clearAutoExpanded,
}: CollapseActionsPanelOnCommanderFloatOptions) {
  const commanderLayout = useCommanderLayout()
  const position = useEffectiveCommanderPosition()
  const prevPositionRef = useRef(position)

  useEffect(() => {
    const previousPosition = prevPositionRef.current
    prevPositionRef.current = position

    if (!commanderLayout) return

    if (previousPosition === CommanderPosition.Floating && position === CommanderPosition.LeftDock) {
      if (!isAskQuestionActive && !isProcessing) {
        setContinueBuildingExpanded(true)
      }
      return
    }

    if (previousPosition !== CommanderPosition.LeftDock) return
    if (position !== CommanderPosition.Floating) return
    if (isAskQuestionActive) return

    if (isProcessing) {
      setFullPlanExpanded(false)
      clearAutoExpanded?.()
      return
    }

    if (continueBuildingExpanded) {
      setContinueBuildingExpanded(false)
    }
  }, [
    clearAutoExpanded,
    commanderLayout,
    continueBuildingExpanded,
    isAskQuestionActive,
    isProcessing,
    position,
    setContinueBuildingExpanded,
    setFullPlanExpanded,
  ])
}
