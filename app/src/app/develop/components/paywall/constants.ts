import uxAlert from '@ux/alert'
import uxButton from '@ux/button'
import uxIcon from '@ux/icon'
import uxModal from '@ux/modal'
import uxQuantitySelector from '@ux/quantity-selector'
import uxRadio from '@ux/radio'
import uxSpinner from '@ux/spinner'
import uxTag from '@ux/tag'
import uxText from '@ux/text'
import uxTextLockup from '@ux/text-lockup'
import uxTooltip from '@ux/tooltip'
import uxTooltipLegacy from '@ux/tooltip-legacy'

/**
 * Product IDs for unified plans and pricing library
 */
export const UPGRADE_PRODUCT_IDS = {
  /** Legacy Airo Plus product */
  AIRO_PLUS: 'AiroPlusAppBuilderProduct',
  /** New Airo Builder subscription product */
  AIRO_BUILDER: 'AiroBuilderProduct',
  /** Airo Builder credits add-on product */
  AIRO_BUILDER_CREDITS: 'AiroBuilderCreditsProduct',
} as const

export type UpgradeProductId = typeof UPGRADE_PRODUCT_IDS[keyof typeof UPGRADE_PRODUCT_IDS]

/**
 * Shared UX dependencies for unified plans and pricing library components
 */
export const UPGRADE_DEPS = {
  uxAlert: { module: uxAlert, version: '2500.7.2' },
  uxButton: { module: uxButton, version: '2500.7.2' },
  uxIcon: { module: uxIcon, version: '2500.7.2' },
  uxModal: { module: uxModal, version: '2500.7.2' },
  uxQuantitySelector: { module: uxQuantitySelector, version: '2500.7.2' },
  uxRadio: { module: uxRadio, version: '2500.7.1' },
  uxSpinner: { module: uxSpinner, version: '2500.7.1' },
  uxTag: { module: uxTag, version: '2500.7.2' },
  uxText: { module: uxText, version: '2500.7.1' },
  uxTooltip: { module: uxTooltip, version: '2500.7.2' },
  uxTooltipLegacy: { module: uxTooltipLegacy, version: '2400.15.1' },
  uxTextLockup: { module: uxTextLockup, version: '2500.7.2' },
}
