import clsx from 'clsx'
import { forwardRef, useImperativeHandle } from 'react'
import { FormattedMessage } from 'react-intl'
import Box from '@ux/box'
import SendIcon from '@ux/icon/send'
import { text } from '@ux/text'

import DesignFileUpload, { DesignFileUploadCard } from '@/app/[market]/components/DesignFileUpload'
import TemplateSelector from '@/app/[market]/components/TemplateSelector'
import type { HeroSectionProps, HeroSectionRef } from '@/app/[market]/components/types'
import { AnimatedDisclaimer } from '@/components/home/AnimatedDisclaimer'
import { HeroBenefits } from '@/components/home/HeroBenefits'
import { HeroScrollButton } from '@/components/home/HeroScrollButton'
import { PromptCharCount } from '@/components/home/PromptCharCount'
import { PromptErrorAlert } from '@/components/home/PromptErrorAlert'
import { SpeechToggleButton } from '@/components/home/SpeechToggleButton'
import { SubmitInitialPrompt } from '@/components/home/SubmitInitialPrompt'
import ExamplesSection from '@/experiments/homepage-engagement-variations/abstract_animation/HeroExamples'
import { HOMEPAGE_ENGAGEMENT_COHORT_IDS } from '@/experiments/homepage-engagement-variations/cohort-ids'
import { useAnimatedPlaceholder } from '@/hooks/home/useAnimatedPlaceholder'
import { useHeroPromptState } from '@/hooks/home/useHeroPromptState'
import { useTextareaAutoResize } from '@/hooks/home/useTextareaAutoResize'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useImpression } from '@/hooks/useImpression'

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
  useImpression('homepage.firstprompt.view', { customProperties: { variant: HOMEPAGE_ENGAGEMENT_COHORT_IDS.ABSTRACT_ANIMATION } })
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
  } = useHeroPromptState({ promptText, setPromptText, onStartBuilding, isLoading, error, setError })

  const promptTextareaRef = useTextareaAutoResize({ displayText })
  const animatedPlaceholder = useAnimatedPlaceholder({ isFocused, displayText })

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
        {headingText || (
          <FormattedMessage
            id="builder_homepage_hero_content_headline"
            defaultMessage="Describe <idea>your idea</idea>. Get a <site>live website</site> in minutes."
            values={{
              idea: (chunks) => <span className="text-ai-light">{chunks}</span>,
              site: (chunks) => <span className="text-ai">{chunks}</span>,
            }}
          />
        )}
      </text.h1>

      {subheadingText ? (
        <text.p
          size={2}
          className='max-w-xl mx-auto !font-thin text-center text-pretty'
        >
          {subheadingText}
        </text.p>
      ) : (
        <HeroBenefits />
      )}

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
                dir="auto"
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
          <AnimatedDisclaimer isVisible={isFocused || isListening || displayText.trim().length > 0} />

          <ExamplesSection
            onExampleClick={onExampleClick}
            onTemplateChange={onTemplateChange}
          />

          <HeroScrollButton sectionId="start-section" />
        </Box>
      </div>
    </Box>
  )
})

HeroSection.displayName = 'HeroSection'

export default HeroSection
