import PageSection from '@/components/layout/PageSection'
import TextBlock from '@/components/layout/TextBlock'

export default function ExpressSection() {
  return(
    <PageSection>
        <div className="max-w-screen-lg mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          <TextBlock
            title="Express yourself"
            link="#"
            linkText="Lorem ipsum"
          >
            In id cursus mi pretium tellus duis convallis. Tempus leo eu aenean sed diam urna tempor. Pulvinar vivamus fringilla lacus nec metus bibendum egestas.
          </TextBlock>
        </div>
      </PageSection>
  )
}
