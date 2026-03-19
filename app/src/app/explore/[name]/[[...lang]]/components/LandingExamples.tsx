'use client'

import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRightIcon } from '@heroicons/react/24/outline'

import { generateClickEID, logClickEvent } from '@/utils/instrumentation'
import { LandingExample } from './types'

interface LandingExamplesProps {
  examples: LandingExample[]
  onExampleClick: (prompt: string) => void
  slug: string
}

export default function LandingExamples({ examples, onExampleClick, slug }: LandingExamplesProps) {
  const [visibleItems, setVisibleItems] = useState<boolean[]>([])

  const displayedExamples = useMemo(() => {
    const featured = examples.filter(ex => ex.featured)
    const nonFeatured = examples.filter(ex => !ex.featured)
    const shuffled = [...nonFeatured].sort(() => Math.random() - 0.5)
    const selected = shuffled.slice(0, 8 - featured.length)
    return [...featured, ...selected].sort(() => Math.random() - 0.5)
  }, [examples])

  useEffect(() => {
    if (displayedExamples.length === 0) {return}

    const indices = Array.from({ length: displayedExamples.length }, (_, i) => i)
    const shuffled = [...indices].sort(() => Math.random() - 0.5)

    setVisibleItems(new Array(displayedExamples.length).fill(false))

    const timerIds: NodeJS.Timeout[] = []

    shuffled.forEach((index, orderIndex) => {
      timerIds.push(setTimeout(() => {
        setVisibleItems(prev => {
          const next = [...prev]
          next[index] = true
          return next
        })
      }, orderIndex * 80 + Math.random() * 50))
    })

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
            data-testid="landing-suggestion-button"
            data-eid={generateClickEID(`landing-${slug}.examples.${example.slug ?? index}`)}
            onClick={() => {
              onExampleClick(example.prompt);
              logClickEvent(`landing-${slug}.examples.example`)();
            }}
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
