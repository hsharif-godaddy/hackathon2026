import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ArrowRightIcon } from '@heroicons/react/24/outline'
import { HeroExamplesProps, Example } from '@/app/components/types'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID, logClickEvent } from '@/utils/instrumentation'

export default function HeroExamples({ onExampleClick }: HeroExamplesProps) {
  const t = useTranslations();
  const [visibleItems, setVisibleItems] = useState<boolean[]>([])
  const examples: Example[] = [
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
  ]

  useEffect(() => {
    // Create random order array
    const indices = Array.from({ length: examples.length }, (_, i) => i)
    const shuffled = [...indices].sort(() => Math.random() - 0.5)

    // Initialize visibility array
    setVisibleItems(new Array(examples.length).fill(false))

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
  }, [examples.length])

  return (
    <div className="text-center mb-4 mt-0.5">
      <div className="flex flex-wrap justify-center gap-1 max-w-4xl mx-auto">
        {examples.map((example, index) => (
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
