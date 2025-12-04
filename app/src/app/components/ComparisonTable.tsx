import React from 'react'
import { text } from '@ux/text'

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
  tiers: PricingTier[]
  featureGroups: FeatureGroup[]
}

export default function ComparisonTable({ title, subtitle, tiers, featureGroups }: ComparisonTableProps) {
  return (
    <div className="max-w-screen-lg mx-auto">
      <div className="overflow-hidden">
        <table className="w-full" role="table" aria-label="Pricing comparison table">
          <thead>
            <tr>
              <th scope="col" className="text-left py-3 w-1/4">
                <div>
                  <text.h2 as="heading" size={2} className="mb-1">
                    {title}
                  </text.h2>
                  <text.p size={0} className="opacity-60">
                    {subtitle}
                  </text.p>
                </div>
              </th>
              {tiers.map((tier) => (
                <th key={tier.name} scope="col" className="text-center py-3 w-1/4">
                  <div>
                    <text.h3 as="heading" size={0}>
                      {tier.name}
                    </text.h3>
                    <text.p size={2} className="mb-2">
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
            {featureGroups.map((group, groupIndex) => (
              <React.Fragment key={groupIndex}>
                {group.title && (
                  <tr>
                    <td colSpan={tiers.length + 1} className="pb-3 pt-4">
                      <text.h4 as="heading" size={1}>
                        {group.title}
                      </text.h4>
                    </td>
                  </tr>
                )}
                {group.features.map((feature, featureIndex) => (
                  <tr key={`${groupIndex}-${featureIndex}`}>
                    <td className="pt-3 py-2">
                      <div className="flex items-center gap-1">
                        <text.p size={1}>{feature.name}</text.p>
                        {feature.tooltip && (
                          <button
                            className="opacity-40 hover:opacity-100 transition-opacity"
                            aria-label={`More information about ${feature.name}`}
                            title={feature.tooltip}
                          >
                            <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
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
                                className="w-4 h-4 rounded-full bg-intents-ux-box-backgroundColor flex items-center justify-center"
                                role="img"
                                aria-label={`${feature.name} is included in ${tier.name} plan`}
                              >
                                <svg
                                  className="w-2 h-2 text-intents-ux-box-foregroundColor"
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
                                className="w-4 h-4 rounded-full bg-intents-ux-box-backgroundColor opacity-10 flex items-center justify-center"
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
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
