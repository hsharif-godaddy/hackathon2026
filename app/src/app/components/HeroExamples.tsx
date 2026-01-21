import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRightIcon } from '@heroicons/react/24/outline'

import { Example,HeroExamplesProps } from '@/app/components/types'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID, logClickEvent } from '@/utils/instrumentation'

export default function HeroExamples({ onExampleClick }: HeroExamplesProps) {
  const t = useTranslations();
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
    // Game and interactive experiences
    {
      title: t('builder_homepage_examples_idleclicker_title'),
      prompt: t('builder_homepage_examples_idleclicker_prompt'),
      slug: "idle_game"
    },
    {
      title: t('builder_homepage_examples_memorygame_title'),
      prompt: t('builder_homepage_examples_memorygame_prompt'),
      slug: "memory_game"
    },
    {
      title: t('builder_homepage_examples_triviaquiz_title'),
      prompt: t('builder_homepage_examples_triviaquiz_prompt'),
      slug: "trivia_quiz"
    },
    {
      title: t('builder_homepage_examples_drawingapp_title'),
      prompt: t('builder_homepage_examples_drawingapp_prompt'),
      slug: "drawing_app"
    },
    {
      title: t('builder_homepage_examples_wordpuzzle_title'),
      prompt: t('builder_homepage_examples_wordpuzzle_prompt'),
      slug: "word_puzzle"
    },
    // Web presentations and other formats
    {
      title: t('builder_homepage_examples_productlaunch_title'),
      prompt: t('builder_homepage_examples_productlaunch_prompt'),
      slug: "product_launch"
    },
    {
      title: t('builder_homepage_examples_resume_title'),
      prompt: t('builder_homepage_examples_resume_prompt'),
      slug: "interactive_resume"
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
  ], []) // eslint-disable-line react-hooks/exhaustive-deps

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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="text-center mb-4 mt-0.5">
      <div className="flex flex-wrap justify-center gap-1 max-w-4xl mx-auto">
        {displayedExamples.map((example, index) => (
          <button
            key={example.title}
            data-eid={generateClickEID(`homepage.examples.example_${example.slug}`)}
            onClick={() => {
              onExampleClick(example.prompt);
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
