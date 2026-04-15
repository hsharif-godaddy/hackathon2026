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

/**
 * Offer group IDs for Direct-to-Paid flows
 */
export const D2P_OFFER_GROUP_IDS = {
  /** Airo Builder lineup for new users without subscription */
  AIRO_BUILDER_LINEUP: 'airoBuilderLineup',
} as const

export type UpgradeProductId = typeof UPGRADE_PRODUCT_IDS[keyof typeof UPGRADE_PRODUCT_IDS]

/**
 * Shared UX dependencies for unified plans and pricing library components
 */
export const UPGRADE_DEPS = {
  uxAlert: { module: uxAlert, version: '2500.11.1' },
  uxButton: { module: uxButton, version: '2500.11.1' },
  uxIcon: { module: uxIcon, version: '2500.11.0' },
  uxModal: { module: uxModal, version: '2500.11.1' },
  uxQuantitySelector: { module: uxQuantitySelector, version: '2500.11.1' },
  uxRadio: { module: uxRadio, version: '2500.9.0' },
  uxSpinner: { module: uxSpinner, version: '2500.9.0' },
  uxTag: { module: uxTag, version: '2500.11.0' },
  uxText: { module: uxText, version: '2500.9.0' },
  uxTooltip: { module: uxTooltip, version: '2500.11.1' },
  uxTooltipLegacy: { module: uxTooltipLegacy, version: '2400.19.1' },
  uxTextLockup: { module: uxTextLockup, version: '2500.11.0' },
}
