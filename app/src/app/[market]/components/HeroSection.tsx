import clsx from 'clsx'
import { forwardRef, useImperativeHandle } from 'react'
import { FormattedMessage } from 'react-intl'
import Box from '@ux/box'
import Button from '@ux/button'
import SendIcon from '@ux/icon/send'
import { text } from '@ux/text'

import ExamplesSection from '@/app/[market]/components/HeroExamples'
import TemplateSelector from '@/app/[market]/components/TemplateSelector'
import { HeroScrollButton } from '@/components/home/HeroScrollButton'
import { PromptCharCount } from '@/components/home/PromptCharCount'
import { PromptErrorAlert } from '@/components/home/PromptErrorAlert'
import { SpeechToggleButton } from '@/components/home/SpeechToggleButton'
import { SubmitInitialPrompt } from '@/components/home/SubmitInitialPrompt'
import { HOMEPAGE_ENGAGEMENT_COHORT_IDS } from '@/experiments/homepage-engagement-variations/cohort-ids'
import { useAnimatedPlaceholder } from '@/hooks/home/useAnimatedPlaceholder'
import { useHeroPromptState } from '@/hooks/home/useHeroPromptState'
import { useTextareaAutoResize } from '@/hooks/home/useTextareaAutoResize'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useImpression } from '@/hooks/useImpression'
import { useRTL } from '@/hooks/useRTL'
import { useTranslations } from '@/hooks/useTranslations'
import DesignFileUpload, { DesignFileUploadCard } from './DesignFileUpload'
import { HeroSectionProps, HeroSectionRef } from './types'

const HeroSection = forwardRef<HeroSectionRef, HeroSectionProps>(({
  promptText,
  setPromptText,
  onStartBuilding,
  isLoading,
  error,
  setError,
  onExampleClick,
  selectedTemplate = 'default',
  onTemplateChange,
  headingText,
  subheadingText,
  uploadedFile,
  onFileChange,
}, ref) => {
  useImpression('homepage.firstprompt.view', { customProperties: { variant: HOMEPAGE_ENGAGEMENT_COHORT_IDS.ORIGINAL } })
  const isRTL = useRTL()
  const t = useTranslations()
  const { isBelowSmBreakpoint, isMdBreakpoint } = useBreakpoints()

  const {
    isTemplateSelectorEnabled,
    isTyping,
    displayText,
    isFocused,
    firstInputTimeRef,
    handleTextareaChange,
    handleTextareaKeyDown,
    handleTextareaFocus,
    handleTextareaBlur,
    handleStartBuilding,
    handleSpeechToggle,
    typeText,
    isListening,
    isSpeechSupported,
    onPromptBoxMouseEnter,
    onPromptBoxMouseLeave,
    bytesRemaining,
    isOverLimit,
  } = useHeroPromptState({ promptText, setPromptText, onStartBuilding, isLoading, error, setError, isRTL })

  const promptTextareaRef = useTextareaAutoResize({ displayText })
  const animatedPlaceholder = useAnimatedPlaceholder({ isFocused, displayText, isRTL })

  useImperativeHandle(ref, () => ({
    typeText,
    getFirstInputTime: () => firstInputTimeRef.current
  }), [typeText])

  return (
    <Box className="flex flex-col gap-2 md:gap-3 px-2 sm:px-3 lg:px-4 pt-12 min-h-[calc(100vh-3rem)] items-center justify-center">
      <text.h1
        as='heading'
        size={isBelowSmBreakpoint ? 2 : isMdBreakpoint ? 3 : 4}
        className="text-center max-w-screen-lg text-balance"
      >
        {headingText || t('builder_homepage_hero_title')}
      </text.h1>

      <text.p
        size={2}
        className='max-w-xl mx-auto !font-thin text-center text-pretty'
      >
        {subheadingText || t('builder_homepage_hero_text')}
      </text.p>

      <PromptErrorAlert error={error} onDismiss={() => setError(null)} />

      <div className="w-full max-w-2xl mx-auto my-2 md:my-4">
        <Box gap={isMdBreakpoint ? 'md' : 'lg'}>
          <div
            className={clsx('relative transition-all duration-300 ease-out glowing-input', {
              'glowing-input--disabled': isLoading
            })}
            onMouseEnter={onPromptBoxMouseEnter}
            onMouseLeave={onPromptBoxMouseLeave}
          >
            <Box
              className="rounded-2xl! p-2 transition-all duration-300 ease-out bg-intents-ux-box-backgroundColor outline-4 outline-solid outline-[rgba(0,0,0,0.15)]"
              elevation="float"
              gap={isBelowSmBreakpoint ? 'sm' : 'md'}
            >
              {/* Uploaded File Card */}
              {uploadedFile && onFileChange && (
                <DesignFileUploadCard
                  uploadedFile={uploadedFile}
                  onRemove={() => onFileChange(null)}
                  disabled={isLoading}
                />
              )}

              {/* Prompt Textarea */}
              <textarea
                ref={promptTextareaRef}
                data-testid="homepage-prompt-input"
                aria-describedby="prompt-char-count"
                value={displayText}
                onChange={handleTextareaChange}
                onKeyDown={handleTextareaKeyDown}
                onFocus={handleTextareaFocus}
                onBlur={handleTextareaBlur}
                dir={isRTL ? 'rtl' : 'ltr'}
                disabled={isLoading || isListening}
                className="w-full min-h-6 md:min-h-8 max-h-20 md:max-h-24 bg-transparent overflow-y-auto text-md sm:text-xl font-light resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-300"
                placeholder={isTyping ? "" : animatedPlaceholder}
              />

              <Box orientation="horizontal" blockAlignChildren="spaceBetween" inlineAlignChildren="end">
                {/* Character Counter */}
                <PromptCharCount bytesRemaining={bytesRemaining} isOverLimit={isOverLimit} />
                {/* Action Buttons Container */}
                <Box orientation="horizontal" gap="sm">
                  {onFileChange && (
                    <DesignFileUpload
                      uploadedFile={uploadedFile ?? null}
                      onFileChange={onFileChange}
                      disabled={isLoading}
                    />
                  )}
                  {isSpeechSupported && (
                    <SpeechToggleButton
                      isListening={isListening}
                      isLoading={isLoading}
                      isTyping={isTyping}
                      onToggle={handleSpeechToggle}
                    />
                  )}
                  <SubmitInitialPrompt
                    onClick={handleStartBuilding}
                    disabled={!displayText.trim() || isLoading || isTyping || isOverLimit}
                    isLoading={isLoading}
                    icon={<SendIcon />}
                  />
                </Box>
              </Box>
            </Box>
          </div>

          {/* Template Selector */}
          {/* Template selector is used for internal experiments in TLA accounts only; customers won't see it. */}
          {isTemplateSelectorEnabled && onTemplateChange && (
            <TemplateSelector selectedTemplate={selectedTemplate} onTemplateChange={onTemplateChange} />
          )}

          {/* Disclaimer */}
          <text.p size={-1} className='max-w-lg mx-auto opacity-40 mb-2 md:mb-4 text-center'>
            <FormattedMessage
              id='builder_homepage_hero_disclaimer'
              values={{
                terms: (
                  <Button
                    design="inline"
                    size="sm"
                    external
                    href="https://www.godaddy.com/legal/agreements/ai-terms-of-use"
                    className="!text-intents-ux-boxHighContrast-foregroundColor"
                    text={t('builder_homepage_hero_disclaimer_terms')}
                  />
                ),
                privacy_policy: (
                  <Button
                    design="inline"
                    size="sm"
                    external
                    href="https://www.godaddy.com/legal/agreements/privacy-policy"
                    className="!text-intents-ux-boxHighContrast-foregroundColor"
                    text={t('builder_homepage_hero_disclaimer_privacy')}
                  />
                )
              }}
            />
          </text.p>

          <ExamplesSection
            onExampleClick={onExampleClick}
            onTemplateChange={onTemplateChange}
          />

          <HeroScrollButton sectionId="infra-section" />
        </Box>
      </div>
    </Box>
  )
})

HeroSection.displayName = 'HeroSection'

export default HeroSection
