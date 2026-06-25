'use client'

import { useState } from 'react'
import Button from '@ux/button'
import SparklesIcon from '@ux/icon/sparkles'
import XIcon from '@ux/icon/x'
import text from '@ux/text'

import { Automation, AUTOMATION_MAX_DESCRIPTION_LENGTH, AUTOMATION_MAX_NAME_LENGTH, AUTOMATION_MAX_PROMPT_LENGTH } from '@/app/[market]/develop/components/automations/types'
import SpinnerIcon from '@/app/[market]/develop/components/tool-renderers/SpinnerIcon'
import { useTranslations } from '@/hooks/useTranslations'

interface AddViewProps {
  onAdd: (data: Omit<Automation, 'id'>) => void
  onClose: () => void
  isSaving?: boolean
  isAgentBusy?: boolean
}

export default function AddView({ onAdd, onClose, isSaving = false, isAgentBusy = false }: AddViewProps) {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !prompt.trim()) return
    onAdd({ name: name.trim(), description: description.trim(), prompt: prompt.trim() })
  }

  return (
    <div className="rounded-xl border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-intents-ux-box-borderColor bg-intents-ux-neutral-backgroundColor/30">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-intents-ux-actionPrimary-backgroundColor/20 border border-intents-ux-actionPrimary-borderColor/20">
            <SparklesIcon className="size-2.5 text-intents-ux-actionPrimary-backgroundColor" />
          </div>
          <text.p size={0} className="font-semibold">{t('builder_automations_add_title', undefined, 'Add Automation')}</text.p>
        </div>
        <Button
          type="button"
          design="minimal"
          size="sm"
          onClick={onClose}
          aria-label="Close"
          icon={<XIcon />}
        />
      </div>
      <form id="automation-form" onSubmit={handleSubmit} className="p-4 flex flex-col gap-3.5">
        <div>
          <label className="block mb-1.5">
            <text.span size={-1} className="font-medium">{t('builder_automations_field_name', undefined, 'Name')}</text.span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('builder_automations_field_name_placeholder', undefined, 'e.g. Check Broken Links')}
            maxLength={AUTOMATION_MAX_NAME_LENGTH}
            className="w-full px-3 py-2 rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-input-backgroundColor text-sm focus:outline-none focus:border-intents-ux-actionPrimary-borderColor transition-all"
            autoFocus
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
            placeholder={t('builder_automations_field_description_placeholder', undefined, 'Brief description of what this does')}
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
            placeholder={t('builder_automations_field_prompt_placeholder', undefined, 'Detailed instructions for the AI agent...')}
            rows={5}
            maxLength={AUTOMATION_MAX_PROMPT_LENGTH}
            className="w-full px-3 py-2 rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-input-backgroundColor text-sm focus:outline-none focus:border-intents-ux-actionPrimary-borderColor transition-all resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-0.5">
          <Button
            type="button"
            design="secondary"
            size="sm"
            onClick={onClose}
            text={t('builder_common_cancel', undefined, 'Cancel')}
          />
          <Button
            type="submit"
            design="primary"
            size="sm"
            disabled={!name.trim() || !prompt.trim() || isSaving || isAgentBusy}
            icon={isSaving ? <SpinnerIcon /> : <SparklesIcon />}
            text={t('builder_automations_add_button', undefined, 'Create')}
            title={isAgentBusy ? t('builder_automations_agent_busy_tooltip', undefined, 'Agent is processing') : undefined}
          />
        </div>
      </form>
    </div>
  )
}
