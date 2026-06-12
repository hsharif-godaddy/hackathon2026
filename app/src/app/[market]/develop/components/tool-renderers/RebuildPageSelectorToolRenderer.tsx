'use client'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import RebuildPageSelectorMultiSelect from './RebuildPageSelectorMultiSelect'
import RebuildPageSelectorSingleSelect from './RebuildPageSelectorSingleSelect'

/**
 * Routes the `rebuildPageSelector` tool to either the original single-select card
 * (flag OFF — the pre-slice flow Sales is familiar with) or the multi-page selector
 * (flag ON). Gated by `appbuilder-rebuild-multipage`; default OFF.
 *
 * When ON is fully rolled out: delete RebuildPageSelectorSingleSelect.tsx, drop this
 * wrapper, and register RebuildPageSelectorMultiSelect directly in the registry.
 */
export default function RebuildPageSelectorToolRenderer(props: DefaultToolRendererProps) {
  const multipageEnabled = useSwitchboard('appbuilder-rebuild-multipage')
  return multipageEnabled
    ? <RebuildPageSelectorMultiSelect {...props} />
    : <RebuildPageSelectorSingleSelect {...props} />
}
