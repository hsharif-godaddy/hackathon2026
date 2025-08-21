import type { Metadata } from 'next'
import './globals.css'
import DevelopmentMode from '../components/DevelopmentMode'

export const metadata: Metadata = {
  title: 'My App - Built with Airo AI Builder',
  description: 'An amazing app created with Airo AI Builder with shadcn/ui components',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="light">
      <body className="min-h-screen bg-background">
        {children}
        <DevelopmentMode />
      </body>
    </html>
  )
}
