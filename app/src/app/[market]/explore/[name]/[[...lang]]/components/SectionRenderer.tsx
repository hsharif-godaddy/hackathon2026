'use client'

import { ComponentType } from 'react'

import LandingExplainer from './LandingExplainer'
import LandingFAQ from './LandingFAQ'
import LandingFeatures from './LandingFeatures'
import LandingHelp from './LandingHelp'
import { LandingSection } from './types'

const sectionComponents: Record<string, ComponentType<any>> = {
  explainer: LandingExplainer,
  features: LandingFeatures,
  faq: LandingFAQ,
  help: LandingHelp,
}

export default function SectionRenderer({ sections }: { sections: LandingSection[] }) {
  return (
    <>
      {sections.map(function renderSection(section, index) {
        const Component = sectionComponents[section.type]
        if (!Component) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(`Unknown landing page section type: "${section.type}"`)
          }
          return null
        }
        return <Component key={section.id ?? `${section.type}-${index}`} {...section} />
      })}
    </>
  )
}
