'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

import PageSection from '@/components/layout/PageSection'
import TextBlock from '@/components/layout/TextBlock'
import { AiroHeroAnimation } from '@/experiments/homepage-engagement-variations/abstract_animation/animations/AiroHeroAnimation'
import { useTranslations } from '@/hooks/useTranslations'

export default function StartSection() {
  const t = useTranslations();
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0.3 })

  return(
    <PageSection id="start-section" allowOverflow={true}>
      <div ref={ref} className="max-w-screen-xl mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-8 items-center relative overflow-visible start-section">
        <div className="flex flex-col justify-center">
          <TextBlock
            preTitle={t('builder_homepage_start_pretitle')}
            title={t('builder_homepage_start_title')}
          >
            {t('builder_homepage_start_text')}
          </TextBlock>
        </div>

        <motion.div
          className="w-full"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <AiroHeroAnimation />
        </motion.div>
      </div>
    </PageSection>
  )
}
