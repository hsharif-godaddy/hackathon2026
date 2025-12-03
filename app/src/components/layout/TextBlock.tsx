import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

interface TextBlockProps {
  preTitle?: string
  title: string
  children: React.ReactNode
  link?: string
  linkText?: string
}

export default function TextBlock({ preTitle, title, children, link, linkText }: TextBlockProps) {
  return (
    <Box gap="lg">
      { preTitle && (
        <text.p size={1}>{preTitle}</text.p>
      )}
      <text.h2 as="heading" size={2}>{title}</text.h2>
      <text.p size={1} className="max-w-screen-sm !font-thin">{children}</text.p>
      { link && linkText && (
        <Button
          data-partial="dark1"
          text={linkText}
          href={link}
          design="inline"
          external
          as="cta"
        />
      )}
    </Box>
  )
}
