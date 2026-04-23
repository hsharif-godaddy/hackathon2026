'use client'

import { useIntl } from 'react-intl'

import { getAppLocale } from '@/utils/common'

export function useUserLocale(): string {
  const intl = useIntl()
  const fromGasket = getAppLocale()
  return fromGasket !== 'en-US' ? fromGasket : intl.locale
}
