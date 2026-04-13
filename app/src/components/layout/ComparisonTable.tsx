'use client'

import { motion, useInView } from 'framer-motion'
import React, { useRef } from 'react'
import { text } from '@ux/text'

import PageSection from '@/components/layout/PageSection'

interface Feature {
  name: string
  tooltip?: string
  availability: boolean[] // Array matching tiers order - true = available, false = unavailable
}

interface FeatureGroup {
  title?: string
  features: Feature[]
}

interface PricingTier {
  name: string
  description: string
  price: string
  period: string
}

interface ComparisonTableProps {
  title: string
  subtitle: string
  ariaLabel: string
  tiers: PricingTier[]
  featureGroups: FeatureGroup[]
}

function AnimatedRow({ children, index }: { children: React.ReactNode; index: number }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0.1, margin: '0px 0px -100px 0px' })

  return (
    <motion.tr
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{
        type: 'spring',
        visualDuration: 0.4,
        bounce: 0.2,
        delay: index * 0.05
      }}
    >
      {children}
    </motion.tr>
  )
}

export default function ComparisonTable({ title, subtitle, ariaLabel, tiers, featureGroups }: ComparisonTableProps) {
  /*
  const pricingData = {
    title: "GoDaddy Airo AI Builder",
    subtitle: "Choose your adventure",
    ariaLabel: "Pricing comparison table",
    tiers: [
      { name: "Free", description: "Lorem ipsum", price: "$0", period: "/mo" },
      { name: "Pro", description: "Lorem ipsum", price: "$7.99", period: "/mo" },
      { name: "Team", description: "Lorem ipsum", price: "$199", period: "/mo" }
    ],
    featureGroups: [
      {
        features: [
          { name: "Feature", tooltip: "This is a helpful tooltip", availability: [true, true, true] },
          { name: "Feature", tooltip: "Another helpful tooltip", availability: [true, true, true] },
          { name: "Feature", availability: [false, false, true] }
        ]
      },
      {
        title: "Feature group",
        features: [
          { name: "Feature", availability: [true, true, true] },
          { name: "Feature", availability: [false, true, true] },
          { name: "Feature", availability: [false, false, true] }
        ]
      }
    ]
  }
  */
  return (
    <PageSection>
      <div className="max-w-screen-lg mx-auto">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]" role="table" aria-label={ ariaLabel }>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 backdrop-blur-md text-left py-3 w-1/3">
                  <div>
                    <text.h2 as="heading" size={0} className="mb-2">
                      {title}
                    </text.h2>
                    <text.p size={0} className="opacity-60">
                      {subtitle}
                    </text.p>
                  </div>
                </th>
                {tiers.map((tier) => (
                  <th key={tier.name} scope="col" className="text-center py-3 w-1/4 align-bottom">
                    <div className="flex flex-col items-center">
                      <text.h3 as="heading" size={-2}>
                        {tier.name}
                      </text.h3>
                      <text.p size={1} className="mb-1">
                        {tier.description}
                      </text.p>
                      <div className="text-2xl font-thin">
                        {tier.price}<span className="text-sm">{tier.period}</span>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {featureGroups.map((group, groupIndex) => {
                const previousFeaturesCount = featureGroups
                  .slice(0, groupIndex)
                  .reduce((acc, g) => acc + g.features.length + (g.title ? 1 : 0), 0)

                return (
                  <React.Fragment key={groupIndex}>
                    {group.title && (
                      <AnimatedRow index={previousFeaturesCount}>
                        <td className="sticky left-0 backdrop-blur-md pb-3 pt-4">
                          <text.h4 as="heading" size={-2}>
                            {group.title}
                          </text.h4>
                        </td>
                        {tiers.map((tier) => (
                          <td key={tier.name} className="pb-3 pt-4" />
                        ))}
                      </AnimatedRow>
                    )}
                    {group.features.map((feature, featureIndex) => {
                      const rowIndex = previousFeaturesCount + (group.title ? 1 : 0) + featureIndex
                      return (
                        <AnimatedRow key={`${groupIndex}-${featureIndex}`} index={rowIndex}>
                      <td className="sticky left-0 backdrop-blur-md pt-3 py-2">
                        <div className="flex items-center gap-1">
                          <text.p size={1}>{feature.name}</text.p>
                          {feature.tooltip && (
                            <button
                              className="opacity-40 hover:opacity-100 transition-opacity"
                              aria-label={`More information about ${feature.name}`}
                              title={feature.tooltip}
                            >
                              <svg className="size-2" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                      {tiers.map((tier, tierIndex) => {
                        const isAvailable = feature.availability[tierIndex]
                        return (
                          <td key={tier.name} className="p-3 py-2 text-center">
                            <div className="flex justify-center">
                              {isAvailable ? (
                                <div
                                  className="size-4 rounded-full bg-intents-ux-box-backgroundColor flex items-center justify-center"
                                  role="img"
                                  aria-label={`${feature.name} is included in ${tier.name} plan`}
                                >
                                  <svg
                                    className="size-2 text-intents-ux-box-foregroundColor"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    aria-hidden="true"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              ) : (
                                <div
                                  className="size-4 rounded-full bg-intents-ux-box-backgroundColor opacity-10 flex items-center justify-center"
                                  role="img"
                                  aria-label={`${feature.name} is not included in ${tier.name} plan`}
                                />
                              )}
                            </div>
                            {/* Hidden text for screen readers */}
                            <span className="sr-only">
                              {isAvailable
                                ? `${feature.name} is included in the ${tier.name} plan`
                                : `${feature.name} is not included in the ${tier.name} plan`
                              }
                            </span>
                          </td>
                        )
                      })}
                        </AnimatedRow>
                      )
                    })}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PageSection>
  )
}
