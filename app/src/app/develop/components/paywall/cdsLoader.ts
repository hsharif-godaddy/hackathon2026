import dynamic from 'next/dynamic'
import * as ReactIntl from 'react-intl'

import { ensurePropTypes } from '@/utils/propTypes'

/**
 * Dynamically loaded CDS ComponentLoader with required global setup
 */
export const ComponentLoader = dynamic(
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
) as any
