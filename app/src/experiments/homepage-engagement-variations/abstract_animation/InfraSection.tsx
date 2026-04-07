'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

import PageSection from '@/components/layout/PageSection'
import TextBlock from '@/components/layout/TextBlock'
import { AiroSettingsAnimation } from '@/experiments/homepage-engagement-variations/abstract_animation/animations/AiroSettingsAnimation'
import { useTranslations } from '@/hooks/useTranslations'

export default function InfraSection() {
  const t = useTranslations();
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0.3 })

  return(
    <PageSection id="infra-section" allowOverflow={true}>
      <div ref={ref} className="max-w-screen-xl mx-auto grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8 items-center relative overflow-visible">
        <motion.div
          className="w-full"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <AiroSettingsAnimation />
        </motion.div>

        <div className="flex flex-col justify-center">
          <TextBlock
            preTitle={t('builder_homepage_infra_pretitle')}
            title={t('builder_homepage_infra_title')}
          >
            {t('builder_homepage_infra_text')}
          </TextBlock>
        </div>
      </div>
    </PageSection>
  )
}
