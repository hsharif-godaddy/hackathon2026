import { useId } from 'react'
import Box from '@ux/box'
import Chip from '@ux/chip'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID, logClickEvent } from '@/utils/instrumentation'

interface TemplateSelectorProps {
  selectedTemplate: string
  onTemplateChange: (template: string) => void
}

export default function TemplateSelector({ selectedTemplate, onTemplateChange }: TemplateSelectorProps) {
  const t = useTranslations()
  const groupLabelId = useId()

  return (
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
        ].map((tmpl) => (
          <Chip
            key={tmpl.id}
            label={tmpl.label}
            selected={selectedTemplate === tmpl.id}
            onSelect={() => {
              onTemplateChange(tmpl.id)
              logClickEvent(`homepage.template_selector.${tmpl.id}`)()
            }}
            data-partial="componentAiro"
            data-testid={`template-chip-${tmpl.id}`}
            data-eid={generateClickEID(`homepage.template_selector.${tmpl.id}`)}
            size="sm"
          />
        ))}
      </Box>
    </Box>
  )
}
