import dynamic from 'next/dynamic'
import { ComponentType } from 'react'
import * as ReactIntl from 'react-intl'

import { ensurePropTypes } from '@/utils/propTypes'

/**
 * Props for the CDS ComponentLoader.
 * Uses Record type to allow for the dynamic props the CDS library accepts,
 * while documenting the commonly used props.
 */
interface CdsComponentLoaderProps extends Record<string, unknown> {
  /** CDS component type identifier */
  type: string
  /** CDS configuration object */
  cds?: unknown
  /** Component subtype (e.g., 'SinglePlanUpgrade', 'StandaloneAddon') */
  subType?: string
  /** UX component dependencies with module and version */
  deps?: Record<string, { module: unknown; version: string }>
  /** Locale for i18n */
  locale?: string
  /** Loading component to show while CDS loads */
  LoadingComponent?: React.ReactNode
}

/**
 * Dynamically loaded CDS ComponentLoader with required global setup
 */
export const ComponentLoader: ComponentType<CdsComponentLoaderProps> = dynamic(
  async () => {
    const [, cdsLoaderModule] = await Promise.all([
      ensurePropTypes(),
      import('@venture/cds-loader'),
    ])
    if (typeof window !== 'undefined') {
      if (!(window as any).ux) {
        (window as any).ux = {}
      }
      (window as any).ux.intl = ReactIntl
    }
    return cdsLoaderModule.default
  },
  { ssr: false }
)
