import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import ArrowRightIcon from '@ux/icon/arrow-right'
import { text } from '@ux/text'

import RebuildDesignModal from '@/app/[market]/components/RebuildDesignModal'
import { Example, HeroExamplesProps, LOGO_DESIGNER_TEMPLATE } from '@/app/[market]/components/types'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { JourneyTracker } from '@/lib/journeyTracker'
import { persistPendingDesignChoice, type RebuildModalDirection } from '@/lib/rebuild-design-choice'
import { generateClickEID, logClickEvent } from '@/utils/instrumentation'

const REBUILD_SITE_SLUG = 'rebuild_site'

// Appended to the base rebuild prompt so the chosen direction reaches InitialAgent even
// when the develop intake form is off. Base prompt is preserved for rebuild detection.
const REBUILD_PROMPT_HINTS: Record<RebuildModalDirection, string> = {
  modernize: 'Reimagine it with a fresh, modern design.',
  'keep-similar': 'Keep the same overall look and feel as my current site.',
}

export default function HeroExamples({ className, theme = 'dark', onExampleClick, onTemplateChange }: HeroExamplesProps) {
  const t = useTranslations()
  const { isAuthenticated } = useAuthContext()
  const { logAnalytics } = useAnalytics({
    experimentId: EXPERIMENT_IDS.homepageEngagement,
    baseData: { isAuthenticated },
  })
  const [visibleItems, setVisibleItems] = useState<boolean[]>([])
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false)
  const rebuildBasePromptRef = useRef('')
  const showLogoButton = Boolean(useSwitchboard('appbuilder-homepage-make-logo-button'))
  const { isBelowSmBreakpoint } = useBreakpoints();

  function logExampleClick(example: Example) {
    logAnalytics('homepage.template.click', { templateSlug: example.slug })
    logClickEvent('homepage.examples.example')()
    logClickEvent(`homepage.examples.example_${example.slug}`)()
    JourneyTracker.current()?.trackMilestone('homepage_example_selected', { slug: example.slug })
  }

  function handleExampleButtonClick(example: Example) {
    // Rebuild defers prompt entry until the user picks a design direction in the modal.
    if (example.slug === REBUILD_SITE_SLUG) {
      logExampleClick(example)
      rebuildBasePromptRef.current = example.prompt
      setRebuildModalOpen(true)
      return
    }
    onExampleClick(example.prompt)
    logExampleClick(example)
  }

  function handleRebuildDesignSelect(direction: RebuildModalDirection, url: string) {
    persistPendingDesignChoice(direction)
    const urlPart = url ? ` at ${url}` : ''
    onExampleClick(`${rebuildBasePromptRef.current}${urlPart}. ${REBUILD_PROMPT_HINTS[direction]}`)
    setRebuildModalOpen(false)
  }

  const examples = useMemo<Example[]>(() => [
    // Website examples
    {
      title: t('builder_homepage_examples_fitness_title'),
      prompt: t('builder_homepage_examples_fitness_prompt'),
      slug: "fitness_studio"
    },
    {
      title: t('builder_homepage_examples_foodtruck_title'),
      prompt: t('builder_homepage_examples_foodtruck_prompt'),
      slug: "food_truck"
    },
    {
      title: t('builder_homepage_examples_freelancer_title'),
      prompt: t('builder_homepage_examples_freelancer_prompt'),
      slug: "freelancer_portfolio"
    },
    {
      title: t('builder_homepage_examples_business_title'),
      prompt: t('builder_homepage_examples_business_prompt'),
      slug: "business_directory"
    },
    {
      title: t('builder_homepage_examples_agency_title'),
      prompt: t('builder_homepage_examples_agency_prompt'),
      slug: "web_agency"
    },
    {
      title: t('builder_homepage_examples_creative_title'),
      prompt: t('builder_homepage_examples_creative_prompt'),
      slug: "creative_portfolio"
    },
    {
      title: t('builder_homepage_examples_realestate_title'),
      prompt: t('builder_homepage_examples_realestate_prompt'),
      slug: "real_estate"
    },
    {
      title: t('builder_homepage_examples_coffeeshop_title'),
      prompt: t('builder_homepage_examples_coffeeshop_prompt'),
      slug: "coffee_shop"
    },
    {
      title: t('builder_homepage_examples_petgrooming_title'),
      prompt: t('builder_homepage_examples_petgrooming_prompt'),
      slug: "pet_grooming"
    },
    {
      title: t('builder_homepage_examples_yoga_title'),
      prompt: t('builder_homepage_examples_yoga_prompt'),
      slug: "yoga_studio"
    },
    // Commerce examples
    {
      title: t('builder_homepage_examples_onlinestore_title'),
      prompt: t('builder_homepage_examples_onlinestore_prompt'),
      slug: "online_store"
    },
    // E-commerce and services
    {
      title: t('builder_homepage_examples_boutique_title'),
      prompt: t('builder_homepage_examples_boutique_prompt'),
      slug: "boutique_store"
    },
    {
      title: t('builder_homepage_examples_pressurewashing_title'),
      prompt: t('builder_homepage_examples_pressurewashing_prompt'),
      slug: "pressure_washing"
    },
    {
      title: t('builder_homepage_examples_clientdashboard_title'),
      prompt: t('builder_homepage_examples_clientdashboard_prompt'),
      slug: "client_dashboard"
    },
    {
      title: t('builder_homepage_examples_restaurant_title'),
      prompt: t('builder_homepage_examples_restaurant_prompt'),
      slug: "restaurant"
    },
    // Web presentations and other formats
    {
      title: t('builder_homepage_examples_productlaunch_title'),
      prompt: t('builder_homepage_examples_productlaunch_prompt'),
      slug: "product_launch"
    },
    {
      title: t('builder_homepage_examples_countdown_title'),
      prompt: t('builder_homepage_examples_countdown_prompt'),
      slug: "event_countdown"
    },
    {
      title: t('builder_homepage_examples_recipecollection_title'),
      prompt: t('builder_homepage_examples_recipecollection_prompt'),
      slug: "recipe_collection"
    },
    {
      title: t('builder_homepage_examples_presentation_title'),
      prompt: t('builder_homepage_examples_presentation_prompt'),
      slug: "presentation_slides"
    },
    // Skill-based prompts
    {
      title: t('builder_homepage_examples_rebuild_title'),
      prompt: t('builder_homepage_examples_rebuild_prompt'),
      slug: "rebuild_site",
      featured: true
    }
  ], [])

  // Select 8 examples: featured ones + random selection from others
  const [displayedExamples, setDisplayedExamples] = useState<Example[]>([])

  useEffect(() => {
    const featured = examples.filter(ex => ex.featured)
    const nonFeatured = examples.filter(ex => !ex.featured)
    const shuffledNonFeatured = [...nonFeatured].sort(() => Math.random() - 0.5)
    const selectedNonFeatured = shuffledNonFeatured.slice(0, 8 - featured.length)
    const combined = [...featured, ...selectedNonFeatured]
    // Shuffle for random display order
    const finalShuffled = combined.sort(() => Math.random() - 0.5)
    setDisplayedExamples(finalShuffled)
  }, [])

  useEffect(() => {
    if (displayedExamples.length === 0) return

    // Create random order array
    const indices = Array.from({ length: displayedExamples.length }, (_, i) => i)
    const shuffled = [...indices].sort(() => Math.random() - 0.5)

    // Initialize visibility array
    setVisibleItems(new Array(displayedExamples.length).fill(false))

    // Store timer IDs for cleanup
    const timerIds: NodeJS.Timeout[] = []

    // Stagger animations with shorter delays
    shuffled.forEach((index, orderIndex) => {
      const delay = orderIndex * 80 + Math.random() * 50
      const timerId = setTimeout(() => {
        setVisibleItems(prev => {
          const newVisible = [...prev]
          newVisible[index] = true
          return newVisible
        })
      }, delay)
      timerIds.push(timerId)
    })

    // Cleanup function to clear all timers
    return () => {
      timerIds.forEach(timerId => clearTimeout(timerId))
    }
  }, [displayedExamples.length])

  return (
    <div className={clsx('text-center', className)}>
      <text.p size={isBelowSmBreakpoint ? -1 : 0} className="opacity-50 mb-2">
        {t('builder_homepage_examples_try_these_intro', undefined, 'Describe your own idea above, or try one of these:')}
      </text.p>
      <div className="flex flex-wrap justify-center gap-1 max-w-4xl mx-auto">
        {showLogoButton && (
          <button
            data-testid="homepage-logo-suggestion-button"
            data-eid={generateClickEID('homepage.examples.example_make_logo')}
            onClick={() => {
              onExampleClick(t('builder_homepage_examples_logo_prompt', undefined, 'Make me a logo for: '));
              onTemplateChange?.(LOGO_DESIGNER_TEMPLATE);
              logAnalytics('homepage.template.click', { templateSlug: LOGO_DESIGNER_TEMPLATE })
              logClickEvent('homepage.examples.example')();
              logClickEvent('homepage.examples.example_make_logo')();
              JourneyTracker.current()?.trackMilestone('homepage_example_selected', { slug: 'make_logo' })
            }}
            className={clsx(
              'group px-2 py-0.5 rounded-lg hover:shadow-md transition-all duration-300 text-sm cursor-pointer transform translate-y-0 opacity-100 scale-100',
              theme === 'dark' ? 'bg-ai-dark-transparent' : 'bg-light-purple hover:bg-light-purple-solid'
            )}
          >
            <span className="font-medium transition-colors">
              {t('builder_homepage_examples_logo_title', undefined, 'Make me a logo')}
            </span>
            <ArrowRightIcon className="w-1.5 h-1.5 ms-1 inline opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all rtl:scale-x-[-1]" />
          </button>
        )}
        {displayedExamples.map((example, index) => (
          <button
            key={example.title}
            data-testid="homepage-suggestion-button"
            data-eid={generateClickEID(`homepage.examples.example_${example.slug}`)}
            onClick={() => handleExampleButtonClick(example)}
            className={clsx(
              'group px-2 py-0.5 rounded-lg hover:shadow-md transition-all duration-300 text-sm cursor-pointer transform',
              theme === 'dark' ? 'bg-ai-dark-transparent' : 'bg-light-purple hover:bg-light-purple-solid',
              visibleItems[index]
                ? 'translate-y-0 opacity-100 scale-100'
                : 'translate-y-1 opacity-0 scale-98'
            )}
            style={{
              transition: visibleItems[index]
                ? 'transform 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55), opacity 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)'
                : 'none'
            }}
          >
            <span className="font-medium transition-colors">
              {example.title}
            </span>
            <ArrowRightIcon className="w-1.5 h-1.5 ms-1 inline opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all rtl:scale-x-[-1]" />
          </button>
        ))}
      </div>
      <RebuildDesignModal
        open={rebuildModalOpen}
        onClose={() => setRebuildModalOpen(false)}
        onSelect={handleRebuildDesignSelect}
      />
    </div>
  )
}
