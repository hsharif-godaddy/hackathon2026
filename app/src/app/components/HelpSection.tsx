import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'
import PageSection from '@/components/layout/PageSection'

export default function HelpSection() {
  return(
    <PageSection>
      <Box
        className="max-w-screen-lg mx-auto bg-light-purple rounded-xl p-12 lg:p-20 mb-12 lg:mb-20"
        blockAlignChildren="start"
        inlineAlignChildren="start"
        gap="lg"
      >
        <text.h2 as="heading" size={3}>We love to help. Seriously.</text.h2>
        <text.p
          className="max-w-screen-sm !font-thin mb-1"
          size={1}
        >
          Still not sure what you need? Give us a call. We&apos;re happy to help, even if you&apos;re not a customer. Call us at 1-480-366-3546 and we&apos;ll chat — or get back to you as soon as we can.
        </text.p>
        <Button
          external
          text="Get help"
          design="primary"
          data-partial="dark1"
          href="https://www.godaddy.com/help/contact-us"
        />
      </Box>
    </PageSection>
  )
}
