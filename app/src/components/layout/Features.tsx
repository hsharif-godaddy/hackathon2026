'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import Box from '@ux/box'
import text from '@ux/text'
import PageSection from '@/components/layout/PageSection'
import SparklesIcon from '@ux/icon/sparkles'

interface FeaturesProps {
  features: {
    title: string
    description: string
  }[]
}

function FeatureItem({
  feature,
  index
}: {
  feature: { title: string; description: string }
  index: number
}) {
  const ref = useRef(null)
  const amount = 0.5 + (index * 0.2)
  const isInView = useInView(ref, { once: true, amount })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 30 }}
      transition={{
        type: "spring",
        visualDuration: 0.5,
        bounce: 0.25
      }}
      className="feature"
    >
      <Box
        gap="md"
        inlineAlignChildren="start"
      >
        <Box
          blockPadding="md"
          inlinePadding="md"
          className="feature-icon rounded-md mb-2"
        >
          <SparklesIcon />
        </Box>
        <text.h3 as="heading">{feature.title}</text.h3>
        <text.p size={1} className="!font-thin">{feature.description}</text.p>
      </Box>
    </motion.div>
  )
}

export default function Features({ features }: FeaturesProps) {
  return (
    <PageSection>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-12 max-w-screen-lg mx-auto">
        {features.map((feature, index) => (
          <FeatureItem key={feature.title} feature={feature} index={index} />
        ))}
      </div>
    </PageSection>
  )
}
