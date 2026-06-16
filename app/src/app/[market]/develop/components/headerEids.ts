import { MobileMode, ViewMode } from '@/app/[market]/develop/components/types'

export const VIEW_MODE_EID_MAP: Record<string, string> = {
  [ViewMode.PREVIEW]: 'develop.header.iframe',
  [ViewMode.EDIT]: 'develop.header.edit_mode',
  [ViewMode.CODE]: 'develop.header.code_editor',
  [ViewMode.BRAND]: 'develop.header.brand_book',
  [ViewMode.DOMAIN]: 'develop.header.domain_view',
  [ViewMode.INBOX]: 'develop.header.inbox',
}

export const MOBILE_MODE_EID_MAP: Record<string, string> = {
  [MobileMode.TOOLS]: 'develop.mobile_header.tools',
  [MobileMode.PREVIEW]: 'develop.mobile_header.preview',
}
