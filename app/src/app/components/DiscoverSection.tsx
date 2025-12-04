import PageSection from '@/components/layout/PageSection'
import TextBlock from '@/components/layout/TextBlock'
import ComparisonTable from './ComparisonTable'

const pricingData = {
  title: "Airo +\nApp Builder",
  subtitle: "Choose your adventure",
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

export default function DiscoverSection() {
  return(
    <PageSection>
      <div className="max-w-screen-lg mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <TextBlock
          title="Discover which flavor is best for you"
        >
          In id cursus mi pretium tellus duis convallis. Tempus leo eu aenean sed diam urna tempor. Pulvinar vivamus fringilla lacus nec metus bibendum egestas.
        </TextBlock>
      </div>

      <ComparisonTable
        title={pricingData.title}
        subtitle={pricingData.subtitle}
        tiers={pricingData.tiers}
        featureGroups={pricingData.featureGroups}
      />
    </PageSection>
  )
}
