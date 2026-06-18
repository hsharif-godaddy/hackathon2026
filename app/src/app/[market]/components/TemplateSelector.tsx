import { useId, useState } from 'react'
import Box from '@ux/box'
import Chip from '@ux/chip'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { logLogoDesignerEntry } from '@/lib/logo-designer-entry'
import { generateClickEID, logClickEvent } from '@/utils/instrumentation'
import DeepBuildIntroModal from './DeepBuildIntroModal'
import { LOGO_DESIGNER_TEMPLATE } from './types'

interface TemplateSelectorProps {
  selectedTemplate: string
  onTemplateChange: (template: string) => void
}

export default function TemplateSelector({ selectedTemplate, onTemplateChange }: TemplateSelectorProps) {
  const t = useTranslations()
  const groupLabelId = useId()
  const [showDeepBuildModal, setShowDeepBuildModal] = useState(false)

  function handleTemplateSelect(templateId: string): void {
    if (templateId === 'deep-build') {
      setShowDeepBuildModal(true)
      return
    }
    if (templateId === LOGO_DESIGNER_TEMPLATE && selectedTemplate !== LOGO_DESIGNER_TEMPLATE) {
      logLogoDesignerEntry('chip')
    }
    onTemplateChange(templateId)
    logClickEvent(`homepage.template_selector.${templateId}`)()
  }

  function handleDeepBuildConfirm(): void {
    setShowDeepBuildModal(false)
    onTemplateChange('deep-build')
    logClickEvent('homepage.template_selector.deep-build')()
  }

  return (
    <>
      <Box
        orientation="horizontal"
        gap="sm"
        blockAlignChildren="center"
        inlineAlignChildren="center"
        role="group"
        aria-labelledby={groupLabelId}
        wrap
      >
        <text.p id={groupLabelId} size={-1} emphasis="passive">
          {t('builder_homepage_template_label', undefined, 'Template:')}
        </text.p>
        <Box orientation="horizontal" gap="sm" blockAlignChildren="center" inlineAlignChildren="center" wrap>
          {[
            { id: 'default', label: t('builder_homepage_template_default', undefined, 'Default') },
            { id: 'business-plan', label: t('builder_homepage_template_business_plan', undefined, 'Business Plan') },
            { id: 'logo-designer', label: t('builder_homepage_template_logo_designer', undefined, 'Logo Designer') },
            { id: 'deep-build', label: 'Deep Build' },
          ].map((tmpl) => (
            <Chip
              key={tmpl.id}
              label={tmpl.label}
              selected={selectedTemplate === tmpl.id}
              onSelect={() => handleTemplateSelect(tmpl.id)}
              data-partial="componentAiro"
              data-testid={`template-chip-${tmpl.id}`}
              data-eid={generateClickEID(`homepage.template_selector.${tmpl.id}`)}
              size="sm"
            />
          ))}
        </Box>
      </Box>
      <DeepBuildIntroModal
        open={showDeepBuildModal}
        onClose={() => setShowDeepBuildModal(false)}
        onConfirm={handleDeepBuildConfirm}
      />
    </>
  )
}
