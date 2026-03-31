'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

import PageSection from '@/components/layout/PageSection'
import TextBlock from '@/components/layout/TextBlock'
import { useTranslations } from '@/hooks/useTranslations'

export default function StartSection() {
  const t = useTranslations();
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0.5 })

  return(
    <PageSection id="start-section" allowOverflow={true}>
      <div ref={ref} className="max-w-screen-lg mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 items-center relative overflow-visible start-section">
        <div className="flex flex-col justify-center">
          <TextBlock
            preTitle={t('builder_homepage_start_pretitle')}
            title={t('builder_homepage_start_title')}
          >
            {t('builder_homepage_start_text')}
          </TextBlock>
        </div>

        <div className="relative lg:min-h-[500px] overflow-visible">
          <motion.img
            src="/images/block-2-big.jpg"
            alt=""
            className="lg:absolute w-full lg:w-[950px] h-auto rounded-lg shadow-lg lg:left-[150px] lg:top-[0px]"
            initial={{ opacity: 0, x: 100, y: 20 }}
            animate={isInView ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, x: 100, y: 20 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            style={{ zIndex: 1, maxWidth: 'none' }}
          />

          <motion.img
            src="/images/block-2-small.png"
            alt=""
            className="hidden lg:block absolute w-[300px] h-auto rounded-lg shadow-xl left-[50px] top-[80px]"
            initial={{ opacity: 0, x: -25, y: 0, scale: 0.95 }}
            animate={isInView ? { opacity: 1, x: 0, y: 0, scale: 1 } : { opacity: 0, x: -25, y: 0, scale: 0.95 }}
            transition={{ duration: 0.8, delay: 1 }}
            style={{ zIndex: 2 }}
          />
        </div>
      </div>
    </PageSection>
  )
}
