import Growl from '@ux/growl'

import { type useTranslations } from '@/hooks/useTranslations'

type Translate = ReturnType<typeof useTranslations>

export function showEditApplyFailureGrowl(t: Translate): void {
  Growl.addGrowlMessage({
    id: 'edit-apply-failure',
    title: t('builder_develop_edit_apply_failed_title', undefined, 'Edit not applied'),
    children: t('builder_develop_edit_apply_failed_body', undefined, 'We could not apply that change. Try again or ask Airo to make the edit.'),
    emphasis: 'critical',
    lifetime: 5000,
  })
}
