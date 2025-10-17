import { ArrowRightIcon } from '@heroicons/react/24/outline'
import { generateClickEID, logClickEvent } from '@/utils/instrumentation'
import { HeroExamplesProps, Example } from './types'
import { useEffect, useState } from 'react'
import clsx from 'clsx'

export default function HeroExamples({ onExampleClick }: HeroExamplesProps) {
  const [visibleItems, setVisibleItems] = useState<boolean[]>([])
  const examples: Example[] = [
    {
      title: "Fitness Studio Website",
      prompt: "I need a modern website for my local fitness studio. We offer personal training, group classes, and nutrition coaching. I want members to be able to book classes online, view schedules, and access workout plans.",
      slug: "fitness_studio"
    },
    {
      title: "Local Food Truck Landing Page",
      prompt: "Event venue booking platform with calendar integration, space galleries, pricing calculator, and vendor coordination. Vibrant colors.",
      slug: "food_truck"
    },
    {
      title: "Freelancer Portfolio Site",
      prompt: "Build a professional portfolio website for my graphic design services. I need a homepage, portfolio gallery, about page, services overview, and contact form. Make it clean and modern to showcase my work.",
      slug: "freelancer_portfolio"
    },
    {
      title: "Small Business Directory",
      prompt: "Create a simple directory website for local businesses in my town. Users should be able to browse by category, search businesses, view business profiles with contact info, and submit new business listings.",
      slug: "business_directory"
    },
    {
      title: "Web Agency Website",
      prompt: "Website about a web agency specialized in creating beautiful handcrafted websites. Dark theme with vibrant color accent. Keep it low on images, rely on one impactful image and then use icons. Never use emojis.",
      slug: "web_agency"
    },
    {
      title: "Creative Canvas Portfolio",
      prompt: "Stunning portfolio site for a graphic designer with image galleries, client testimonials, and project case studies.",
      slug: "creative_portfolio"
    },
  ]

  useEffect(() => {
    // Create random order array
    const indices = Array.from({ length: examples.length }, (_, i) => i)
    const shuffled = [...indices].sort(() => Math.random() - 0.5)

    // Initialize visibility array
    setVisibleItems(new Array(examples.length).fill(false))

    // Stagger animations with shorter delays
    shuffled.forEach((index, orderIndex) => {
      const delay = orderIndex * 80 + Math.random() * 50
      setTimeout(() => {
        setVisibleItems(prev => {
          const newVisible = [...prev]
          newVisible[index] = true
          return newVisible
        })
      }, delay)
    })
  }, [examples.length])

  return (
    <div className="text-center mb-8 mt-1">
      <div className="flex flex-wrap justify-center gap-2 max-w-4xl mx-auto">
        {examples.map((example, index) => (
          <button
            key={example.title}
            onClick={() => {
              onExampleClick(example.prompt);
              logClickEvent('homepage.examples.example')();
              logClickEvent(`homepage.examples.example_${example.slug}`)();
            } }
            className={clsx(
              'group bg-ai-dark-transparent px-4 py-1 rounded-lg hover:shadow-md transition-all duration-300 text-sm cursor-pointer transform',
              visibleItems[index]
                ? 'translate-y-0 opacity-100 scale-100'
                : 'translate-y-2 opacity-0 scale-98'
            )}
            style={{
              transition: visibleItems[index] ? 'all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)' : 'none'
            }}
          >
            <span className="font-medium transition-colors">
              {example.title}
            </span>
            <ArrowRightIcon className="w-3 h-3 ml-1 inline opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </button>
        ))}
      </div>
    </div>
  )
}
