'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

import PageSection from '@/components/layout/PageSection'
import TextBlock from '@/components/layout/TextBlock'
import { LandingExplainerData } from './types'

export default function LandingExplainer({ id, preTitle, title, text, image, imageSmall, imagePosition }: LandingExplainerData) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0.5 })

  const isLeft = imagePosition === 'left'
  const slideDirection = isLeft ? -100 : 100
  const smallSlideDirection = isLeft ? 25 : -25

  const imageBlock = (
    <div className="relative lg:min-h-[600px] overflow-visible">
      <motion.img
        src={image}
        alt=""
        className={`lg:absolute w-full lg:w-[950px] h-auto rounded-lg shadow-lg ${
          isLeft
            ? 'lg:right-[150px] lg:top-[0px]'
            : 'lg:left-[150px] lg:top-[0px]'
        }`}
        initial={{ opacity: 0, x: slideDirection, y: 20 }}
        animate={isInView ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, x: slideDirection, y: 20 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        style={{ zIndex: 1, maxWidth: 'none' }}
      />

      {imageSmall && (
        <motion.img
          src={imageSmall}
          alt=""
          className={`hidden lg:block absolute w-[300px] h-auto rounded-lg shadow-xl ${
            isLeft
              ? 'right-[50px] top-[100px]'
              : 'left-[50px] top-[80px]'
          }`}
          initial={{ opacity: 0, x: smallSlideDirection, y: 0, scale: 0.95 }}
          animate={isInView ? { opacity: 1, x: 0, y: 0, scale: 1 } : { opacity: 0, x: smallSlideDirection, y: 0, scale: 0.95 }}
          transition={{ duration: 0.8, delay: 1 }}
          style={{ zIndex: 2 }}
        />
      )}
    </div>
  )

  const textBlock = (
    <div className="flex flex-col justify-center">
      <TextBlock
        preTitle={preTitle}
        title={title}
      >
        {text}
      </TextBlock>
    </div>
  )

  return (
    <PageSection id={id} allowOverflow={true}>
      <div ref={ref} className="max-w-screen-lg mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 items-center relative overflow-visible">
        {isLeft ? (
          <>
            {imageBlock}
            {textBlock}
          </>
        ) : (
          <>
            {textBlock}
            {imageBlock}
          </>
        )}
      </div>
    </PageSection>
  )
}
