import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRightIcon } from '@heroicons/react/24/outline'
import { text } from '@ux/text'

import { Example, HeroExamplesProps } from '@/app/components/types'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID, logClickEvent } from '@/utils/instrumentation'

export default function HeroExamples({ onExampleClick }: HeroExamplesProps) {
  const t = useTranslations();
  const { isAuthenticated } = useAuthContext()
  const { logAnalytics } = useAnalytics({
    experimentId: EXPERIMENT_IDS.homepageEngagement,
    baseData: { isAuthenticated },
  })
  const [visibleItems, setVisibleItems] = useState<boolean[]>([])

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
    <div className="text-center mb-4 mt-3">
      <text.p size={0} className="opacity-50 mb-2">
        {t('builder_homepage_examples_try_these_intro', undefined, 'Describe your own idea above, or try one of these:')}
      </text.p>
      <div className="flex flex-wrap justify-center gap-1 max-w-4xl mx-auto">
        {displayedExamples.map((example, index) => (
          <button
            key={example.title}
            data-testid="homepage-suggestion-button"
            data-eid={generateClickEID(`homepage.examples.example_${example.slug}`)}
            onClick={() => {
              onExampleClick(example.prompt);
              logAnalytics('homepage.template.click', { templateSlug: example.slug })
              logClickEvent('homepage.examples.example')();
              logClickEvent(`homepage.examples.example_${example.slug}`)();
            } }
            className={clsx(
              'group bg-ai-dark-transparent px-2 py-0.5 rounded-lg hover:shadow-md transition-all duration-300 text-sm cursor-pointer transform',
              visibleItems[index]
                ? 'translate-y-0 opacity-100 scale-100'
                : 'translate-y-1 opacity-0 scale-98'
            )}
            style={{
              transition: visibleItems[index] ? 'all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)' : 'none'
            }}
          >
            <span className="font-medium transition-colors">
              {example.title}
            </span>
            <ArrowRightIcon className="w-1.5 h-1.5 ml-1 inline opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </button>
        ))}
      </div>
    </div>
  )
}
