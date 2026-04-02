'use client'

import { motion, useInView } from 'framer-motion'
import React, { useEffect, useRef, useState } from 'react'
import text from '@ux/text'

import PageSection from '@/components/layout/PageSection'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

const NUMBER_OF_FAQS = 12;

interface AnimatedFAQItemProps {
  index: number
  onToggle: (index: number, opened: boolean) => void
}

function AnimatedFAQItem({ index, onToggle }: AnimatedFAQItemProps) {
  const t = useTranslations();
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0.1, margin: '0px 0px -100px 0px' })

  function toggle() {
    const nextOpen = !isOpen
    setIsOpen(nextOpen)
    onToggle(index, nextOpen)
  }

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{
        type: 'spring',
        visualDuration: 0.4,
        bounce: 0.2,
        delay: index * 0.1
      }}
      itemScope
      itemProp="mainEntity"
      itemType="https://schema.org/Question"
    >
      <div className="overflow-hidden">
        <button
          onClick={toggle}
          className="w-full text-left p-0 flex items-center justify-between hover:cursor-pointer"
          aria-expanded={isOpen}
          aria-controls={`faq-answer-${index}`}
          data-eid={generateClickEID(`homepage.faq.item_${index + 1}`)}
        >
          <text.h3 as="heading" size={-2} itemProp="name" className="!font-normal">
            {t(`builder_faq_${index + 1}_question`)}
          </text.h3>
          <motion.svg
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="size-3 flex-shrink-0 ml-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </motion.svg>
        </button>
        <motion.div
          id={`faq-answer-${index}`}
          initial={false}
          animate={{
            height: isOpen ? 'auto' : 0,
            opacity: isOpen ? 1 : 0
          }}
          transition={{
            height: { duration: 0.3, ease: 'easeInOut' },
            opacity: { duration: 0.2, ease: 'easeInOut' }
          }}
          className="overflow-hidden"
          itemScope
          itemProp="acceptedAnswer"
          itemType="https://schema.org/Answer"
        >
          <div className="pt-2 pr-6">
            <text.p size={0} itemProp="text">
              {t(`builder_faq_${index + 1}_answer`)}
            </text.p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}

export default function FAQSection() {
  const t = useTranslations();
  const { logAnalytics } = useAnalytics({ experimentId: EXPERIMENT_IDS.homepageEngagement })
  const sectionRef = useRef<HTMLDivElement>(null)
  const isFaqSectionInView = useInView(sectionRef, { once: true, amount: 0.2 })
  const hasLoggedViewRef = useRef(false)
  const openCountRef = useRef(0)

  useEffect(() => {
    if (!isFaqSectionInView || hasLoggedViewRef.current) {
      return
    }
    hasLoggedViewRef.current = true
    const msFromPageLoad = Math.round(performance.now())
    logAnalytics(
      'homepage.faq.view',
      {
        msFromPageLoad,
      },
      {
        kind: 'impression',
        eid: 'homepage.faq.view',
        impressionProps: {
          msFromPageLoad,
        },
      },
    )
  }, [isFaqSectionInView, logAnalytics])

  function handleToggle(index: number, opened: boolean) {
    if (opened) {
      openCountRef.current += 1
    }
    logAnalytics(`homepage.faq.item_${opened ? 'opened' : 'closed'}`, {
      faqIndex: index + 1,
      totalOpened: openCountRef.current,
    })
  }

  return(
    <PageSection data-testid="faq-section">
      <div ref={sectionRef} className="max-w-screen-lg mx-auto relative overflow-visible flex flex-col gap-4" itemScope itemType="https://schema.org/FAQPage">
        <text.h2 as="heading" size={2}>{t('builder_faq_title')}</text.h2>
        {Array.from({ length: NUMBER_OF_FAQS }).map((_, index) => (
          <AnimatedFAQItem key={`faq-${index}`} index={index} onToggle={handleToggle} />
        ))}
      </div>
    </PageSection>
  )
}
