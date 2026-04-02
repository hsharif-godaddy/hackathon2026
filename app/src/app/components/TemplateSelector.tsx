import clsx from 'clsx'

import { useTranslations } from '@/hooks/useTranslations'

interface TemplateSelectorProps {
  selectedTemplate: string
  onTemplateChange: (template: string) => void
}

export default function TemplateSelector({ selectedTemplate, onTemplateChange }: TemplateSelectorProps) {
  const t = useTranslations()

  return (
    <div className="flex items-center justify-center gap-2 mt-1" role="radiogroup" aria-label={t('builder_homepage_template_label', undefined, 'Template')}>
      <span className="text-xs opacity-60">
        {t('builder_homepage_template_label', undefined, 'Template:')}
      </span>
      {[
        { id: 'default', label: t('builder_homepage_template_default', undefined, 'Default') },
        { id: 'business-plan', label: t('builder_homepage_template_business_plan', undefined, 'Business Plan') },
        { id: 'logo-designer', label: t('builder_homepage_template_logo_designer', undefined, 'Logo Designer') },
      ].map((tmpl) => (
        <button
          key={tmpl.id}
          type="button"
          role="radio"
          aria-checked={selectedTemplate === tmpl.id}
          onClick={() => onTemplateChange(tmpl.id)}
          className={clsx(
            'px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer',
            selectedTemplate === tmpl.id
              ? 'bg-intents-ux-actionPrimary-backgroundColor text-intents-ux-actionPrimary-foregroundColor'
              : 'bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-boxLowContrast-foregroundColor opacity-60 hover:opacity-100'
          )}
        >
          {tmpl.label}
        </button>
      ))}
    </div>
  )
}
