'use client'

import { useId, useState } from 'react'
import Box from '@ux/box'
import { text } from '@ux/text'

import PageSection from '@/components/layout/PageSection'
import { LandingFAQData } from './types'

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const id = useId()
  const panelId = `${id}-panel`
  const buttonId = `${id}-button`

  return (
    <div className="border-b border-[rgba(255,255,255,0.1)]">
      <button
        id={buttonId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-3 flex items-center justify-between text-left cursor-pointer group"
      >
        <text.p size={1} className="!font-medium pr-2">{question}</text.p>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden="true"
          className={`w-3 h-3 shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        className={`overflow-hidden transition-all duration-300 ${
          isOpen ? 'max-h-96 pb-3' : 'max-h-0'
        }`}
      >
        <text.p size={1} className="!font-thin opacity-80">{answer}</text.p>
      </div>
    </div>
  )
}

export default function LandingFAQ({ title, items }: LandingFAQData) {
  return (
    <PageSection>
      <Box className="max-w-screen-md mx-auto" gap="lg">
        <text.h2 as="heading" size={2} className="text-center">{title}</text.h2>
        <div>
          {items.map(function renderFAQ(item) {
            return <FAQItem key={item.question} question={item.question} answer={item.answer} />
          })}
        </div>
      </Box>
    </PageSection>
  )
}
