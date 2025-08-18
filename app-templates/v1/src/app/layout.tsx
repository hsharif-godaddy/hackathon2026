import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'My App - Built with Airo AI Builder',
  description: 'An amazing app created with Airo AI Builder',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
