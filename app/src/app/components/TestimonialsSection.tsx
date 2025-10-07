import Box from '@ux/box'
import text from '@ux/text'
import PageSection from '@/components/layout/PageSection'

const Testimonials = [
  {
    testimonial: "Tempus leo eu aenean sed diam urna tempor. Pulvinar vivamus fringilla lacus nec metus bibendum egestas. Iaculis massa nisl malesuada lacinia integer nunc posuere. Ut hendrerit semper vel class aptent taciti sociosqu. Ad litora torquent per conubia nostra inceptos himenaeos.",
    name: "Some Name",
    title: "Founder of Some Company",
  },
  {
    testimonial: "Tempus leo eu aenean sed diam urna tempor. Pulvinar vivamus fringilla lacus nec metus bibendum egestas. Iaculis massa nisl malesuada lacinia integer nunc posuere. Ut hendrerit semper vel class aptent taciti sociosqu. Ad litora torquent per conubia nostra inceptos himenaeos.",
    name: "Some Name",
    title: "Founder of Some Company",
  },
  {
    testimonial: "Tempus leo eu aenean sed diam urna tempor. Pulvinar vivamus fringilla lacus nec metus bibendum egestas. Iaculis massa nisl malesuada lacinia integer nunc posuere. Ut hendrerit semper vel class aptent taciti sociosqu. Ad litora torquent per conubia nostra inceptos himenaeos.",
    name: "Some Name",
    title: "Founder of Some Company",
  },
  {
    testimonial: "Tempus leo eu aenean sed diam urna tempor. Pulvinar vivamus fringilla lacus nec metus bibendum egestas. Iaculis massa nisl malesuada lacinia integer nunc posuere. Ut hendrerit semper vel class aptent taciti sociosqu. Ad litora torquent per conubia nostra inceptos himenaeos.",
    name: "Some Name",
    title: "Founder of Some Company",
  }
]

const Testimonial = ({ testimonial, name, title }) => {
  return (
    <Box gap="sm">
      <text.p size={1} className="!font-thin mb-4">{testimonial}</text.p>
      <text.p>{name}</text.p>
      <text.p size={-2} className="!font-thin">{title}</text.p>
    </Box>
  )
}

export default function TestimonialsSection() {
  return(
    <PageSection>
      <div className="max-w-screen-sm mx-auto flex flex-col gap-12">
        {Testimonials.map((testimonial) => (
          <Testimonial key={testimonial.name} {...testimonial} />
        ))}
      </div>
    </PageSection>
  )
}
