'use client'

import { useCallback, useState } from 'react'
import Button from '@ux/button'
import EditIcon from '@ux/icon/edit'
import text from '@ux/text'

import { Automation, AUTOMATION_MAX_DESCRIPTION_LENGTH, AUTOMATION_MAX_NAME_LENGTH, AUTOMATION_MAX_PROMPT_LENGTH } from '@/app/[market]/develop/components/automations/types'
import SpinnerIcon from '@/app/[market]/develop/components/tool-renderers/SpinnerIcon'
import { useTranslations } from '@/hooks/useTranslations'

interface EditFormProps {
  automation: Automation
  onSave: (data: Omit<Automation, 'id'>) => void
  onCancel: () => void
  isSaving?: boolean
}

export default function EditForm({ automation, onSave, onCancel, isSaving = false }: EditFormProps) {
  const t = useTranslations()
  const [name, setName] = useState(automation.name)
  const [description, setDescription] = useState(automation.description)
  const [prompt, setPrompt] = useState(automation.prompt)

  const handleSubmit = useCallback(function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !prompt.trim()) return
    onSave({ name: name.trim(), description: description.trim(), prompt: prompt.trim() })
  }, [name, description, prompt, onSave])

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-intents-ux-actionPrimary-borderColor/40 bg-intents-ux-box-backgroundColor overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-intents-ux-box-borderColor bg-intents-ux-neutral-backgroundColor/30">
        <div className="p-1 rounded-md bg-intents-ux-actionPrimary-backgroundColor/20 border border-intents-ux-actionPrimary-borderColor/20">
          <EditIcon className="size-2.5 text-intents-ux-actionPrimary-backgroundColor" />
        </div>
        <text.p size={0} className="font-semibold">
          {t('builder_automations_edit_title', undefined, 'Edit Automation')}
        </text.p>
      </div>
      <div className="p-4 flex flex-col gap-3.5">
        <div>
          <label className="block mb-1.5">
            <text.span size={-1} className="font-medium">{t('builder_automations_field_name', undefined, 'Name')}</text.span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={AUTOMATION_MAX_NAME_LENGTH}
            className="w-full px-3 py-2 rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-input-backgroundColor text-sm focus:outline-none focus:border-intents-ux-actionPrimary-borderColor transition-all"
          />
        </div>
        <div>
          <label className="block mb-1.5">
            <text.span size={-1} className="font-medium">{t('builder_automations_field_description', undefined, 'Description')}</text.span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={AUTOMATION_MAX_DESCRIPTION_LENGTH}
            className="w-full px-3 py-2 rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-input-backgroundColor text-sm focus:outline-none focus:border-intents-ux-actionPrimary-borderColor transition-all"
          />
        </div>
        <div>
          <label className="block mb-1.5">
            <text.span size={-1} className="font-medium">{t('builder_automations_field_prompt', undefined, 'Instructions')}</text.span>
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            maxLength={AUTOMATION_MAX_PROMPT_LENGTH}
            className="w-full px-3 py-2 rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-input-backgroundColor text-sm focus:outline-none focus:border-intents-ux-actionPrimary-borderColor transition-all resize-none"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            type="button"
            design="secondary"
            size="sm"
            onClick={onCancel}
            text={t('builder_common_cancel', undefined, 'Cancel')}
          />
          <Button
            type="submit"
            design="primary"
            size="sm"
            disabled={!name.trim() || !prompt.trim() || isSaving}
            icon={isSaving ? <SpinnerIcon /> : undefined}
            text={t('builder_common_save', undefined, 'Save')}
          />
        </div>
      </div>
    </form>
  )
}
