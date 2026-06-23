'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChoiceListOtherRow } from '@airo-ux/pattern-library/input/choice-list'
import Button from '@ux/button'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import CollapsibleChatInputSection from '@/app/[market]/develop/components/chat/CollapsibleChatInputSection'
import type { AskQuestionChoiceQuestion } from '@/app/[market]/develop/components/tool-renderers/AskQuestionChoicePanel'
import AskQuestionChoicePanel from '@/app/[market]/develop/components/tool-renderers/AskQuestionChoicePanel'
import {
  CLOSE_CHIP_MAP,
  trackCloseSelection,
  trackFeedbackResponse,
  trackFeedbackShown,
  trackOffbaseAction,
} from '@/lib/firstBuildFeedbackAnalytics'
import type { UseFirstBuildFeedbackResult } from './useFirstBuildFeedback'

interface Props {
  feedback: UseFirstBuildFeedbackResult
  appId: string
}

const CLOSE_OPTIONS = [
  'Show me 2-3 color scheme options to choose from.',
  'Show me 2-3 font options to choose from.',
  'Change the writing tone and voice of the page copy. Ask me to pick from 2-3 copy voice options, then rewrite the text to match.',
]

const PROMPT_QUESTION: AskQuestionChoiceQuestion = {
  question: 'Is this what you imagined?',
  type: 'chips_single',
  suggestions: [
    { text: 'Looks great!' },
    { text: 'Close, needs some work' },
    { text: 'Not what I expected' },
  ],
  allowOther: false,
}

const closeQuestion: AskQuestionChoiceQuestion = {
  question: 'What should we tweak?',
  type: 'chips_single',
  suggestions: [
    { text: 'Change the color scheme' },
    { text: 'Change the fonts' },
    { text: 'Change the writing tone' },
  ],
  allowOther: true,
}

function CloseFollowupStep({
  dismiss,
  sendUserMessage,
  appId,
}: {
  dismiss: UseFirstBuildFeedbackResult['dismiss']
  sendUserMessage: (msg: string, opts?: { isActionRequest?: boolean }) => void
  appId: string
}) {
  const handleSkip = useCallback(() => {
    trackCloseSelection('skipped', appId)
    dismiss('skipped')
  }, [dismiss, appId])

  return (
    <CollapsibleChatInputSection
      title="What should we tweak?"
      onDismiss={handleSkip}
      dismissLabel="Skip"
    >
      <AskQuestionChoicePanel
        questions={[closeQuestion]}
        allowOtherGlobal={true}
        hideQuestion={true}
        skipLabel="Skip"
        rootOtherPlaceholder="Tell us what to tweak..."
        otherAriaLabel="Tell us what to tweak"
        backLabel="Back"
        submitLabel="Submit"
        disabled={false}
        ariaLabel="What should we tweak?"
        onStepChange={() => undefined}
        onActiveStepChange={() => undefined}
        onComplete={(selections) => {
          const raw = selections['0']
          if (raw === null) {
            trackCloseSelection('skipped', appId)
            dismiss('skipped')
            return
          }
          const rawStr = typeof raw === 'string' ? raw : raw[0] ?? ''
          let text: string
          let selection: 'color_scheme' | 'fonts' | 'tone' | 'other'
          const chipIndex = /^\d+$/.test(rawStr)
            ? parseInt(rawStr, 10) - 1
            : -1
          if (chipIndex >= 0 && chipIndex < CLOSE_OPTIONS.length) {
            text = CLOSE_OPTIONS[chipIndex]!
            selection = CLOSE_CHIP_MAP[chipIndex] ?? 'other'
          } else {
            text = rawStr
            selection = 'other'
          }
          sendUserMessage(text, { isActionRequest: true })
          trackCloseSelection(selection, appId)
          dismiss('close')
        }}
      />
    </CollapsibleChatInputSection>
  )
}

function OffbaseFollowupStep({
  dismiss,
  sendUserMessage,
  appId,
}: {
  dismiss: UseFirstBuildFeedbackResult['dismiss']
  sendUserMessage: (msg: string, opts?: { isActionRequest?: boolean }) => void
  appId: string
}) {
  const [draft, setDraft] = useState('')

  const handleSkip = useCallback(() => {
    trackOffbaseAction('skipped', appId)
    dismiss('skipped')
  }, [dismiss, appId])

  return (
    <CollapsibleChatInputSection
      title="What would you like to do instead?"
      onDismiss={handleSkip}
      dismissLabel="Skip"
    >
      <div className="airo-input-choice-list airo-input-choice-list__surface">
        <ChoiceListOtherRow
          letter="1"
          otherPlaceholder="Describe what you had in mind..."
          otherAriaLabel="Describe what you had in mind"
          disabled={false}
          optionDividers={false}
          suppressBottomBorder
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={(trimmed) => {
            sendUserMessage(trimmed, { isActionRequest: true })
            trackOffbaseAction('submit', appId)
            dismiss('offbase')
          }}
          submitLabel="Submit"
          submitTestId="fbf-offbase-submit"
        />
      </div>
    </CollapsibleChatInputSection>
  )
}

export function FirstBuildFeedbackPanel({ feedback, appId }: Props): React.ReactNode {
  const { step, advance, dismiss } = feedback
  const sendUserMessage = useSendUserMessage()
  const shownAtRef = useRef(Date.now())

  useEffect(() => {
    trackFeedbackShown(appId)
  }, [appId])

  const handleSkip = useCallback(() => {
    trackFeedbackResponse('skipped', shownAtRef.current, appId)
    dismiss('skipped')
  }, [dismiss, appId])

  if (step === 'prompt') {
    return (
      <CollapsibleChatInputSection
        title="Is this what you imagined?"
        onDismiss={handleSkip}
        dismissLabel="Skip"
        data-testid="first-build-feedback-panel"
        footer={
          <div className="flex justify-end border-t border-border pt-1">
            <Button design="control" size="sm" text="Skip" onClick={handleSkip} />
          </div>
        }
      >
        <AskQuestionChoicePanel
          questions={[PROMPT_QUESTION]}
          allowOtherGlobal={false}
          rootOtherPlaceholder=""
          otherAriaLabel=""
          backLabel="Back"
          submitLabel="Submit"
          disabled={false}
          hideQuestion={true}
          ariaLabel="Is this what you imagined?"
          onStepChange={() => {}}
          onActiveStepChange={() => {}}
          onComplete={(selections) => {
            const raw = selections['0']
            if (raw === null) {
              trackFeedbackResponse('skipped', shownAtRef.current, appId)
              dismiss('skipped')
              return
            }
            const chipIndex = typeof raw === 'string' ? parseInt(raw, 10) - 1 : -1
            if (chipIndex === 0) {
              trackFeedbackResponse('magical', shownAtRef.current, appId)
              dismiss('magical')
            } else if (chipIndex === 1) {
              trackFeedbackResponse('close', shownAtRef.current, appId)
              advance('close_followup')
            } else if (chipIndex === 2) {
              trackFeedbackResponse('offbase', shownAtRef.current, appId)
              advance('offbase_followup')
            }
          }}
        />
      </CollapsibleChatInputSection>
    )
  }

  if (step === 'close_followup') {
    return (
      <CloseFollowupStep
        dismiss={dismiss}
        sendUserMessage={sendUserMessage}
        appId={appId}
      />
    )
  }

  if (step === 'offbase_followup') {
    return (
      <OffbaseFollowupStep
        dismiss={dismiss}
        sendUserMessage={sendUserMessage}
        appId={appId}
      />
    )
  }

  return null
}
